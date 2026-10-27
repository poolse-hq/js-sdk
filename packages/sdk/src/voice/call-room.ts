import type {
  CallConnection,
  CallDevice,
  CallDeviceKind,
  CallParticipant,
  CallRoomOptions,
  CallRoomStatus,
  CameraFacing,
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
 * It is not the call. Placing, ringing, answer/decline/hangup and the
 * roster are poolse's REST call API and realtime events (`rooms`,
 * `liveCalls`, the conversation channel's `call:*` events). This object
 * owns audio and video and nothing else.
 *
 * ## Why an SFU
 *
 * Every participant sends one copy of their media to the SFU, which
 * forwards it to the others, instead of each phone uploading a copy per
 * peer — which a phone cannot sustain for video beyond two or three
 * people. It also makes the mid-call camera toggle a plain
 * `setCameraEnabled`.
 *
 * ## Availability
 *
 * A deployment with no SFU configured answers 503, which arrives as
 * `tokenProvider` returning `null`. That is not an error — calls are
 * simply unavailable there. `join()` resolves `false` to say so.
 */
/**
 * Copy device records into plain objects.
 *
 * Field by field, and that is the whole point. `MediaDeviceInfo` is a
 * WebIDL interface, so `deviceId`, `kind` and `label` are accessors on
 * its PROTOTYPE rather than own enumerable properties — which means
 * `{ ...device }` spreads to `{}` and silently produces a list of
 * devices with no ids and no names. (It is also why the interface
 * carries its own `toJSON`.) Reading each property invokes the getter,
 * which is what actually copies the value.
 *
 * Entries with no `deviceId` are dropped. A browser that has not yet
 * been granted the device returns a placeholder with empty strings, and
 * offering that as a choice gives the user a row that cannot be
 * selected.
 */
function toDevices(
  raw: readonly { deviceId?: string; kind?: string; label?: string }[],
  kind: CallDeviceKind,
): CallDevice[] {
  const out: CallDevice[] = [];
  for (const device of raw) {
    // `getLocalDevices(kind)` has already filtered; `enumerateDevices()`
    // has not, and returns every kind at once.
    if (device.kind && device.kind !== kind) continue;
    const deviceId = device.deviceId ?? '';
    if (!deviceId) continue;
    out.push({ deviceId, kind, label: device.label ?? '' });
  }
  return out;
}

export class CallRoom {
  private readonly livekit: CheckedLiveKitModule;
  private readonly tokenProvider: () => Promise<CallConnection | null>;
  private readonly startWithVideo: boolean;
  private readonly startMuted: boolean;
  private readonly aloneGraceMs: number;

  private facing: CameraFacing;

  private room: LiveKitRoomHandle | null = null;
  private status: CallRoomStatus = 'idle';
  private selfId: string | null = null;

  // Reference counted: a call screen and a roster can
  // both hold the same call, and the second holder must not open a
  // second SFU connection or tear the first one down on leaving.
  private holders = 0;

  /**
   * Whether anyone else has ever been on this call.
   *
   * The whole point of the alone check is to end a call the other side
   * has vanished from, and "vanished" is only meaningful once they were
   * here. Without this flag the caller who connects first — alone, by
   * definition, for as long as it takes the callee to join — would end
   * their own call before it ever started.
   */
  private hasSeenPeer = false;

  /** Pending alone verdict, cleared the moment anyone shows up. */
  private aloneTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly statusListeners = new Set<(status: CallRoomStatus) => void>();
  private readonly participantListeners = new Set<(participants: CallParticipant[]) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly aloneListeners = new Set<() => void>();
  private readonly deviceListeners = new Set<() => void>();

  /** Bound once so `off()` in teardown removes the same references. */
  private readonly onRoomChange = () => this.emitParticipants();

  /**
   * Hidden `<audio>` elements playing each remote audio track.
   *
   * livekit-client does NOT play remote audio for you on the web — that
   * is what `@livekit/components-react`'s `<RoomAudioRenderer />` exists
   * to do. Without this a call connects, the roster is right, video
   * flows, and nobody hears anything.
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
    this.facing = opts.facing ?? 'user';
    this.aloneGraceMs = opts.aloneGraceMs ?? 1500;
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

  /**
   * Everyone else has left and is not coming back.
   *
   * A call whose other participants hang up cleanly ends by signal:
   * `call:hangup` travels over poolse's own channel and the far side
   * closes its screen. This covers the case where no signal is ever
   * sent — the app was killed, the phone lost its network, the tab was
   * closed — where the only evidence is that the SFU roster emptied.
   *
   * Media is NOT torn down here. Whoever handles this owns hanging up,
   * because ending a call also means telling poolse about it, which is
   * a layer this class deliberately knows nothing about.
   */
  onAlone(fn: () => void): Unsubscribe {
    this.aloneListeners.add(fn);
    return () => this.aloneListeners.delete(fn);
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
   * has no SFU — calls are unavailable there; show that rather than a
   * failed call.
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
      //
      // Neither of these may fail the call. A desktop with no webcam
      // throws `NotFoundError` from `setCameraEnabled`, and that used to
      // land in the catch below and tear the whole call down — a video
      // call was simply impossible on any machine without a camera,
      // when it should have connected as audio. The same reasoning
      // applies to a missing or refused microphone: being able to hear
      // the other side beats not connecting at all.
      //
      // Both report through `onError`, so the UI can say which half is
      // missing rather than leaving the user guessing.
      await this.publish(
        () => room.localParticipant.setMicrophoneEnabled(!this.startMuted),
        'microphone',
      );
      if (this.startWithVideo) {
        await this.publish(
          () => room.localParticipant.setCameraEnabled(true, { facingMode: this.facing }),
          'camera',
        );
      }

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
    await this.withLocal(
      (local) =>
        enabled
          ? local.setCameraEnabled(true, { facingMode: this.facing })
          : local.setCameraEnabled(false),
      'camera',
    );
  }

  /**
   * Swap between the front and rear cameras.
   *
   * `restartTrack` re-acquires the capture device under the *existing*
   * publication, so the far side's tile keeps rendering throughout.
   * Unpublishing and republishing instead would blank their view and
   * force a renegotiation for what is, to them, the same camera.
   *
   * No-ops when the camera is off — there is nothing to restart, and
   * the next `setCameraEnabled(true)` will open whichever lens is
   * selected anyway.
   */
  async switchCamera(): Promise<void> {
    const room = this.room;
    if (!room) return;

    const source = this.livekit.Track.Source['Camera'] ?? 'camera';
    const track = room.localParticipant.getTrackPublication(source)?.videoTrack;
    if (!track?.restartTrack) return;

    const next: CameraFacing = this.facing === 'user' ? 'environment' : 'user';
    try {
      await track.restartTrack({ facingMode: next });
      this.facing = next;
      this.emitParticipants();
    } catch (err) {
      // A device with one camera, or one that refuses the swap. The
      // call carries on pointed wherever it already was.
      this.emitError(new Error(`could not switch camera: ${String(err)}`));
    }
  }

  /** Which camera the local video track is capturing from. */
  getFacingMode(): CameraFacing {
    return this.facing;
  }

  // ── device selection ────────────────────────────────────────────────

  /**
   * Every device of a given kind that could carry this call.
   *
   * The web's equivalent of a phone's speaker button: a laptop has no
   * earpiece to switch to, but it does have three microphones and a
   * pair of headphones, and picking between them is the same job.
   *
   * Prefers livekit-client's own enumeration, which prompts for the
   * permission that makes labels visible, and falls back to the plain
   * browser API so a module without the static still lists something.
   */
  async listDevices(kind: CallDeviceKind): Promise<CallDevice[]> {
    try {
      const fromLiveKit = await this.livekit.Room.getLocalDevices?.(kind, false);
      if (fromLiveKit?.length) return toDevices(fromLiveKit, kind);
    } catch {
      // Fall through — a refused enumeration should cost the picker,
      // not the call.
    }

    const media = globalThis.navigator?.mediaDevices;
    if (!media?.enumerateDevices) return [];

    try {
      return toDevices(await media.enumerateDevices(), kind);
    } catch {
      return [];
    }
  }

  /** Which device of `kind` the call is currently using. */
  getActiveDevice(kind: CallDeviceKind): string | undefined {
    return this.room?.getActiveDevice?.(kind);
  }

  /**
   * Move the call onto another device.
   *
   * `audiooutput` re-points playback through `setSinkId`, which some
   * browsers do not implement — hence the boolean rather than a throw.
   * A refusal is reported as an error and leaves the call where it was.
   */
  async setActiveDevice(kind: CallDeviceKind, deviceId: string): Promise<void> {
    const room = this.room;
    if (!room?.switchActiveDevice) return;

    try {
      await room.switchActiveDevice(kind, deviceId);
      this.emitParticipants();
    } catch (err) {
      this.emitError(new Error(`could not switch ${kind}: ${String(err)}`));
    }
  }

  /** Fires when devices are plugged in or removed. */
  onDevices(fn: () => void): Unsubscribe {
    this.deviceListeners.add(fn);
    return () => this.deviceListeners.delete(fn);
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

  /**
   * Publish one capture device, surviving its absence.
   *
   * Split out from {@link withLocal} because this runs mid-join, before
   * the room is marked connected — emitting a roster here would
   * advertise a call that has not finished starting.
   */
  private async publish(fn: () => Promise<unknown>, what: string): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.emitError(new Error(`no ${what} available: ${String(err)}`));
    }
  }

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

    // Headphones plugged in, a webcam unplugged. The picker has to
    // re-read rather than show a device that is no longer there.
    const devicesChanged = RoomEvent['MediaDevicesChanged'];
    if (devicesChanged) {
      room.on(devicesChanged, () => {
        for (const fn of this.deviceListeners) fn();
      });
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

    // Reset, not preserved: this object can be joined again, and a
    // stale `hasSeenPeer` would let the next call end itself while the
    // callee was still picking up.
    this.hasSeenPeer = false;
    this.clearAloneTimer();

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
    this.checkAlone();
  }

  /**
   * Decide whether this client is the last one standing.
   *
   * Runs on every roster change. Three things have to be true before a
   * call is declared over: it is actually connected, somebody else was
   * here at some point, and nobody is here now — and even then the
   * verdict waits out {@link CallRoomOptions.aloneGraceMs}, so a
   * simultaneous hang-up or a momentary SFU reconnect does not read as
   * abandonment.
   */
  private checkAlone(): void {
    if (this.aloneGraceMs <= 0) return;

    const others = this.room?.remoteParticipants.size ?? 0;

    if (others > 0) {
      this.hasSeenPeer = true;
      this.clearAloneTimer();
      return;
    }

    // Alone, but never had company: this is the caller waiting for an
    // answer, not a call anyone walked out of.
    if (!this.hasSeenPeer || this.status !== 'connected') return;
    if (this.aloneTimer) return;

    this.aloneTimer = setTimeout(() => {
      this.aloneTimer = null;
      // Re-check rather than trusting the reading that armed the timer:
      // someone may have rejoined during the grace period, and the
      // roster is the authority, not the schedule.
      if ((this.room?.remoteParticipants.size ?? 0) > 0) return;
      if (this.status !== 'connected') return;
      for (const fn of this.aloneListeners) fn();
    }, this.aloneGraceMs);
  }

  private clearAloneTimer(): void {
    if (!this.aloneTimer) return;
    clearTimeout(this.aloneTimer);
    this.aloneTimer = null;
  }

  private emitError(error: Error): void {
    for (const fn of this.errorListeners) fn(error);
  }

  /** The local participant's poolse user id, once connected. */
  getSelfId(): string | null {
    return this.selfId;
  }
}
