import type {
  CallConnection,
  CallParticipant,
  CallRoomOptions,
  CallRoomStatus,
  CheckedLiveKitModule,
  LiveKitParticipant,
  LiveKitRoomHandle,
  LiveKitTrack,
} from './livekit-types.js';

export type Unsubscribe = () => void;

/**
 * A call's media, carried by the LiveKit SFU.
 *
 * ## What this is not
 *
 * It is not the call. Ringing, accept/decline/hangup, presence, the
 * roster and mute state all stay on poolse's own channels — see
 * `CallsResource` and `VoiceRoom`. This object owns audio and video
 * packets and nothing else. A client joins both: `voice:conversation:<id>`
 * for who is here and what they are doing, this for what they sound and
 * look like.
 *
 * ## Why an SFU rather than the mesh
 *
 * {@link VoiceRoom} connects every participant to every other one, so
 * each uploads N-1 encoded copies of their own camera. At four people
 * that is roughly 3 Mbps of sustained upload from a phone plus three
 * simultaneous encodes — the handset overheats, iOS throttles, and
 * quality collapses for everyone. Audio survives it because Opus is
 * ~25x cheaper; video does not.
 *
 * The SFU also makes the mid-call camera toggle tractable. Turning a
 * camera on mid-call means renegotiating a live peer connection, which
 * the mesh cannot do — it offers once, on peer discovery. Here it is
 * `setCameraEnabled`.
 *
 * ## Availability
 *
 * A deployment with no SFU configured answers 503, which arrives as
 * `tokenProvider` returning `null`. That is not an error: the caller
 * falls back to the mesh, which is what every call used before this
 * existed. `join()` resolves `false` to say so.
 */
export class CallRoom {
  private readonly livekit: CheckedLiveKitModule;
  private readonly tokenProvider: () => Promise<CallConnection | null>;
  private readonly startWithVideo: boolean;
  private readonly startMuted: boolean;

  private room: LiveKitRoomHandle | null = null;
  private status: CallRoomStatus = 'idle';
  private selfId: string | null = null;

  // Reference counted like VoiceRoom: a call screen and a roster can
  // both hold the same call, and the second holder must not open a
  // second SFU connection or tear the first one down on leaving.
  private holders = 0;

  private readonly statusListeners = new Set<(status: CallRoomStatus) => void>();
  private readonly participantListeners = new Set<(participants: CallParticipant[]) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();

  /** Bound once so `off()` in teardown removes the same references. */
  private readonly onRoomChange = () => this.emitParticipants();

  /**
   * Hidden `<audio>` elements playing each remote audio track.
   *
   * livekit-client does NOT play remote audio for you on the web — that
   * is what `@livekit/components-react`'s `<RoomAudioRenderer />` exists
   * to do. Without this a call connects, the roster is right, video
   * flows, and nobody hears anything. The peer-to-peer mesh always did
   * this (see `webrtc-browser.ts`); the SFU path has to as well.
   *
   * Empty on React Native, where there is no DOM and LiveKit routes
   * audio through the native audio session instead.
   */
  private readonly audioSinks = new Map<LiveKitTrack, HTMLMediaElement>();

  constructor(opts: CallRoomOptions) {
    // Narrow once, here, rather than making every caller's module match
    // signature-for-signature — see the note on `LiveKitModule`.
    this.livekit = opts.livekit as unknown as CheckedLiveKitModule;
    this.tokenProvider = opts.tokenProvider;
    this.startWithVideo = opts.video ?? false;
    this.startMuted = opts.muted ?? false;
  }

  // ── observation ─────────────────────────────────────────────────────

  getStatus(): CallRoomStatus {
    return this.status;
  }

  onStatus(fn: (status: CallRoomStatus) => void): Unsubscribe {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  onParticipants(fn: (participants: CallParticipant[]) => void): Unsubscribe {
    this.participantListeners.add(fn);
    return () => this.participantListeners.delete(fn);
  }

  onError(fn: (error: Error) => void): Unsubscribe {
    this.errorListeners.add(fn);
    return () => this.errorListeners.delete(fn);
  }

  getParticipants(): CallParticipant[] {
    if (!this.room) return [];

    const self = this.toParticipant(this.room.localParticipant, true);
    const others = [...this.room.remoteParticipants.values()].map((p) =>
      this.toParticipant(p, false),
    );

    return [self, ...others];
  }

  // ── lifecycle ───────────────────────────────────────────────────────

  /**
   * Connect to the SFU.
   *
   * Resolves `true` once media is flowing, `false` when the deployment
   * has no SFU — the caller should fall back to the mesh rather than
   * treat that as a failed call.
   */
  async join(): Promise<boolean> {
    if (this.room) {
      this.holders += 1;
      return true;
    }

    this.holders += 1;
    this.setStatus('connecting');

    let connection: CallConnection | null;
    try {
      connection = await this.tokenProvider();
    } catch (err) {
      this.holders = Math.max(0, this.holders - 1);
      this.setStatus('error');
      const error = new Error(`call token unavailable: ${String(err)}`);
      this.emitError(error);
      throw error;
    }

    if (!connection) {
      // No SFU configured. Not an error, and deliberately distinguishable
      // from one so the caller can fall back instead of telling the user
      // their call failed.
      this.holders = Math.max(0, this.holders - 1);
      this.setStatus('idle');
      return false;
    }

    const room = new this.livekit.Room({
      // Let LiveKit drop video layers before it drops the call. On a
      // phone leaving wifi this is the difference between the picture
      // degrading and the call ending.
      adaptiveStream: true,
      dynacast: true,
    });
    this.room = room;
    this.bind(room);

    try {
      await room.connect(connection.url, connection.token);
      this.selfId = room.localParticipant.identity;

      // Publish AFTER connecting: publishing first would acquire the
      // camera and microphone before we know the room will accept us,
      // leaving the capture indicator lit on a call that never happened.
      await room.localParticipant.setMicrophoneEnabled(!this.startMuted);
      if (this.startWithVideo) await room.localParticipant.setCameraEnabled(true);

      // Browsers keep audio silent until the page has seen a user
      // gesture. Answering a call is one, so this normally resolves
      // immediately — but if it doesn't, a call that connects and plays
      // nothing is indistinguishable from a broken one.
      try {
        await room.startAudio?.();
      } catch {
        // Still blocked. The next tap anywhere in the app releases it,
        // and failing the whole call over it would be far worse.
      }

      this.setStatus('connected');
      this.emitParticipants();
      return true;
    } catch (err) {
      this.holders = Math.max(0, this.holders - 1);
      this.setStatus('error');
      const error = new Error(`call media failed: ${String(err)}`);
      this.emitError(error);
      await this.teardown();
      throw error;
    }
  }

  /** Release one holder; disconnects once none are left. */
  leave(): void {
    this.holders = Math.max(0, this.holders - 1);
    if (this.holders > 0) return;
    void this.teardown();
  }

  // ── media controls ──────────────────────────────────────────────────

  /**
   * Turn the camera on or off mid-call.
   *
   * Off genuinely stops publishing rather than sending black frames, so
   * the capture indicator goes out and the uplink is freed. LiveKit
   * renegotiates underneath.
   */
  async setCameraEnabled(enabled: boolean): Promise<void> {
    await this.withLocal((local) => local.setCameraEnabled(enabled), 'camera');
  }

  /** Mute or unmute the microphone. */
  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    await this.withLocal((local) => local.setMicrophoneEnabled(enabled), 'microphone');
  }

  isCameraEnabled(): boolean {
    return this.room?.localParticipant.isCameraEnabled ?? false;
  }

  isMicrophoneEnabled(): boolean {
    return this.room?.localParticipant.isMicrophoneEnabled ?? false;
  }

  // ── internals ───────────────────────────────────────────────────────

  private async withLocal(
    fn: (local: LiveKitRoomHandle['localParticipant']) => Promise<unknown>,
    what: string,
  ): Promise<void> {
    const room = this.room;
    if (!room) return;

    try {
      await fn(room.localParticipant);
      this.emitParticipants();
    } catch (err) {
      // A refused camera must not end the call — the user can carry on
      // talking, and the roster will show their camera as off.
      this.emitError(new Error(`could not change ${what}: ${String(err)}`));
    }
  }

  private bind(room: LiveKitRoomHandle): void {
    const { RoomEvent } = this.livekit;

    // Every one of these changes what the roster should show. Rather
    // than diffing, each re-reads the room — the participant count in a
    // call is small, and a wrong roster is worse than a cheap rebuild.
    for (const event of [
      RoomEvent['ParticipantConnected'],
      RoomEvent['ParticipantDisconnected'],
      RoomEvent['TrackSubscribed'],
      RoomEvent['TrackUnsubscribed'],
      RoomEvent['TrackMuted'],
      RoomEvent['TrackUnmuted'],
      RoomEvent['LocalTrackPublished'],
      RoomEvent['LocalTrackUnpublished'],
      RoomEvent['ActiveSpeakersChanged'],
      RoomEvent['ParticipantNameChanged'],
    ]) {
      if (event) room.on(event, this.onRoomChange);
    }

    // Remote audio playback. Separate from the roster handlers above
    // because these need the track itself, not just a nudge to re-read
    // the room.
    const subscribed = RoomEvent['TrackSubscribed'];
    if (subscribed) {
      room.on(subscribed, ((track: LiveKitTrack) => this.playAudio(track)) as never);
    }

    const unsubscribed = RoomEvent['TrackUnsubscribed'];
    if (unsubscribed) {
      room.on(unsubscribed, ((track: LiveKitTrack) => this.stopAudio(track)) as never);
    }

    const disconnected = RoomEvent['Disconnected'];
    if (disconnected) {
      room.on(disconnected, () => {
        // The SFU dropped us. Reflect it rather than showing a call that
        // looks live and carries nothing.
        this.setStatus('idle');
        this.emitParticipants();
      });
    }
  }

  /**
   * Play a remote audio track through a hidden element.
   *
   * No-ops for video (the UI renders that) and on React Native, where
   * there is no `document` and the native audio session handles
   * playback.
   */
  private playAudio(track: LiveKitTrack): void {
    if (typeof document === 'undefined') return;
    if (track?.kind !== 'audio' || typeof track.attach !== 'function') return;
    if (this.audioSinks.has(track)) return;

    try {
      const element = track.attach();
      element.autoplay = true;
      // In the DOM (required for playback) but never laid out.
      element.style.display = 'none';
      document.body.appendChild(element);
      this.audioSinks.set(track, element);
    } catch (err) {
      this.emitError(new Error(`could not play remote audio: ${String(err)}`));
    }
  }

  /** Tear a sink down, so a departed peer stops holding an element. */
  private stopAudio(track: LiveKitTrack): void {
    const element = this.audioSinks.get(track);
    if (!element) return;

    this.audioSinks.delete(track);
    try {
      track.detach?.(element);
    } catch {
      // Already detached by LiveKit; removing the element is what counts.
    }
    element.remove();
  }

  private toParticipant(participant: LiveKitParticipant, isSelf: boolean): CallParticipant {
    const cameraSource = this.livekit.Track.Source['Camera'] ?? 'camera';
    const publication = participant.getTrackPublication(cameraSource);

    // A publication with a muted or absent track is a camera that is
    // off. Handing back the track anyway would render a frozen last
    // frame, which reads as a stalled call.
    const live = publication && !publication.isMuted && publication.track ? publication : null;
    const videoTrack: LiveKitTrack | null = live?.track ?? null;

    return {
      userId: participant.identity,
      name: participant.name,
      isSelf,
      micEnabled: participant.isMicrophoneEnabled ?? false,
      cameraEnabled: participant.isCameraEnabled ?? false,
      speaking: participant.isSpeaking ?? false,
      videoTrack,
      videoTrackRef: live ? { participant, publication: live, source: cameraSource } : null,
    };
  }

  private async teardown(): Promise<void> {
    const room = this.room;
    this.room = null;
    this.selfId = null;
    this.holders = 0;

    for (const track of [...this.audioSinks.keys()]) this.stopAudio(track);

    if (room) {
      try {
        await room.disconnect();
      } catch {
        // Already gone. Disconnecting twice is not an error worth
        // surfacing to a user who has already hung up.
      }
    }

    this.setStatus('idle');
    this.emitParticipants();
  }

  private setStatus(status: CallRoomStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const fn of this.statusListeners) fn(status);
  }

  private emitParticipants(): void {
    const participants = this.getParticipants();
    for (const fn of this.participantListeners) fn(participants);
  }

  private emitError(error: Error): void {
    for (const fn of this.errorListeners) fn(error);
  }

  /** The local participant's poolse user id, once connected. */
  getSelfId(): string | null {
    return this.selfId;
  }
}
