import { usePoolse, type UseCalls } from '@poolse/react';
import type { IncomingCall } from '@poolse/sdk';
import { useEffect, useRef } from 'react';

/**
 * Bridges iOS PushKit + CallKit to poolse calls, and owns the incoming
 * call UI end to end.
 *
 * ## Why this coordinates rather than just forwards
 *
 * A call arrives by two routes: `call:incoming` over the WebSocket when
 * the app is foregrounded, and a VoIP push when it isn't. The server
 * fires both, always — deciding server-side whether a socket is really
 * alive is a race it would lose.
 *
 * Reconciling them is therefore the client's job, and doing it badly is
 * very visible: forward each route to its own UI and one tap of Call
 * shows the callee two rings, an in-app sheet fighting a system call
 * screen.
 *
 * So this hook is the single place a call becomes visible. Both routes
 * feed one map keyed by `callId`, CallKit is the only ring UI, and the
 * native call is torn down whenever the call reaches a terminal state —
 * declined, cancelled, timed out, answered. Pass the same `calls` object
 * to `<CallScreen>` and it stays out of the way while a ring is up.
 *
 * ## The rule Apple enforces
 *
 * Every delivered VoIP push MUST report an incoming call to CallKit,
 * essentially immediately. Miss it and iOS terminates the app; do it
 * repeatedly and the system stops delivering VoIP pushes at all.
 *
 * ## Dependencies
 *
 * `react-native-voip-push-notification` and `react-native-callkeep`,
 * both native and both requiring a development build. Metro only bundles
 * what it can see statically, so YOUR APP imports them and passes them
 * in. The iOS AppDelegate also needs PushKit delegate methods, which
 * Expo does not generate — see the sample's `plugins/withVoipPush.js`.
 *
 *     useVoipCalls({
 *       voipPush: VoipPushNotification,
 *       callKeep: RNCallKeep,
 *       calls,                       // the same useCalls() the UI uses
 *       apnsEnvironment: 'sandbox',
 *     });
 */

/** The slice of `react-native-voip-push-notification` used here. */
export interface VoipPushModule {
  addEventListener(event: string, handler: (payload: unknown) => void): void;
  removeEventListener(event: string): void;
  registerVoipToken(): void;
}

/** The slice of `react-native-callkeep` used here. */
export interface CallKeepModule {
  setup(options: unknown): Promise<unknown>;
  displayIncomingCall(
    uuid: string,
    handle: string,
    localizedCallerName?: string,
    handleType?: string,
    hasVideo?: boolean,
  ): unknown;
  endCall(uuid: string): unknown;
  addEventListener(event: string, handler: (payload: unknown) => void): void;
  removeEventListener(event: string): void;
}

/** An inbound call, as it arrives inside a VoIP push payload. */
export interface VoipIncomingCall {
  callId: string;
  conversationId: string;
  callerUserId: string;
  callerName: string;
}

export interface UseVoipCallsOptions {
  voipPush: VoipPushModule;
  callKeep: CallKeepModule;
  /**
   * The `useCalls(...)` instance driving this screen. Supplying it lets
   * the hook answer, decline and dismiss through the same state machine
   * the UI uses, rather than two halves disagreeing about what is
   * happening.
   */
  calls?: UseCalls;
  /** Called when the user answers from the native call UI. */
  onAnswer?: (call: VoipIncomingCall) => void;
  /** Called when the user declines from the native call UI. */
  onDecline?: (call: VoipIncomingCall) => void;
  /** CallKit display name for your app. Shown on the lock screen. */
  appName?: string;
  /**
   * Which APNs environment issued this build's PushKit token — it must
   * match the app's `aps-environment` entitlement.
   *
   * Pass it explicitly. The fallback guesses from `__DEV__`, which
   * describes the JS bundle and NOT the entitlement: an ad-hoc or
   * TestFlight build has `__DEV__ === false` while still carrying the
   * `development` entitlement, so it receives a sandbox token and
   * reports it as production. The server then pushes to the wrong
   * environment, Apple answers BadDeviceToken, and the phone never
   * rings — with nothing in the app to suggest why.
   */
  apnsEnvironment?: 'production' | 'sandbox';
  /**
   * How old a pushed call may be before it is reported and immediately
   * ended, in ms. Defaults to a deliberately generous 120s.
   *
   * The tight value this once used made clock skew between server and
   * handset enough to suppress live calls. The authoritative guard is
   * server-side anyway — accepting an ended call is refused — so this is
   * only here to spare the user a ring for something long dead.
   *
   * PushKit holds a push that lands before the JS bundle is up and
   * replays it on launch, so opening the app can ring you for a call the
   * caller hung up on minutes ago — a ring with nothing live to accept.
   */
  staleAfterMs?: number;
}

/**
 * Whether a pushed call is old enough to be dismissed straight after
 * being reported.
 *
 * Exported for testing, because getting this wrong is silent and total:
 * too tight a window and clock skew between the server and the handset
 * suppresses live calls with nothing in the app to explain it.
 *
 * Never dismisses on a missing timestamp, and never on a future one —
 * skew runs both ways, and withholding a real call is far worse than
 * ringing once for a dead one.
 */
export function isStalePush(
  sentAt: number | undefined,
  now: number,
  staleAfterMs: number,
): boolean {
  if (typeof sentAt !== 'number' || !Number.isFinite(sentAt)) return false;
  const age = now - sentAt;
  if (age < 0) return false;
  return age > staleAfterMs;
}

interface PushPayload {
  call_id?: string;
  conversation_id?: string;
  caller_user_id?: string;
  caller_name?: string;
  sent_at?: number;
}

/**
 * Registers this device for VoIP pushes and drives the native call UI.
 *
 * Mount once, as high in the signed-in tree as possible. Does nothing on
 * Android, which needs a separate FCM + ConnectionService integration.
 */
export function useVoipCalls({
  voipPush,
  callKeep,
  calls,
  onAnswer,
  onDecline,
  appName = 'poolse',
  apnsEnvironment,
  staleAfterMs = 120_000,
}: UseVoipCallsOptions): void {
  const poolse = usePoolse();

  /** Calls currently shown to CallKit, keyed by call id. */
  const shown = useRef<Map<string, VoipIncomingCall>>(new Map());

  // Read at event time so a re-render doesn't tear down and re-register
  // the native listeners.
  const handlers = useRef({ onAnswer, onDecline, calls });
  handlers.current = { onAnswer, onDecline, calls };

  const staleRef = useRef(staleAfterMs);
  staleRef.current = staleAfterMs;

  /**
   * Resolves once CallKit is configured.
   *
   * On a push-launched app the queued push can be replayed before
   * `setup()` finishes, and reporting into an unconfigured CallKit
   * throws — which iOS treats as a push that was never reported, and
   * kills the app for it. Reports are chained on this instead.
   */
  const ready = useRef<Promise<unknown>>(Promise.resolve());

  /** Take a call down in CallKit — the island stays stuck until we do. */
  const dismiss = useRef((callId: string) => {
    if (!shown.current.has(callId)) return;
    shown.current.delete(callId);
    try {
      callKeep.endCall(callId);
    } catch {
      // Ending a call CallKit has already forgotten is not an error.
    }
  });

  /**
   * Report a call to CallKit.
   *
   * ALWAYS reports, with no early return before
   * `displayIncomingCall`. iOS terminates an app that accepts a VoIP
   * push without reporting a call — so skipping the report to
   * deduplicate, or because the push looked stale, crashes the app
   * instead of quietly ignoring the call.
   *
   * Deduplication needs no help from us: CallKit keys calls by UUID, so
   * reporting the same `callId` twice updates the existing call rather
   * than creating a second one. That is what makes it safe for the
   * socket and the push to both report the same call.
   *
   * A stale call is reported and then immediately ended, which satisfies
   * the contract and still spares the user a ring they cannot answer.
   */
  const present = useRef((call: VoipIncomingCall, sentAt?: number) => {
    shown.current.set(call.callId, call);

    const show = () => {
      try {
        callKeep.displayIncomingCall(
          call.callId,
          call.callerUserId,
          call.callerName,
          'generic',
          false,
        );
      } catch {
        // Never let a reporting failure propagate: an exception here
        // takes the whole app down on a path iOS is already watching.
      }
    };

    // `.then` on an already-resolved promise still defers a tick, which
    // is immaterial next to the seconds iOS allows — and far cheaper
    // than reporting before CallKit is ready.
    void ready.current.then(show, show);

    if (isStalePush(sentAt, Date.now(), staleRef.current)) dismiss.current(call.callId);
  });

  useEffect(() => {
    let cancelled = false;

    const fromPush = (payload: PushPayload) => {
      const callId = payload.call_id;
      const conversationId = payload.conversation_id;
      if (!callId || !conversationId) return;

      present.current(
        {
          callId,
          conversationId,
          callerUserId: payload.caller_user_id ?? '',
          callerName: payload.caller_name ?? 'Incoming call',
        },
        payload.sent_at,
      );
    };

    ready.current = callKeep
      .setup({
        ios: { appName },
        android: {
          alertTitle: 'Permissions required',
          alertDescription: 'Allow calls from this app',
          cancelButton: 'Cancel',
          okButton: 'ok',
          additionalPermissions: [],
        },
      })
      .catch(() => {
        // A failed setup shouldn't take the app down. Reports still go
        // out afterwards — a rejected setup often still leaves CallKit
        // usable, and not reporting is the one outcome iOS punishes.
      });

    // PushKit issues a token on every launch and may rotate it, so
    // register whatever we're given rather than caching.
    voipPush.addEventListener('register', ((token: string) => {
      if (cancelled || !token) return;
      void poolse.devices
        .register({
          token,
          platform: 'ios',
          environment: apnsEnvironment ?? guessApnsEnvironment(),
        })
        .catch(() => {
          // Offline at launch is normal; the next launch re-registers.
        });
    }) as (payload: unknown) => void);

    voipPush.addEventListener('notification', ((payload: PushPayload) => {
      fromPush(payload);
    }) as (payload: unknown) => void);

    // Pushes that landed while the bundle was still starting are replayed
    // here. Without this a cold-launch call is lost — the very case this
    // exists for — but they are also the likeliest to be stale, so they
    // go through the same age check.
    voipPush.addEventListener('didLoadWithEvents', ((
      events: Array<{ name: string; data: unknown }>,
    ) => {
      for (const event of events ?? []) {
        if (event.name === 'RNVoipPushRemoteNotificationReceivedEvent') {
          fromPush(event.data as PushPayload);
        }
      }
    }) as (payload: unknown) => void);

    callKeep.addEventListener('answerCall', (({ callUUID }: { callUUID: string }) => {
      const call = shown.current.get(callUUID);
      shown.current.delete(callUUID);

      // The map is empty after a relaunch — iOS can kill and restart the
      // app between reporting the call and the user answering it. Falling
      // back to the hook's own state means answering still works instead
      // of silently doing nothing.
      if (!call) {
        void handlers.current.calls?.accept();
        return;
      }

      // Accept through the shared state machine so the in-app UI moves to
      // 'active' too. The explicit argument matters: on a cold launch the
      // hook has no `incoming` state, and the push payload is the only
      // record of what is being answered.
      void handlers.current.calls?.accept({
        callId: call.callId,
        conversationId: call.conversationId,
        callerUserId: call.callerUserId,
      });
      handlers.current.onAnswer?.(call);
    }) as (payload: unknown) => void);

    callKeep.addEventListener('endCall', (({ callUUID }: { callUUID: string }) => {
      const call = shown.current.get(callUUID);
      shown.current.delete(callUUID);

      // Same relaunch case as answerCall: end whatever the hook thinks
      // is live rather than leaving a call the user has dismissed.
      if (!call) {
        void handlers.current.calls?.hangUp();
        return;
      }

      void handlers.current.calls?.decline({
        callId: call.callId,
        conversationId: call.conversationId,
        callerUserId: call.callerUserId,
      });
      handlers.current.onDecline?.(call);
    }) as (payload: unknown) => void);

    voipPush.registerVoipToken();

    return () => {
      cancelled = true;
      voipPush.removeEventListener('register');
      voipPush.removeEventListener('notification');
      voipPush.removeEventListener('didLoadWithEvents');
      callKeep.removeEventListener('answerCall');
      callKeep.removeEventListener('endCall');
    };
  }, [poolse, voipPush, callKeep, appName, apnsEnvironment]);

  // ── keep CallKit in step with the call's actual state ───────────────

  const incoming: IncomingCall | null = calls?.incoming ?? null;
  const phase = calls?.phase;

  // A call that reached us over the socket has to be shown too, or a
  // foregrounded app rings only in-app while the lock screen stays
  // silent — and answering from the island then does nothing.
  useEffect(() => {
    if (phase === 'ringing-in' && incoming) {
      present.current({
        callId: incoming.callId,
        conversationId: incoming.conversationId,
        callerUserId: incoming.callerUserId,
        callerName: incoming.callerUserId,
      });
    }
  }, [phase, incoming]);

  // The caller hung up, we declined, it timed out, or it connected. In
  // every one of those cases the ring is over, and CallKit doesn't know
  // unless told — leave it and the Dynamic Island keeps showing a call
  // that no longer exists, with buttons that do nothing.
  useEffect(() => {
    if (phase === 'ringing-in' || phase === 'ringing-out') return;
    for (const callId of [...shown.current.keys()]) dismiss.current(callId);
  }, [phase]);
}

/**
 * Last-resort guess when `apnsEnvironment` isn't supplied.
 *
 * `__DEV__` reflects the JS bundle, not the `aps-environment`
 * entitlement, and the two disagree for any ad-hoc or TestFlight build.
 * Prefer passing the value explicitly, derived from the same source as
 * the entitlement.
 */
function guessApnsEnvironment(): 'production' | 'sandbox' {
  return __DEV__ ? 'sandbox' : 'production';
}
