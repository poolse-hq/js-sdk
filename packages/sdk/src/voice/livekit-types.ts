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
  /** The browser track underneath (web) — where audio constraints are applied. */
  mediaStreamTrack?: { applyConstraints?(c: Record<string, unknown>): Promise<void> } | undefined;
  /**
   * A video effect on a local camera track (`@livekit/track-processors`).
   * Present only on local video tracks of livekit-client ≥ 1.x.
   */
  setProcessor?(processor: unknown): Promise<void>;
  stopProcessor?(): Promise<void>;
  /** The sender's WebRTC stats (local tracks), for the network diagnosis. */
  getRTCStatsReport?(): Promise<
    Iterable<[string, Record<string, unknown>]> | Map<string, Record<string, unknown>> | undefined
  >;
}

/**
 * LiveKit's view of a participant's link: `excellent` · `good` · `poor`
 * · `lost` (dropped, coming back) · `unknown`.
 */
export type CallConnectionQuality = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';

/**
 * Why the SFU connection ended, from LiveKit's `DisconnectReason`.
 * `moved` — the same user joined from another device ("move call to
 * this device"), which supersedes this one; `removed` — a host or the
 * server took you out; `left` — you hung up; `lost` — the network.
 */
export type CallDisconnectReason = 'left' | 'moved' | 'removed' | 'ended' | 'lost' | 'unknown';

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
  isScreenShareEnabled?: boolean;
  isSpeaking?: boolean;
  /**
   * LiveKit's participant kind (`'agent'`, `'egress'`, … or the
   * protocol's number). poolse's own assistant joins as an agent and is
   * left out of the roster.
   */
  kind?: unknown;
  /**
   * What the SFU lets this participant do. poolse turns `canPublish`
   * off for someone who hasn't accepted recording consent (and back on
   * when they do).
   */
  permissions?: { canPublish?: boolean } | undefined;
  /** LiveKit's `ConnectionQuality` string. */
  connectionQuality?: string | undefined;
  /** JSON metadata the server set on the token (`role`, `guest`, `display_name`…). */
  metadata?: string | undefined;
  getTrackPublication(source: string): LiveKitPublication | undefined;
}

export interface LiveKitLocalParticipant extends LiveKitParticipant {
  /**
   * `options` carries the capture constraints. It is how the call opens
   * on the front camera rather than whatever the OS picks by default,
   * which on Android is routinely the rear one.
   */
  setCameraEnabled(enabled: boolean, options?: { facingMode?: CameraFacing }): Promise<unknown>;
  setMicrophoneEnabled(
    enabled: boolean,
    options?: { noiseSuppression?: boolean; echoCancellation?: boolean; autoGainControl?: boolean },
  ): Promise<unknown>;
  /**
   * Send bytes to the others over the SFU's data channel: `reliable`
   * (ordered, retried) or lossy, to everyone or to `destinationIdentities`,
   * under a `topic`. Absent on very old builds.
   */
  publishData?(
    data: Uint8Array,
    options?: { reliable?: boolean; topic?: string; destinationIdentities?: string[] },
  ): Promise<unknown>;
  /**
   * Publish a screen or window. On the web the browser shows its own
   * picker; `audio` asks for the tab's or system's sound with it, which
   * the browser may not offer. Optional because a React Native build
   * without screen capture wired up has no such method.
   */
  setScreenShareEnabled?(enabled: boolean, options?: { audio?: boolean }): Promise<unknown>;
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

/**
 * A video effect on your camera (CL7). `blur` softens what is behind
 * you; `image` replaces it with a picture (a URL the page can load).
 */
export type CallBackground =
  | { type: 'none' }
  | { type: 'blur'; radius?: number }
  | { type: 'image'; url: string };

/**
 * `@livekit/track-processors`, imported by your app and passed in
 * (`trackProcessors` on the room options) — an optional peer, so a page
 * without it simply has no background effects:
 *
 *     import * as trackProcessors from '@livekit/track-processors';
 *
 * Structural for the same reason as {@link LiveKitModule}. Both the
 * older `BackgroundBlur` / `VirtualBackground` factories and the newer
 * `BackgroundProcessor({ mode })` are understood.
 */
export interface TrackProcessorsModule {
  BackgroundBlur?: (blurRadius?: number) => unknown;
  VirtualBackground?: (imagePath: string) => unknown;
  BackgroundProcessor?: (options: Record<string, unknown>) => unknown;
  supportsBackgroundProcessors?: () => boolean;
  supportsModernBackgroundProcessors?: () => boolean;
}

/** One reading of your own uplink, from the sender's WebRTC stats. */
export interface CallNetworkStats {
  /** Share of packets lost on the way to the SFU, 0–1 (null: not reported). */
  packetLoss: number | null;
  /** Round trip to the SFU in milliseconds. */
  rttMs: number | null;
  /** Jitter in milliseconds. */
  jitterMs: number | null;
  /** Outgoing video bitrate in kbit/s, when the camera or a screen is published. */
  videoKbps: number | null;
  /** The encoder is holding back video because of bandwidth or CPU (`qualityLimitationReason`). */
  limitedBy: 'bandwidth' | 'cpu' | null;
}

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
  /** Sharing a screen or window right now. */
  screenSharing: boolean;
  /**
   * The shared screen, or null. Separate from {@link videoTrack}: someone
   * can share with their camera on, and the two are drawn differently
   * (the screen large and uncropped, the camera as a face).
   */
  screenTrack: LiveKitTrack | null;
  /** The shared screen as a renderable reference, for React Native's `<VideoTrack>`. */
  screenTrackRef: LiveKitTrackReference | null;
  /**
   * Their link to the SFU (CL15): show a weak-signal mark on `poor`,
   * "Reconnecting…" on `lost`. `unknown` until LiveKit has measured it.
   */
  connectionQuality?: CallConnectionQuality;
  /**
   * The token's metadata the server set, parsed (`{}` when none) — a
   * stage role or a guest flag, read with `participantRoleOf`.
   */
  metadata?: Record<string, unknown>;
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
  /**
   * Republish the microphone and camera (as they were wanted) by itself
   * when the SFU gives back publish permission — after the user accepts
   * recording consent. Defaults to true; pass false to do it yourself
   * with `republish()` from `onPublishPermission`.
   */
  republishOnPermission?: boolean;
  /**
   * `@livekit/track-processors` for background blur and replacement
   * (web). Optional; without it `backgroundSupported()` is false.
   */
  trackProcessors?: TrackProcessorsModule;
  /**
   * Ask the browser for noise suppression, echo cancellation and gain
   * control on the microphone. Defaults to true (also the browser's own
   * default); `setNoiseSuppression` changes it mid-call.
   */
  noiseSuppression?: boolean;
}
