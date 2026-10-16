// @poolse/react-native-calls — the React Native face of the native
// call core (CONTRACT.md §8). A thin, typed surface over the native
// module: commands in, one snapshot event out. All call logic lives in
// the native cores; nothing here decides anything about a call.
//
// On a platform or build without the native module (Expo Go, web,
// unlinked), every command is a safe no-op and the state stays idle —
// so a host can render against this unconditionally.
import { requireOptionalNativeModule } from 'expo-modules-core';

/** A call's complete state. `null` means idle — no call. */
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
  participants: Array<{
    userId: string;
    externalId: string;
    speaking: boolean;
    muted: boolean;
    cameraOn: boolean;
  }>;
  audioRoute: 'earpiece' | 'speaker' | 'bluetooth' | 'headset';
  mutedSelf: boolean;
  cameraOn: boolean;
}

export interface ConfigureOptions {
  /** Drawable resource NAME for the call notification's small icon. */
  smallIcon?: string;
  /** Raw resource NAME of the ringback tone (Android). */
  ringback?: string;
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
  addListener(event: 'onCallState', cb: (payload: NativeSnapshot) => void): { remove(): void };
}

const native = requireOptionalNativeModule<PoolseCallsNative>('PoolseCalls');

/** True when the native call core is present in this build. */
export const nativeCallsAvailable = native != null;

/** Configure once, before any call can arrive. No secrets — just the API origin. */
export async function configure(apiBaseUrl: string, options?: ConfigureOptions): Promise<void> {
  await native?.configure(apiBaseUrl, options ?? null);
}

/** The current snapshot — safe to read at any moment, including cold answer. */
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
