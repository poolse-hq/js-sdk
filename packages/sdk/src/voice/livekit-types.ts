/**
 * Structural types for `livekit-client`.
 *
 * Declared here rather than imported for the same reason `WebRtcAdapter`
 * exists: the module is passed IN by the app. tsup rewrites a literal
 * `require()` into `__require()`, which Metro cannot follow, so a
 * dependency this package imports for itself is absent from every React
 * Native bundle — development builds included. That failure already cost
 * us a release once with `react-native-webrtc`.
 *
 * Declaring the shape structurally also keeps the two platforms honest:
 * web passes `livekit-client`, React Native passes the same package with
 * `@livekit/react-native`'s globals registered, and neither has to match
 * a nominal type this package owns.
 *
 * Deliberately narrow — only what {@link CallRoom} actually touches.
 */

/** A media track. Opaque here; the platform renderer consumes it. */
export type LiveKitTrack = object;

export interface LiveKitPublication {
  track?: LiveKitTrack | null | undefined;
  isMuted?: boolean;
  isSubscribed?: boolean;
}

export interface LiveKitParticipant {
  /** The poolse user id — we mint tokens with `sub` set to it. */
  identity: string;
  name?: string | undefined;
  isMicrophoneEnabled?: boolean;
  isCameraEnabled?: boolean;
  isSpeaking?: boolean;
  getTrackPublication(source: string): LiveKitPublication | undefined;
}

export interface LiveKitLocalParticipant extends LiveKitParticipant {
  setCameraEnabled(enabled: boolean): Promise<unknown>;
  setMicrophoneEnabled(enabled: boolean): Promise<unknown>;
}

export interface LiveKitRoomHandle {
  localParticipant: LiveKitLocalParticipant;
  /** Keyed by identity. `remoteParticipants` is the v2 name. */
  remoteParticipants: Map<string, LiveKitParticipant>;
  connect(url: string, token: string, options?: unknown): Promise<void>;
  disconnect(): Promise<void>;
  on(event: string, handler: (...args: never[]) => void): unknown;
  off(event: string, handler: (...args: never[]) => void): unknown;
}

/**
 * The `livekit-client` namespace, as imported by your app:
 *
 *     import * as livekit from 'livekit-client';
 */
export interface LiveKitModule {
  Room: new (options?: unknown) => LiveKitRoomHandle;
  RoomEvent: Record<string, string>;
  Track: { Source: Record<string, string> };
}

/**
 * A track plus the context a renderer needs to draw it.
 *
 * This is LiveKit's `TrackReference` shape, rebuilt structurally so the
 * SDK doesn't depend on `@livekit/components-react`. React Native's
 * `<VideoTrack trackRef={...}>` takes it directly; the web renderer
 * ignores it and attaches the track itself.
 *
 * Adaptive streaming is the reason the reference matters rather than
 * the bare track: LiveKit uses the publication to decide which quality
 * layer to send for the size the view is actually drawn at.
 */
export interface LiveKitTrackReference {
  participant: LiveKitParticipant;
  publication: LiveKitPublication;
  source: string;
}

/** What `POST /v1/conversations/:id/call-token` returns. */
export interface CallConnection {
  url: string;
  token: string;
  room: string;
  expires_at: number;
}

/** Connection lifecycle for a call's media. */
export type CallRoomStatus = 'idle' | 'connecting' | 'connected' | 'error';

/** Somebody on the call, including yourself. */
export interface CallParticipant {
  /** poolse user id. */
  userId: string;
  name?: string | undefined;
  isSelf: boolean;
  micEnabled: boolean;
  cameraEnabled: boolean;
  speaking: boolean;
  /**
   * The camera track, or null when their camera is off.
   *
   * Opaque on purpose — the web renderer attaches it to a `<video>`
   * element. Handing back a concrete type would force one platform's
   * renderer on the other.
   */
  videoTrack: LiveKitTrack | null;
  /**
   * The same camera track as a renderable reference, or null.
   *
   * React Native's `<VideoTrack>` needs this rather than the bare track:
   * it reads the publication to pick a quality layer matching the size
   * the view is drawn at.
   */
  videoTrackRef: LiveKitTrackReference | null;
}

export interface CallRoomOptions {
  /**
   * `livekit-client`, imported by your app. Required — see the note at
   * the top of this file about why this package cannot import it.
   */
  livekit: LiveKitModule;
  /**
   * Resolves SFU credentials for this conversation.
   *
   * Returning `null` means the deployment has no SFU configured (the API
   * answers 503), which callers treat as "fall back to the mesh" rather
   * than as an error.
   */
  tokenProvider: () => Promise<CallConnection | null>;
  /** Publish the camera on join. Audio calls start with it off. */
  video?: boolean;
  /** Start muted. */
  muted?: boolean;
}
