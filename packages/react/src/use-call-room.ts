import type { CallParticipant, CallRoomStatus, LiveKitModule } from '@poolse/sdk';
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
}

export interface UseCallRoom {
  status: CallRoomStatus;
  /** Everyone on the call, the local participant first. */
  participants: CallParticipant[];
  cameraEnabled: boolean;
  micEnabled: boolean;
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
  const [error, setError] = useState<Error | null>(null);
  const [sfuAvailable, setSfuAvailable] = useState<boolean | null>(null);

  // Pinned to the first value: the LiveKit module and the initial media
  // choice don't meaningfully change for a room's lifetime, and an
  // inline object literal would otherwise rebuild the room every render.
  const optsRef = useRef(opts);

  // Whether THIS hook holds the room. Leaving without having joined
  // would release a claim we never made.
  const joined = useRef(false);

  const room = useMemo(() => {
    if (!conversationId) return null;

    return poolse.call(conversationId, {
      livekit: optsRef.current.livekit,
      ...(optsRef.current.video !== undefined ? { video: optsRef.current.video } : {}),
      ...(optsRef.current.muted !== undefined ? { muted: optsRef.current.muted } : {}),
    });
  }, [poolse, conversationId]);

  // Track state changes that originate below React — a camera that
  // failed to start, or the SFU dropping us — rather than assuming our
  // last call succeeded.
  const sync = useCallback((target: CallRoom | null) => {
    if (!target) return;
    setCamera(target.isCameraEnabled());
    setMic(target.isMicrophoneEnabled());
  }, []);

  useEffect(() => {
    if (!room) {
      setStatus('idle');
      setParticipants([]);
      return;
    }

    setStatus(room.getStatus());
    setParticipants(room.getParticipants());

    const offStatus = room.onStatus(setStatus);
    const offRoster = room.onParticipants((next) => {
      setParticipants(next);
      sync(room);
    });
    const offError = room.onError(setError);

    return () => {
      offStatus();
      offRoster();
      offError();
      // Unmounting mid-call must disconnect, or the SFU keeps publishing
      // a participant nobody is behind.
      if (joined.current) {
        joined.current = false;
        room.leave();
      }
    };
  }, [room, sync]);

  const join = useCallback(async (): Promise<boolean> => {
    if (!room) return false;
    setError(null);

    try {
      const connected = await room.join();
      joined.current = connected;
      setSfuAvailable(connected);
      sync(room);
      return connected;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      // A thrown join is a real failure, not a missing SFU — the caller
      // should surface it rather than quietly falling back.
      setSfuAvailable(true);
      return false;
    }
  }, [room, sync]);

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

  return {
    status,
    participants,
    cameraEnabled,
    micEnabled,
    error,
    sfuAvailable,
    join,
    leave,
    setCameraEnabled,
    toggleCamera,
    setMicrophoneEnabled,
    toggleMic,
  };
}
