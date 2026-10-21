import type { LiveKitModule, RoomSession } from '@poolse/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePoolse } from './provider.js';
import { useCallRoom, type UseCallRoom } from './use-call-room.js';
import { useLiveCall } from './use-live-call.js';

export interface UseRoomOptions {
  /** `livekit-client`, imported by your app: `import * as livekit from 'livekit-client'`. */
  livekit: LiveKitModule;
}

export interface UseRoom {
  /**
   * The room (or call) running on the conversation right now, whether
   * or not this user is in it — what a "Join" button reads.
   */
  live: ReturnType<typeof useLiveCall>['call'];
  /** User ids in the room at this moment. */
  presentIds: string[];
  /** This user is in (or connecting to) the room. */
  joined: boolean;
  /** Starting or joining is in flight. */
  joining: boolean;
  /**
   * Drop in: starts the conversation's room if none is live, or joins
   * the one that is (a ringing call included). Nobody's phone rings.
   * `video` turns the camera on as you arrive. `{ ring: true }` rings
   * the other members' phones as well — an opt-in for apps where web
   * calls people (a support desk); rooms never ring otherwise.
   */
  join: (media?: 'audio' | 'video', opts?: { ring?: boolean }) => Promise<void>;
  /** Leave. The room carries on for whoever is still in it. */
  leave: () => void;
  /** The media side: participants, mic/camera, devices (see `useCallRoom`). */
  media: UseCallRoom;
  error: Error | null;
}

/**
 * A conversation's room — Meet-style: anyone in the conversation drops
 * in for voice or video while the chat carries on, and nothing rings.
 *
 *     const room = useRoom(conversationId, { livekit });
 *     room.live ? <button onClick={() => room.join()}>Join</button>
 *               : <button onClick={() => room.join('video')}>Start a video room</button>;
 *
 * The room ends on its own once it has been empty for a short while,
 * and leaves one line in the conversation's history.
 */
export function useRoom(conversationId: string | null, opts: UseRoomOptions): UseRoom {
  const poolse = usePoolse();
  const { call: live, participantIds } = useLiveCall(conversationId);
  // A room has no "everyone else left, hang up" moment — people come and
  // go — so the media hook's alone signal is switched off.
  const media = useCallRoom(conversationId, { livekit: opts.livekit, aloneGraceMs: 0 });
  const session = useRef<RoomSession | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    session.current = null;
    setError(null);
  }, [conversationId]);

  const join = useCallback(
    async (kind: 'audio' | 'video' = 'audio', joinOpts: { ring?: boolean } = {}) => {
      if (!conversationId) return;
      setJoining(true);
      setError(null);
      try {
        // Register first: this is what makes it a room members see (and
        // joins a call already live instead of starting one beside it).
        session.current = joinOpts.ring
          ? await poolse.rooms.ring(conversationId, kind)
          : await poolse.rooms.start(conversationId, kind);
        const connected = await media.join();
        if (!connected) throw new Error('Rooms need the SFU, which this deployment does not have.');
        if (kind === 'video') await media.setCameraEnabled(true);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        media.leave();
      } finally {
        setJoining(false);
      }
    },
    [poolse, conversationId, media],
  );

  const leave = useCallback(() => {
    media.leave();
    const s = session.current;
    session.current = null;
    // Best-effort: LiveKit reports the departure anyway.
    if (s) void poolse.rooms.leave(s).catch(() => {});
  }, [poolse, media]);

  const joined = media.status === 'connected' || media.status === 'connecting' || joining;

  return {
    live,
    presentIds: participantIds,
    joined,
    joining,
    join,
    leave,
    media,
    error: error ?? media.error,
  };
}
