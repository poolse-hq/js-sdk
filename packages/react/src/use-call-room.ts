import type {
  CallDevice,
  CallDeviceKind,
  CallParticipant,
  CallRoomStatus,
  CameraFacing,
  LiveKitModule,
} from '@poolse/sdk';
import { CallRoom } from '@poolse/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { usePoolse } from './provider.js';

export interface UseCallRoomOptions {
  /**
   * `livekit-client`, imported by your app:
   *
   *     import * as livekit from 'livekit-client';
   *
   * Passed in rather than imported by the SDK because Metro bundles from
   * the static import graph and cannot follow the `require` that tsup
   * emits — a dependency the SDK imports for itself never reaches a
   * React Native bundle.
   */
  livekit: LiveKitModule;
  /** Publish the camera on join. An audio call starts with it off. */
  video?: boolean;
  /** Join muted. */
  muted?: boolean;
  /** Which camera to open with. Defaults to the front one. */
  facing?: CameraFacing;
  /**
   * How long the last participant may sit alone before {@link
   * UseCallRoom.alone} turns true, in milliseconds. Defaults to 1500.
   * Pass `0` to never report it.
   */
  aloneGraceMs?: number;
}

export interface UseCallRoom {
  status: CallRoomStatus;
  /** Everyone on the call, the local participant first. */
  participants: CallParticipant[];
  cameraEnabled: boolean;
  micEnabled: boolean;
  /** Which camera is publishing. Meaningless while the camera is off. */
  facingMode: CameraFacing;
  /**
   * Selectable devices, refreshed as they are plugged in and removed.
   *
   * The web's answer to a phone's speaker button — a laptop has no
   * earpiece, but it does have several microphones and a pair of
   * headphones, and choosing between them is the same job. Sparse on
   * React Native, where routing goes through the platform audio session
   * instead (see `useCallAudio` in `@poolse/react-native`).
   */
  devices: Record<CallDeviceKind, CallDevice[]>;
  /** Device id in use per kind, where the platform reports one. */
  activeDevices: Partial<Record<CallDeviceKind, string>>;
  /** Move the call onto another camera, microphone or output. */
  selectDevice: (kind: CallDeviceKind, deviceId: string) => Promise<void>;
  /**
   * Everyone else has gone and is not coming back.
   *
   * Turns true only after somebody else has actually been on the call,
   * so the caller waiting for an answer never trips it. Wire it to your
   * hang-up path — a peer whose app was killed or whose phone lost
   * signal sends no `call:hangup`, and without this the survivor is
   * left on a call screen that will never close on its own.
   *
   *     useEffect(() => {
   *       if (media.alone) void calls.hangUp();
   *     }, [media.alone]);
   */
  alone: boolean;
  error: Error | null;
  /**
   * Whether this deployment has an SFU.
   *
   * `null` until a join has been attempted, then `false` if the API
   * answered 503. A `false` here is not a failure — it means fall back
   * to `useVoiceRoom`, which is how every call worked before the SFU.
   */
  sfuAvailable: boolean | null;
  /** Connect. Resolves `false` when there is no SFU. */
  join: () => Promise<boolean>;
  leave: () => void;
  setCameraEnabled: (enabled: boolean) => Promise<void>;
  toggleCamera: () => Promise<void>;
  /** Swap between the front and rear cameras. */
  switchCamera: () => Promise<void>;
  setMicrophoneEnabled: (enabled: boolean) => Promise<void>;
  toggleMic: () => Promise<void>;
}

/**
 * A call's media, carried by the SFU.
 *
 * Media only. Ringing, accept/decline/hangup and the poolse roster stay
 * with `useCalls` and `useVoiceRoom`; this is what people sound and look
 * like. A call screen normally uses both.
 *
 *     const media = useCallRoom(conversationId, { livekit, video: true });
 *     await media.join();
 *     await media.toggleCamera();
 *
 * Both the camera and the microphone can be turned on and off at any
 * point during the call — that is the SFU's doing, since renegotiating a
 * live connection is exactly what the peer-to-peer mesh cannot do.
 */
export function useCallRoom(conversationId: string | null, opts: UseCallRoomOptions): UseCallRoom {
  const poolse = usePoolse();

  const [status, setStatus] = useState<CallRoomStatus>('idle');
  const [participants, setParticipants] = useState<CallParticipant[]>([]);
  const [cameraEnabled, setCamera] = useState(false);
  const [micEnabled, setMic] = useState(false);
  const [facingMode, setFacing] = useState<CameraFacing>(opts.facing ?? 'user');
  const [alone, setAlone] = useState(false);
  const [devices, setDevices] = useState<Record<CallDeviceKind, CallDevice[]>>({
    videoinput: [],
    audioinput: [],
    audiooutput: [],
  });
  const [activeDevices, setActiveDevices] = useState<Partial<Record<CallDeviceKind, string>>>({});
  const [error, setError] = useState<Error | null>(null);
  const [sfuAvailable, setSfuAvailable] = useState<boolean | null>(null);

  // Kept current, but read only when a room is built.
  //
  // This used to pin the FIRST value, which quietly broke every video
  // call. The options are an inline object literal, so pinning avoided
  // rebuilding the room on each render — but a call screen mounts long
  // before a call exists, and at that point `video` is false because
  // nothing is ringing yet. The room was then constructed later, on the
  // conversation id arriving, from options captured when there was no
  // call: audio, always. Cameras never opened on a video call and the
  // toggle looked broken.
  //
  // Assigning during render keeps the ref current without triggering
  // one, and the memo below still only reads it when it actually
  // constructs a room — so nothing rebuilds per render either.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Whether THIS hook holds the room. Leaving without having joined
  // would release a claim we never made.
  const joined = useRef(false);

  const room = useMemo(() => {
    if (!conversationId) return null;

    return poolse.call(conversationId, {
      livekit: optsRef.current.livekit,
      ...(optsRef.current.video !== undefined ? { video: optsRef.current.video } : {}),
      ...(optsRef.current.muted !== undefined ? { muted: optsRef.current.muted } : {}),
      ...(optsRef.current.facing !== undefined ? { facing: optsRef.current.facing } : {}),
      ...(optsRef.current.aloneGraceMs !== undefined
        ? { aloneGraceMs: optsRef.current.aloneGraceMs }
        : {}),
    });
  }, [poolse, conversationId]);

  // Track state changes that originate below React — a camera that
  // failed to start, or the SFU dropping us — rather than assuming our
  // last call succeeded.
  const refreshDevices = useCallback((target: CallRoom) => {
    void Promise.all([
      target.listDevices('videoinput'),
      target.listDevices('audioinput'),
      target.listDevices('audiooutput'),
    ]).then(([videoinput, audioinput, audiooutput]) => {
      setDevices({ videoinput, audioinput, audiooutput });

      // Built by omission rather than by assigning undefined: under
      // `exactOptionalPropertyTypes` a present-but-undefined key is not
      // the same as an absent one, and "the platform does not report
      // this" is genuinely absence.
      const active: Partial<Record<CallDeviceKind, string>> = {};
      for (const kind of ['videoinput', 'audioinput', 'audiooutput'] as const) {
        const id = target.getActiveDevice(kind);
        if (id) active[kind] = id;
      }
      setActiveDevices(active);
    });
  }, []);

  const sync = useCallback((target: CallRoom | null) => {
    if (!target) return;
    setCamera(target.isCameraEnabled());
    setMic(target.isMicrophoneEnabled());
    setFacing(target.getFacingMode());
  }, []);

  useEffect(() => {
    if (!room) {
      setStatus('idle');
      setParticipants([]);
      return;
    }

    setStatus(room.getStatus());
    setParticipants(room.getParticipants());

    // Latched rather than pulsed: a consumer that hangs up in an effect
    // needs the signal to survive until it has been read, and a call
    // that has been abandoned is never un-abandoned.
    setAlone(false);

    const offStatus = room.onStatus(setStatus);
    const offRoster = room.onParticipants((next) => {
      setParticipants(next);
      sync(room);
    });
    const offAlone = room.onAlone(() => setAlone(true));

    const offDevices = room.onDevices(() => refreshDevices(room));
    const offError = room.onError(setError);

    return () => {
      offStatus();
      offRoster();
      offAlone();
      offDevices();
      offError();
      // Unmounting mid-call must disconnect, or the SFU keeps publishing
      // a participant nobody is behind.
      if (joined.current) {
        joined.current = false;
        room.leave();
      }
    };
  }, [room, sync, refreshDevices]);

  const join = useCallback(async (): Promise<boolean> => {
    if (!room) return false;
    setError(null);

    try {
      const connected = await room.join();
      joined.current = connected;
      setSfuAvailable(connected);
      sync(room);
      // Only once connected: enumerating before the call holds its
      // permissions gives a list of unlabelled placeholders.
      if (connected) refreshDevices(room);
      return connected;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      // A thrown join is a real failure, not a missing SFU — the caller
      // should surface it rather than quietly falling back.
      setSfuAvailable(true);
      return false;
    }
  }, [room, sync, refreshDevices]);

  const leave = useCallback(() => {
    if (!joined.current) return;
    joined.current = false;
    room?.leave();
  }, [room]);

  const setCameraEnabled = useCallback(
    async (enabled: boolean) => {
      if (!room) return;
      await room.setCameraEnabled(enabled);
      sync(room);
    },
    [room, sync],
  );

  const setMicrophoneEnabled = useCallback(
    async (enabled: boolean) => {
      if (!room) return;
      await room.setMicrophoneEnabled(enabled);
      sync(room);
    },
    [room, sync],
  );

  // Read the live value rather than the rendered one: a toggle fired
  // twice quickly would otherwise both read the same stale state and
  // end up where it started.
  const toggleCamera = useCallback(async () => {
    if (!room) return;
    await setCameraEnabled(!room.isCameraEnabled());
  }, [room, setCameraEnabled]);

  const toggleMic = useCallback(async () => {
    if (!room) return;
    await setMicrophoneEnabled(!room.isMicrophoneEnabled());
  }, [room, setMicrophoneEnabled]);

  const switchCamera = useCallback(async () => {
    if (!room) return;
    await room.switchCamera();
    setFacing(room.getFacingMode());
  }, [room]);

  const selectDevice = useCallback(
    async (kind: CallDeviceKind, deviceId: string) => {
      if (!room) return;
      await room.setActiveDevice(kind, deviceId);
      setActiveDevices((current) => ({
        ...current,
        [kind]: room.getActiveDevice(kind) ?? deviceId,
      }));
    },
    [room],
  );

  return {
    status,
    participants,
    cameraEnabled,
    micEnabled,
    facingMode,
    alone,
    devices,
    activeDevices,
    error,
    sfuAvailable,
    join,
    leave,
    setCameraEnabled,
    toggleCamera,
    switchCamera,
    selectDevice,
    setMicrophoneEnabled,
    toggleMic,
  };
}
