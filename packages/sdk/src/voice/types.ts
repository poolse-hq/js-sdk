/**
 * Voice types shared by the room (Discord-style "join voice") and call
 * (WhatsApp-style ringing) surfaces.
 *
 * The WebRTC pieces are declared structurally rather than as the DOM's
 * concrete `RTCPeerConnection`, so React Native can hand us
 * `react-native-webrtc` — API-compatible, different classes — through
 * {@link WebRtcAdapter} without the SDK importing anything native.
 */

/** Connection lifecycle for a voice room. */
export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'error';

/** Someone currently in a voice room, including yourself. */
export interface VoiceParticipant {
  userId: string;
  muted: boolean;
  speaking: boolean;
  /** ms epoch from presence metadata; stable ordering key for rosters. */
  joinedAt: number;
  /** True for the local participant. */
  isSelf: boolean;
}

// ── WebRTC seam ──────────────────────────────────────────────────────

/** The subset of `MediaStreamTrack` the SDK touches. */
export interface VoiceTrack {
  kind: string;
  enabled: boolean;
  stop(): void;
}

/** The subset of `MediaStream` the SDK touches. */
export interface VoiceStream {
  id: string;
  getTracks(): VoiceTrack[];
  getAudioTracks(): VoiceTrack[];
}

/** Session description exchanged during negotiation. */
export interface VoiceDescription {
  type: string;
  sdp?: string | undefined;
}

/** ICE candidate in its wire (JSON) form. */
export interface VoiceCandidate {
  candidate?: string | undefined;
  sdpMid?: string | null | undefined;
  sdpMLineIndex?: number | null | undefined;
  usernameFragment?: string | null | undefined;
}

/** The subset of `RTCPeerConnection` the SDK drives. */
export interface VoicePeerConnection {
  addTrack(track: VoiceTrack, stream: VoiceStream): unknown;
  createOffer(): Promise<VoiceDescription>;
  createAnswer(): Promise<VoiceDescription>;
  setLocalDescription(description: VoiceDescription): Promise<void>;
  setRemoteDescription(description: VoiceDescription): Promise<void>;
  addIceCandidate(candidate: VoiceCandidate): Promise<void>;
  close(): void;
  readonly remoteDescription: VoiceDescription | null;
  onicecandidate: ((event: { candidate: VoiceCandidate | null }) => void) | null;
  ontrack: ((event: { streams: readonly VoiceStream[] }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  readonly connectionState: string;
}

/**
 * Platform binding for WebRTC. The browser default is built in; React
 * Native supplies one backed by `react-native-webrtc`.
 */
export interface WebRtcAdapter {
  createPeerConnection(iceServers: VoiceIceServer[]): VoicePeerConnection;
  getUserMedia(): Promise<VoiceStream>;
  /**
   * Attach a remote stream to a playback sink. The browser adapter
   * creates a hidden `<audio>` element; React Native returns the stream
   * URL for an `<RTCView>`. Returning a disposer keeps the room from
   * leaking sinks when a peer leaves.
   */
  playRemoteStream(peerId: string, stream: VoiceStream): () => void;
}

export interface VoiceIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

// ── room options ─────────────────────────────────────────────────────

export interface VoiceRoomOptions {
  /**
   * ICE servers for peer connections. Defaults to a public STUN server,
   * which is enough when peers can reach each other directly — add a
   * TURN server for participants behind symmetric NAT.
   */
  iceServers?: VoiceIceServer[];
  /** Platform WebRTC binding. Defaults to the browser implementation. */
  webrtc?: WebRtcAdapter;
  /**
   * Disable local speaking detection. On by default; turn it off if the
   * host app drives the indicator itself.
   */
  detectSpeaking?: boolean;
}

// ── call (ringing) types ─────────────────────────────────────────────

/** An inbound ring, delivered on the user's own channel. */
export interface IncomingCall {
  callId: string;
  conversationId: string;
  callerUserId: string;
}

/** The far side answered; both parties should now join the room. */
export interface CallAccepted {
  callId: string;
  conversationId: string;
  /** Who accepted. */
  userId: string;
}

/** The far side declined. */
export interface CallDeclined {
  callId: string;
  conversationId: string;
  userId: string;
}

/** The caller hung up before anyone answered. */
export interface CallCancelled {
  callId: string;
  conversationId: string;
  callerUserId: string;
}

/** Result of placing a call. */
export interface OutgoingCall {
  callId: string;
  conversationId: string;
  /** Everyone who was rung — the conversation's members, minus you. */
  calleeUserIds: string[];
}
