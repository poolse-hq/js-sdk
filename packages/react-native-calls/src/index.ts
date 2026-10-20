// @poolse/react-native-calls — the React Native face of the native
// call core (CONTRACT.md §8). A thin, typed surface over the native
// module: commands in, one snapshot event out. All call logic lives in
// the native cores; nothing here decides anything about a call.
//
// On a platform or build without the native module (Expo Go, web,
// unlinked), every command is a safe no-op and the state stays idle —
// so a host can render against this unconditionally.
import { createElement, type ComponentType, type ReactElement } from 'react';
import { View, type ViewProps } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';

/**
 * A call's complete state. `null` means idle — no call. After a call
 * ends the snapshot stays `phase: 'ended'` (with `reason`) for ~2.5 s,
 * then becomes `null`.
 */
export interface Snapshot {
  cv: 1;
  callId: string;
  conversationId: string;
  conversationName: string | null;
  direction: 'incoming' | 'outgoing' | 'joined';
  media: 'audio' | 'video';
  phase: 'ringing_in' | 'ringing_out' | 'connecting' | 'active' | 'reconnecting' | 'ended';
  reason?:
    | 'left'
    | 'finished'
    | 'declined_all'
    | 'busy_all'
    | 'no_answer'
    | 'cancelled'
    | 'connection_lost'
    | 'failed';
  /** REMOTE participants only; `userId` is the LiveKit identity. */
  participants: Array<{
    userId: string;
    externalId: string;
    speaking: boolean;
    muted: boolean;
    /** True only with a published, subscribed, unmuted camera track (show video, not avatar). */
    cameraOn: boolean;
  }>;
  audioRoute: 'earpiece' | 'speaker' | 'bluetooth' | 'headset';
  mutedSelf: boolean;
  /** True only while the local camera track is actually published and enabled. */
  cameraOn: boolean;
  /** Facing of the published local camera; absent when the camera is off. */
  cameraFacing?: 'front' | 'back';
}

export interface ConfigureOptions {
  /** Drawable resource NAME for the call notification's small icon. */
  smallIcon?: string;
  /** Ringback tone: raw resource NAME (Android); main-bundle sound name, mp3/caf/wav (iOS). */
  ringback?: string;
  /**
   * iOS: the APNs environment of this build's `aps-environment`
   * entitlement. Echoed back with the VoIP token so the server pushes to
   * the right gateway. Ignored on Android.
   */
  apnsEnvironment?: 'production' | 'sandbox';
}

/** The iOS PushKit (VoIP) token and the APNs environment it belongs to. */
export interface VoipToken {
  /** Hex-encoded PushKit token. */
  token: string;
  environment: 'production' | 'sandbox' | string;
}

export interface PlaceOptions {
  media: 'audio' | 'video';
  /** The user's session token — authorizes placing/joining (CONTRACT.md §3.2). */
  sessionToken: string;
}

type NativeSnapshot = { snapshot: Snapshot | null };

interface PoolseCallsNative {
  configure(apiBaseUrl: string, options: ConfigureOptions | null): Promise<void>;
  getCallState(): NativeSnapshot;
  place(conversationId: string, media: string, sessionToken: string): Promise<void>;
  join(callId: string, conversationId: string | null, sessionToken: string): Promise<void>;
  answer(): void;
  decline(): void;
  hangUp(): void;
  setMuted(muted: boolean): void;
  setCamera(on: boolean): void;
  switchCamera(): void;
  setSpeaker(on: boolean): void;
  onRingEnded(callId: string, reason: string): void;
  onCallFinished(callId: string, reason: string | null): void;
  canUseFullScreenIntent(): boolean;
  openFullScreenIntentSettings(): void;
  getVoipToken?(): VoipToken | null;
  addListener(event: 'onCallState', cb: (payload: NativeSnapshot) => void): { remove(): void };
  addListener(event: 'onVoipToken', cb: (payload: VoipToken) => void): { remove(): void };
}

const native = requireOptionalNativeModule<PoolseCallsNative>('PoolseCalls');

/** True when the native call core is present in this build. */
export const nativeCallsAvailable = native != null;

/** Configure once, before any call can arrive. No secrets — just the API origin. */
export async function configure(apiBaseUrl: string, options?: ConfigureOptions): Promise<void> {
  await native?.configure(apiBaseUrl, options ?? null);
}

/** The current snapshot — safe to read at any moment, including cold answer and before configure. */
export function getCallState(): Snapshot | null {
  return native?.getCallState().snapshot ?? null;
}

export type Unsubscribe = () => void;

/** Subscribe to call state. Fires a full snapshot on every change. */
export function onCallState(cb: (snapshot: Snapshot | null) => void): Unsubscribe {
  if (!native) return () => undefined;
  const sub = native.addListener('onCallState', (payload) => cb(payload.snapshot));
  return () => sub.remove();
}

export function place(conversationId: string, options: PlaceOptions): Promise<void> {
  return native?.place(conversationId, options.media, options.sessionToken) ?? Promise.resolve();
}

export function join(
  callId: string,
  conversationId: string | null,
  sessionToken: string,
): Promise<void> {
  return native?.join(callId, conversationId, sessionToken) ?? Promise.resolve();
}

export const answer = (): void => native?.answer();
export const decline = (): void => native?.decline();
export const hangUp = (): void => native?.hangUp();
export const setMuted = (muted: boolean): void => native?.setMuted(muted);
export const setCamera = (on: boolean): void => native?.setCamera(on);
export const switchCamera = (): void => native?.switchCamera();
/** Route call audio to the loudspeaker (`true`) or back to earpiece / headset (`false`). */
export const setSpeaker = (on: boolean): void => native?.setSpeaker(on);

/**
 * Socket forwarding for an open app: a `call:ring_ended` seen on the
 * socket. Idempotent with the push path — the core dedupes.
 */
export const onRingEnded = (callId: string, reason: string): void =>
  native?.onRingEnded(callId, reason);

/**
 * Socket forwarding: `call:finished`. Pass the payload's `reason`
 * (`finished` | `declined_all` | `no_answer` | `cancelled`) so an
 * unanswered caller sees "Declined"/"No answer", not "Call ended".
 * Idempotent with the `finished` push.
 */
export const onCallFinished = (callId: string, reason?: string): void =>
  native?.onCallFinished(callId, reason ?? null);

/**
 * Android 14+: whether the app may show the full-screen ring over the
 * lock screen. `true` on older Android and where the module is absent.
 */
export const canUseFullScreenIntent = (): boolean => native?.canUseFullScreenIntent() ?? true;

/** Open the system screen where the user grants full-screen intents (falls back to notification settings). */
export const openFullScreenIntentSettings = (): void => native?.openFullScreenIntentSettings();

// ── VoIP push (iOS) ───────────────────────────────────────────────────

/**
 * iOS: the current PushKit VoIP token, registered natively at launch.
 * `null` until iOS issues one, and always on Android (FCM carries rings).
 */
export function getVoipToken(): VoipToken | null {
  return native?.getVoipToken?.() ?? null;
}

/** iOS: fires whenever PushKit issues (or rotates) the VoIP token. No-op on Android. */
export function onVoipToken(cb: (token: VoipToken) => void): Unsubscribe {
  if (!native || !native.getVoipToken) return () => undefined;
  const sub = native.addListener('onVoipToken', cb);
  return () => sub.remove();
}

// ── video ─────────────────────────────────────────────────────────────

export interface CallVideoViewProps extends ViewProps {
  /** Remote participant's userId (LiveKit identity). Omit with local=true for self view. */
  participantId?: string;
  local?: boolean;
  /** default: true for local front camera, false otherwise */
  mirror?: boolean;
  /** default 'cover' */
  fit?: 'cover' | 'contain';
}

type NativeVideoProps = CallVideoViewProps;

let nativeVideo: ComponentType<NativeVideoProps> | null | undefined;

/** Resolved lazily (first render) and only when the native module exists. */
function nativeVideoView(): ComponentType<NativeVideoProps> | null {
  if (nativeVideo !== undefined) return nativeVideo;
  nativeVideo = null;
  if (native) {
    try {
      nativeVideo = requireNativeViewManager<NativeVideoProps>('PoolseCalls', 'PoolseCallVideo');
    } catch {
      nativeVideo = null; // an older native build without the view
    }
  }
  return nativeVideo;
}

/**
 * A participant's camera (or, with `local`, your own), rendered natively
 * by the call core. Shows nothing (stays transparent) while that camera
 * is off — draw the avatar from the snapshot's `cameraOn` underneath.
 * Without the native module it renders an empty View.
 */
export function CallVideoView(props: CallVideoViewProps): ReactElement | null {
  const Native = nativeVideoView();
  if (!Native) {
    const { participantId: _p, local: _l, mirror: _m, fit: _f, ...rest } = props;
    return createElement(View, rest);
  }
  return createElement(Native, props);
}
