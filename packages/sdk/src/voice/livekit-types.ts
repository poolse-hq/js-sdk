/**
 * Structural types for `livekit-client`.
 *
 * Declared here rather than imported because the module is passed IN by
 * the app. tsup rewrites a literal
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

/**
 * A media track.
 *
 * Mostly opaque — the platform renderer consumes video. Audio is the
 * exception: {@link CallRoom} attaches it itself on the web, because
 * livekit-client does not play remote audio for you.
 */
export interface LiveKitTrack {
  kind?: string;
  attach?: () => HTMLMediaElement;
  detach?: (element?: HTMLMediaElement) => unknown;
}

export interface LiveKitPublication {
  track?: LiveKitTrack | null | undefined;
  isMuted?: boolean;
  isSubscribed?: boolean;
  /**
   * The same track typed as video, when it is one.
   *
   * Separate from `track` because only this side carries
   * `restartTrack`, which is how the camera is flipped: LiveKit
   * re-acquires the capture device under the existing publication, so
   * the far side sees the picture change without a renegotiation and
   * without the tile blanking.
   */
  videoTrack?: LiveKitLocalVideoTrack | null | undefined;
}

/** Which camera a video track is capturing from. */
export type CameraFacing = 'user' | 'environment';

/**
 * A class of media device.
 *
 * Spelled out rather than reusing the DOM's `MediaDeviceKind` so the
 * type means the same thing on React Native, where there is no DOM but
 * `audiooutput` is still a real concept.
 */
export type CallDeviceKind = 'videoinput' | 'audioinput' | 'audiooutput';

/** A selectable input or output. */
export interface CallDevice {
  deviceId: string;
  kind: CallDeviceKind;
  /**
   * The browser's own label, e.g. "FaceTime HD Camera".
   *
   * Empty until the page holds a matching permission — the browser
   * withholds labels from sites that have never been granted the
   * device, precisely so they cannot be fingerprinted. In a call that
   * permission is already held, so labels are normally present.
   */
  label: string;
}

/** The slice of LiveKit's `LocalVideoTrack` used to flip the camera. */
export interface LiveKitLocalVideoTrack {
  restartTrack?(constraints?: { facingMode?: CameraFacing; deviceId?: string }): Promise<unknown>;
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
  /**
   * `options` carries the capture constraints. It is how the call opens
   * on the front camera rather than whatever the OS picks by default,
   * which on Android is routinely the rear one.
   */
  setCameraEnabled(enabled: boolean, options?: { facingMode?: CameraFacing }): Promise<unknown>;
  setMicrophoneEnabled(enabled: boolean): Promise<unknown>;
}

export interface LiveKitRoomHandle {
  localParticipant: LiveKitLocalParticipant;
  /**
   * Move every track of `kind` onto another device.
   *
   * `audiooutput` is the web's answer to a speakerphone button: it
   * re-points every incoming audio element with `setSinkId`. Not every
   * browser implements it, which is why the result is a boolean rather
   * than a throw.
   */
  switchActiveDevice?(kind: string, deviceId: string, exact?: boolean): Promise<unknown>;
  getActiveDevice?(kind: string): string | undefined;
  /** Keyed by identity. `remoteParticipants` is the v2 name. */
  remoteParticipants: Map<string, LiveKitParticipant>;
  connect(url: string, token: string, options?: unknown): Promise<void>;
  disconnect(): Promise<void>;
  /**
   * Unblocks audio playback held back by a browser's autoplay policy.
   *
   * Optional because only the web needs it — React Native routes through
   * the native audio session and has nothing to unblock.
   */
  startAudio?(): Promise<void>;
  on(event: string, handler: (...args: never[]) => void): unknown;
  off(event: string, handler: (...args: never[]) => void): unknown;
}

/**
 * The `livekit-client` namespace, as imported by your app:
 *
 *     import * as livekit from 'livekit-client';
 *
 * Deliberately loose, for the same reason `NativeWebRtcModule` is.
 * Spelling the real signatures out here does NOT work: `Room`'s
 * constructor takes `RoomOptions`, and a constructor accepting
 * `RoomOptions` is not assignable to one accepting `unknown` —
 * parameters are contravariant. Declaring it precisely means no consumer
 * can pass `import * as livekit` in at all.
 *
 * {@link CheckedLiveKitModule} is the precise shape, narrowed once
 * inside `CallRoom` rather than at every call site.
 */
export interface LiveKitModule {
  Room: new (...args: never[]) => unknown;
  RoomEvent: Record<string, string>;
  Track: { Source: Record<string, string> };
}

/** The precise shape, used internally once the module has been checked. */
export interface CheckedLiveKitModule {
  Room: (new (options?: { adaptiveStream?: boolean; dynacast?: boolean }) => LiveKitRoomHandle) & {
    /**
     * Enumerates devices, prompting for permission if needed.
     *
     * Optional because it is a static on livekit-client's `Room`, and
     * `CallRoom` falls back to `navigator.mediaDevices` where it is
     * absent rather than losing the picker entirely.
     *
     * Typed as the raw device shape, NOT as {@link CallDevice}. These
     * are `MediaDeviceInfo` instances, whose fields are accessors on the
     * prototype — declaring them as plain objects invites the spread
     * that silently loses every id and label.
     */
    getLocalDevices?(
      kind?: string,
      requestPermissions?: boolean,
    ): Promise<readonly { deviceId?: string; kind?: string; label?: string }[]>;
  };
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
   * answers 503): calls are unavailable, which callers show as such
   * rather than as an error.
   */
  tokenProvider: () => Promise<CallConnection | null>;
  /** Publish the camera on join. Audio calls start with it off. */
  video?: boolean;
  /** Start muted. */
  muted?: boolean;
  /**
   * Which camera to open with. Defaults to the front one — a call is a
   * conversation, so the selfie camera is what anyone expects.
   */
  facing?: CameraFacing;
  /**
   * How long the last participant may sit alone before the call is
   * declared over, in milliseconds. Defaults to 1500. Pass `0` to
   * disable and keep the call open indefinitely.
   *
   * The delay is not cosmetic. Two people hanging up within a frame of
   * each other, or an SFU reconnect that briefly empties the roster,
   * would both otherwise trip an immediate check — and a call that ends
   * itself during a half-second blip is worse than one that lingers.
   */
  aloneGraceMs?: number;
}
