import { usePoolse } from '@poolse/react';
import { useEffect, useRef } from 'react';

/**
 * Bridges iOS PushKit + CallKit to poolse calls, so a call rings a
 * backgrounded or closed app.
 *
 * ## Why this is needed at all
 *
 * `call:incoming` travels over the WebSocket, which only exists while
 * the app is foregrounded — iOS suspends sockets on background and
 * drops them on close. Reaching a sleeping phone requires the OS to wake
 * the app, which means a VoIP push against a PushKit token.
 *
 * ## The rule Apple enforces
 *
 * Every delivered VoIP push MUST report an incoming call to CallKit,
 * essentially immediately. Miss it and iOS terminates the app; do it
 * repeatedly and the system stops delivering VoIP pushes to you at all.
 * `reportCall` below is not optional politeness — it is the contract.
 *
 * ## Dependencies
 *
 * `react-native-voip-push-notification` and `react-native-callkeep`,
 * both native, both requiring a development build. Like
 * `react-native-webrtc`, Metro only bundles what it can see statically,
 * so YOUR APP imports them and passes them in:
 *
 *     import VoipPushNotification from 'react-native-voip-push-notification';
 *     import RNCallKeep from 'react-native-callkeep';
 *
 *     useVoipCalls({
 *       voipPush: VoipPushNotification,
 *       callKeep: RNCallKeep,
 *       onAnswer: (call) => { ... },
 *     });
 */

/**
 * The slice of `react-native-voip-push-notification` used here.
 *
 * Loose on purpose. The real module types `addEventListener` as a
 * generic whose handler payload varies per event, and pinning exact
 * signatures here makes `voipPush={VoipPushNotification}` fail to
 * compile — the prop becomes unusable, which is the whole point of it.
 * Method syntax (not property arrow syntax) keeps the check bivariant.
 */
export interface VoipPushModule {
  addEventListener(event: string, handler: (payload: unknown) => void): void;
  removeEventListener(event: string): void;
  registerVoipToken(): void;
}

/** The slice of `react-native-callkeep` used here. Loose for the same
 *  reason — `setup` resolves to a boolean in the real module. */
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
   * Fired when the user answers from the native call UI. Accept the
   * call and join the room here — the app may have been launched cold,
   * so don't assume any prior state.
   */
  onAnswer?: (call: VoipIncomingCall) => void;
  /** Fired when the user declines from the native call UI. */
  onDecline?: (call: VoipIncomingCall) => void;
  /** CallKit display name for your app. Shown on the lock screen. */
  appName?: string;
}

interface PushPayload {
  call_id?: string;
  conversation_id?: string;
  caller_user_id?: string;
  caller_name?: string;
}

/**
 * Registers this device for VoIP pushes and wires the native call UI.
 *
 * Safe to mount once at the app root. Does nothing on Android, which
 * needs a separate FCM + ConnectionService integration.
 */
export function useVoipCalls({
  voipPush,
  callKeep,
  onAnswer,
  onDecline,
  appName = 'poolse',
}: UseVoipCallsOptions): void {
  const poolse = usePoolse();

  // Calls we've shown to CallKit, keyed by call id, so the answer/end
  // events can be resolved back to a conversation. A cold launch starts
  // empty and is filled by the push that woke us.
  const pending = useRef<Map<string, VoipIncomingCall>>(new Map());

  // Handlers are read at event time so a re-render doesn't have to tear
  // down and re-register the native listeners.
  const handlers = useRef({ onAnswer, onDecline });
  handlers.current = { onAnswer, onDecline };

  useEffect(() => {
    let cancelled = false;

    const reportCall = (payload: PushPayload) => {
      const callId = payload.call_id;
      const conversationId = payload.conversation_id;
      if (!callId || !conversationId) return;

      const call: VoipIncomingCall = {
        callId,
        conversationId,
        callerUserId: payload.caller_user_id ?? '',
        callerName: payload.caller_name ?? 'Incoming call',
      };
      pending.current.set(callId, call);

      // Must happen now. iOS kills an app that takes a VoIP push without
      // reporting a call, and eventually stops waking it at all.
      callKeep.displayIncomingCall(callId, call.callerUserId, call.callerName, 'generic', false);
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

    // PushKit hands us a token on every launch and may rotate it, so
    // register whatever we're given rather than caching.
    voipPush.addEventListener('register', ((token: string) => {
      if (cancelled || !token) return;
      void poolse.devices
        .register({ token, platform: 'ios', environment: apnsEnvironment() })
        .catch(() => {
          // Offline at launch is normal. The next launch re-registers.
        });
    }) as (payload: unknown) => void);

    voipPush.addEventListener('notification', ((payload: PushPayload) => {
      reportCall(payload);
    }) as (payload: unknown) => void);

    // Pushes that arrived while the JS bundle was still starting are
    // replayed here. Without this, a cold-launch call is lost — the very
    // case this whole module exists for.
    voipPush.addEventListener('didLoadWithEvents', ((
      events: Array<{ name: string; data: unknown }>,
    ) => {
      for (const event of events ?? []) {
        if (event.name === 'RNVoipPushRemoteNotificationReceivedEvent') {
          reportCall(event.data as PushPayload);
        }
      }
    }) as (payload: unknown) => void);

    callKeep.addEventListener('answerCall', (({ callUUID }: { callUUID: string }) => {
      const call = pending.current.get(callUUID);
      if (call) handlers.current.onAnswer?.(call);
    }) as (payload: unknown) => void);

    callKeep.addEventListener('endCall', (({ callUUID }: { callUUID: string }) => {
      const call = pending.current.get(callUUID);
      pending.current.delete(callUUID);
      if (call) handlers.current.onDecline?.(call);
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
  }, [poolse, voipPush, callKeep, appName]);
}

/**
 * Debug builds get sandbox APNs tokens, which production APNs rejects
 * outright — so the environment has to travel with the token.
 */
function apnsEnvironment(): 'production' | 'sandbox' {
  return __DEV__ ? 'sandbox' : 'production';
}
