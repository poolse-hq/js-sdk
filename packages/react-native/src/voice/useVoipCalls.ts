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
   * How old a pushed call may be before it is ignored, in ms. Defaults
   * to 45s, matching `useCalls`' ring timeout — past that the caller has
   * already given up, so there is nothing live to answer.
   *
   * PushKit holds a push that lands before the JS bundle is up and
   * replays it on launch, so opening the app can ring you for a call the
   * caller hung up on minutes ago — a ring with nothing live to accept.
   */
  staleAfterMs?: number;
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
  staleAfterMs = 45_000,
}: UseVoipCallsOptions): void {
  const poolse = usePoolse();

  /** Calls currently shown to CallKit, keyed by call id. */
  const shown = useRef<Map<string, VoipIncomingCall>>(new Map());
  /** Every call id already acted on, so neither route can ring twice. */
  const seen = useRef<Set<string>>(new Set());

  // Read at event time so a re-render doesn't tear down and re-register
  // the native listeners.
  const handlers = useRef({ onAnswer, onDecline, calls });
  handlers.current = { onAnswer, onDecline, calls };

  const staleRef = useRef(staleAfterMs);
  staleRef.current = staleAfterMs;

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

  /** Show a call once, from whichever route reached us first. */
  const present = useRef((call: VoipIncomingCall, sentAt?: number) => {
    if (seen.current.has(call.callId)) return;

    // A replayed push for a call that already ended would produce a ring
    // nobody can answer, which is worse than missing it.
    if (typeof sentAt === 'number' && Date.now() - sentAt > staleRef.current) return;

    seen.current.add(call.callId);
    shown.current.set(call.callId, call);

    // Must happen now: iOS kills an app that takes a VoIP push without
    // reporting a call, and eventually stops waking it at all.
    callKeep.displayIncomingCall(call.callId, call.callerUserId, call.callerName, 'generic', false);
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

    void callKeep
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
        // A failed CallKit setup shouldn't take the app down; calls just
        // stay foreground-only.
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
      if (!call) return;
      shown.current.delete(callUUID);

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
      if (!call) return;

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
