/**
 * A voice room bound to one conversation.
 *
 * Wraps poolse's `voice:conversation:<id>` channel and drives a WebRTC
 * mesh over it: one peer connection per participant, negotiated with
 * offer / answer / ICE relayed by the server.
 *
 * Two shapes are built on this:
 *
 *   * Discord-style — call `join()` directly and everyone in the room
 *     hears each other.
 *   * WhatsApp-style — ring first via `poolse.calls`, then both sides
 *     `join()` once the callee accepts.
 *
 * A mesh costs each participant N-1 upstreams, which is fine for small
 * rooms and wrong past roughly six concurrent speakers; that's where an
 * SFU belongs.
 */

import type { Channel, Socket } from 'phoenix';

import type {
  VoiceCandidate,
  VoiceIceServer,
  VoiceParticipant,
  VoicePeerConnection,
  VoiceRoomOptions,
  VoiceStatus,
  VoiceStream,
  VoiceTrack,
  WebRtcAdapter,
} from './types.js';
import { createBrowserWebRtcAdapter } from './webrtc-browser.js';

export type Unsubscribe = () => void;

const DEFAULT_ICE_SERVERS: VoiceIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/** RMS above this counts as speech. */
const SPEAKING_THRESHOLD = 0.02;
/** Keep "speaking" latched this long after the level drops, so the
 *  indicator doesn't strobe between syllables. */
const SPEAKING_RELEASE_MS = 350;
const SPEAKING_POLL_MS = 100;

/** Phoenix.Presence payload shape. */
interface PresenceEntry {
  metas?: Array<{
    user_id?: string;
    mute_state?: boolean;
    speaking_state?: boolean;
    joined_at?: number;
  }>;
}

export class VoiceRoom {
  public readonly conversationId: string;

  private readonly socket: Socket;
  private readonly webrtc: WebRtcAdapter;
  private iceServers: VoiceIceServer[];
  private readonly iceServersProvider: (() => Promise<VoiceIceServer[]>) | null;
  private readonly detectSpeaking: boolean;

  private channel: Channel | null = null;
  private localStream: VoiceStream | null = null;
  private selfId: string | null = null;
  private status: VoiceStatus = 'idle';
  private muted = false;

  private readonly peers = new Map<string, VoicePeerConnection>();
  private readonly sinks = new Map<string, Unsubscribe>();
  /** Candidates that landed before their offer/answer did. */
  private readonly pendingIce = new Map<string, VoiceCandidate[]>();
  private readonly roster = new Map<string, Omit<VoiceParticipant, 'isSelf'>>();

  /**
   * How many callers currently hold this room open.
   *
   * `PoolseRealtime` hands out ONE room per conversation, so a call
   * screen and an always-on voice bar for the same conversation share
   * this instance — which is correct, since a user is in one audio
   * session, not two. Without counting, whichever of them tore down
   * first would cut the audio out from under the other.
   */
  private holders = 0;

  private speakingTimer: ReturnType<typeof setInterval> | null = null;
  private stopSpeakingDetection: Unsubscribe | null = null;

  private readonly statusListeners = new Set<(s: VoiceStatus) => void>();
  private readonly rosterListeners = new Set<(p: VoiceParticipant[]) => void>();
  private readonly errorListeners = new Set<(e: Error) => void>();

  constructor(conversationId: string, socket: Socket, opts: VoiceRoomOptions = {}) {
    this.conversationId = conversationId;
    this.socket = socket;
    this.webrtc = opts.webrtc ?? createBrowserWebRtcAdapter();
    this.iceServers = opts.iceServers ?? DEFAULT_ICE_SERVERS;
    this.iceServersProvider = opts.iceServersProvider ?? null;
    this.detectSpeaking = opts.detectSpeaking ?? true;
  }

  // ── observation ────────────────────────────────────────────────────

  getStatus(): VoiceStatus {
    return this.status;
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** Everyone in the room, oldest join first. */
  getParticipants(): VoiceParticipant[] {
    return [...this.roster.values()]
      .map((p) => ({ ...p, isSelf: p.userId === this.selfId }))
      .sort((a, b) => a.joinedAt - b.joinedAt || a.userId.localeCompare(b.userId));
  }

  onStatus(fn: (status: VoiceStatus) => void): Unsubscribe {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn) as unknown as void;
  }

  onParticipants(fn: (participants: VoiceParticipant[]) => void): Unsubscribe {
    this.rosterListeners.add(fn);
    return () => this.rosterListeners.delete(fn) as unknown as void;
  }

  onError(fn: (err: Error) => void): Unsubscribe {
    this.errorListeners.add(fn);
    return () => this.errorListeners.delete(fn) as unknown as void;
  }

  // ── lifecycle ──────────────────────────────────────────────────────

  /** Acquire the mic, join the channel, and start negotiating. */
  async join(): Promise<void> {
    // Already in the room: record the extra holder and reuse the
    // session rather than opening a second channel and mesh.
    if (this.channel) {
      this.holders += 1;
      return;
    }

    this.holders += 1;
    this.setStatus('connecting');

    // Resolved per join, not per construction: TURN credentials expire,
    // so a list fetched once and reused would be rejected by the second
    // call. This is also the only await before peers are created, which
    // matters — `ensurePeer` reads `iceServers` synchronously.
    await this.resolveIceServers();

    try {
      this.localStream = await this.webrtc.getUserMedia();
    } catch (err) {
      this.holders = Math.max(0, this.holders - 1);
      this.setStatus('error');
      this.emitError(new Error(`microphone unavailable: ${String(err)}`));
      throw err;
    }

    const channel = this.socket.channel(`voice:conversation:${this.conversationId}`, {});
    this.channel = channel;
    this.bindChannel(channel);

    await new Promise<void>((resolve, reject) => {
      channel
        .join()
        .receive('ok', () => {
          channel.push('voice:join', { muted: false, speaking: false });
          resolve();
        })
        .receive('error', (reply: { reason?: string }) => {
          const err = new Error(`voice join rejected: ${reply?.reason ?? 'unknown'}`);
          this.setStatus('error');
          this.emitError(err);
          this.teardown();
          reject(err);
        })
        .receive('timeout', () => {
          const err = new Error('voice join timed out');
          this.setStatus('error');
          this.emitError(err);
          this.teardown();
          reject(err);
        });
    });
  }

  /** Announce departure, then drop every peer connection and the mic. */
  leave(): void {
    if (this.holders > 0) this.holders -= 1;

    // Someone else still has the room open — hanging up a call must not
    // silence the voice bar the user is also sitting in.
    if (this.holders > 0) return;

    this.channel?.push('voice:leave', {});
    this.teardown();
    this.setStatus('idle');
  }

  /** Mute or unmute the local mic. Returns the new muted state. */
  setMuted(muted: boolean): boolean {
    this.muted = muted;
    for (const track of this.localStream?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
    this.channel?.push(muted ? 'voice:mute' : 'voice:unmute', { muted });

    if (this.selfId) {
      const self = this.roster.get(this.selfId);
      // Muting also clears the speaking flag: a muted mic that was
      // mid-word would otherwise stay lit until the next transition.
      if (self) this.roster.set(this.selfId, { ...self, muted, speaking: false });
      this.emitRoster();
    }
    return this.muted;
  }

  toggleMute(): boolean {
    return this.setMuted(!this.muted);
  }

  // ── channel wiring ─────────────────────────────────────────────────

  private bindChannel(channel: Channel): void {
    channel.on('voice:presence_state', (state: Record<string, PresenceEntry>) => {
      this.roster.clear();
      for (const [userId, entry] of Object.entries(state ?? {})) {
        const meta = entry?.metas?.[0] ?? {};
        this.roster.set(userId, {
          userId,
          muted: meta.mute_state ?? false,
          speaking: meta.speaking_state ?? false,
          joinedAt: meta.joined_at ?? 0,
        });
      }
      this.emitRoster();

      for (const userId of this.roster.keys()) {
        if (userId !== this.selfId) this.startNegotiation(userId);
      }
    });

    channel.on('voice:joined', (payload: { user_id?: string }) => {
      const userId = payload?.user_id;
      if (!userId) return;

      // The server pushes this to us before broadcasting it to the room,
      // so the first one we see identifies us.
      if (!this.selfId) {
        this.selfId = userId;
        this.roster.set(userId, { userId, muted: false, speaking: false, joinedAt: Date.now() });
        this.setStatus('connected');
        if (this.detectSpeaking && this.localStream) {
          this.startSpeakingDetection(this.localStream);
        }
        this.emitRoster();
        return;
      }

      if (userId === this.selfId) return;

      if (!this.roster.has(userId)) {
        this.roster.set(userId, { userId, muted: false, speaking: false, joinedAt: Date.now() });
        this.emitRoster();
      }
      this.startNegotiation(userId);
    });

    channel.on('voice:left', (payload: { user_id?: string }) => {
      const userId = payload?.user_id;
      if (!userId) return;
      this.closePeer(userId);
      this.roster.delete(userId);
      this.emitRoster();
    });

    channel.on('voice:mute', (payload: { user_id?: string; muted?: boolean }) => {
      this.patchParticipant(payload?.user_id, { muted: payload?.muted ?? false });
    });

    channel.on('voice:active_speaker', (payload: { user_id?: string; speaking?: boolean }) => {
      this.patchParticipant(payload?.user_id, { speaking: payload?.speaking ?? false });
    });

    channel.on('voice:signal', (payload: Record<string, unknown>) => {
      void this.handleSignal(payload);
    });

    channel.on('voice:error', (payload: { reason?: string }) => {
      this.emitError(new Error(`voice error: ${payload?.reason ?? 'unknown'}`));
    });
  }

  /**
   * Refresh ICE servers from the provider, if there is one.
   *
   * Never throws. A room that refused to connect because the ICE
   * endpoint was briefly unreachable would be a worse outcome than one
   * that connects without TURN — which is exactly how calls behaved
   * before TURN existed, and works on most networks.
   */
  private async resolveIceServers(): Promise<void> {
    if (!this.iceServersProvider) return;

    try {
      const servers = await this.iceServersProvider();
      if (servers.length > 0) this.iceServers = servers;
    } catch (err) {
      this.emitError(new Error(`ice servers unavailable, continuing without: ${String(err)}`));
    }
  }

  // ── negotiation ────────────────────────────────────────────────────

  /**
   * Glare control: both sides learn about each other simultaneously, so
   * without a rule both would offer at once. The lexicographically lower
   * user id offers and the higher answers — deterministic, no extra
   * round trip.
   */
  private shouldOffer(peerId: string): boolean {
    return this.selfId != null && this.selfId < peerId;
  }

  private startNegotiation(peerId: string): void {
    const pc = this.ensurePeer(peerId);
    if (!this.shouldOffer(peerId)) return;

    void (async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.sendSignal('offer', peerId, { sdp: offer.sdp });
      } catch (err) {
        // One failed peer must not take the room down.
        this.emitError(new Error(`offer to ${peerId} failed: ${String(err)}`));
      }
    })();
  }

  private ensurePeer(peerId: string): VoicePeerConnection {
    const existing = this.peers.get(peerId);
    if (existing) return existing;

    const pc = this.webrtc.createPeerConnection(this.iceServers);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.sendSignal('ice-candidate', peerId, event.candidate);
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;
      this.sinks.get(peerId)?.();
      this.sinks.set(peerId, this.webrtc.playRemoteStream(peerId, stream));
    };

    this.peers.set(peerId, pc);
    return pc;
  }

  private async handleSignal(payload: Record<string, unknown>): Promise<void> {
    const from = payload['from_user_id'] as string | undefined;
    const type = payload['type'] as string | undefined;
    if (!from || !type || from === this.selfId) return;

    // The channel broadcasts to the whole room, so drop directed signals
    // addressed to somebody else.
    const target = payload['target_user_id'] as string | undefined;
    if (target && target !== this.selfId) return;

    const data = (payload['data'] ?? {}) as Record<string, unknown>;
    const pc = this.ensurePeer(from);

    try {
      if (type === 'offer') {
        await pc.setRemoteDescription({ type: 'offer', sdp: data['sdp'] as string });
        await this.flushIce(pc, from);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.sendSignal('answer', from, { sdp: answer.sdp });
      } else if (type === 'answer') {
        await pc.setRemoteDescription({ type: 'answer', sdp: data['sdp'] as string });
        await this.flushIce(pc, from);
      } else if (type === 'ice-candidate') {
        const candidate = data as VoiceCandidate;
        // Candidates routinely outrun the description they belong to,
        // and addIceCandidate throws in that state. Queue rather than
        // drop: a lost candidate can strand ICE, leaving a room that
        // looks connected but carries no audio.
        if (!pc.remoteDescription) {
          const queued = this.pendingIce.get(from) ?? [];
          queued.push(candidate);
          this.pendingIce.set(from, queued);
        } else {
          await pc.addIceCandidate(candidate);
        }
      }
    } catch (err) {
      this.emitError(new Error(`signal (${type}) from ${from} failed: ${String(err)}`));
    }
  }

  private async flushIce(pc: VoicePeerConnection, peerId: string): Promise<void> {
    const queued = this.pendingIce.get(peerId);
    if (!queued?.length) return;
    this.pendingIce.delete(peerId);
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // A single stale candidate shouldn't abort the rest.
      }
    }
  }

  /**
   * Every signal body travels under `data` — the server's
   * `validate_signal_data/1` rejects the push outright when that key is
   * missing or empty, and a rejected signal is never relayed.
   */
  private sendSignal(type: string, targetUserId: string, data: unknown): void {
    this.channel?.push('voice:signal', { type, target_user_id: targetUserId, data });
  }

  // ── speaking detection ─────────────────────────────────────────────

  private startSpeakingDetection(stream: VoiceStream): void {
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    // React Native has no Web Audio; hosts there drive the indicator
    // themselves (or leave it off).
    if (!Ctor) return;

    const ctx = new Ctor();
    const source = ctx.createMediaStreamSource(stream as unknown as MediaStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const buf = new Float32Array(analyser.fftSize);
    let speaking = false;
    let lastLoud = 0;

    this.speakingTimer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);

      const now = Date.now();
      if (!this.muted && rms > SPEAKING_THRESHOLD) lastLoud = now;
      const next = !this.muted && now - lastLoud < SPEAKING_RELEASE_MS;
      if (next === speaking) return;

      speaking = next;
      // Only transitions go on the wire — a per-frame push would be a
      // flood for something that changes a few times a second.
      this.channel?.push('voice:active_speaker', { speaking });
      this.patchParticipant(this.selfId ?? undefined, { speaking });
    }, SPEAKING_POLL_MS);

    this.stopSpeakingDetection = () => {
      void ctx.close().catch(() => {});
    };
  }

  // ── teardown & emit ────────────────────────────────────────────────

  private closePeer(peerId: string): void {
    const pc = this.peers.get(peerId);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
      this.peers.delete(peerId);
    }
    this.sinks.get(peerId)?.();
    this.sinks.delete(peerId);
    this.pendingIce.delete(peerId);
  }

  private teardown(): void {
    // Reached by leave() at zero holders and by a failed join; either
    // way nobody is holding the room once it runs.
    this.holders = 0;

    for (const peerId of [...this.peers.keys()]) this.closePeer(peerId);

    if (this.speakingTimer) clearInterval(this.speakingTimer);
    this.speakingTimer = null;
    this.stopSpeakingDetection?.();
    this.stopSpeakingDetection = null;

    for (const track of this.localStream?.getTracks() ?? []) track.stop();
    this.localStream = null;

    this.channel?.leave();
    this.channel = null;

    this.selfId = null;
    this.muted = false;
    this.roster.clear();
    this.emitRoster();
  }

  private patchParticipant(
    userId: string | undefined,
    patch: Partial<Omit<VoiceParticipant, 'isSelf' | 'userId'>>,
  ): void {
    if (!userId) return;
    const current = this.roster.get(userId);
    if (!current) return;
    this.roster.set(userId, { ...current, ...patch });
    this.emitRoster();
  }

  private setStatus(status: VoiceStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }

  private emitRoster(): void {
    const snapshot = this.getParticipants();
    this.rosterListeners.forEach((l) => l(snapshot));
  }

  private emitError(err: Error): void {
    this.errorListeners.forEach((l) => l(err));
  }
}

export type { VoiceTrack };
