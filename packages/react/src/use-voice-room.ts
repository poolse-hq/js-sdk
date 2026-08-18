import type { VoiceParticipant, VoiceRoomOptions, VoiceStatus } from '@poolse/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePoolse } from './provider.js';

export interface UseVoiceRoom {
  status: VoiceStatus;
  /** Everyone currently in the room, oldest join first. */
  participants: VoiceParticipant[];
  muted: boolean;
  error: Error | null;
  /** Acquire the mic and connect. Safe to call twice. */
  join: () => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
}

/**
 * Discord-style voice room for a conversation: join, see who else is
 * in, watch who's talking, mute yourself.
 *
 * The room is torn down when the conversation changes or the component
 * unmounts, so a navigation away hangs up rather than leaving a phantom
 * participant behind.
 *
 *     const voice = useVoiceRoom(conversationId);
 *     <Button onPress={voice.join} title="Join Voice" />
 *
 * For ringing someone who hasn't joined yet, see `useCalls`.
 */
export function useVoiceRoom(
  conversationId: string | null,
  opts: VoiceRoomOptions = {},
): UseVoiceRoom {
  const poolse = usePoolse();

  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Options are usually an inline object literal, which would re-run
  // the subscribe effect on every render. Pin them to the first value:
  // ICE servers and the WebRTC adapter don't meaningfully change for
  // the lifetime of a room.
  const optsRef = useRef(opts);

  const room = useMemo(
    () => (conversationId ? poolse.realtime.voice(conversationId, optsRef.current) : null),
    [poolse, conversationId],
  );

  useEffect(() => {
    if (!room) return;

    setStatus(room.getStatus());
    setParticipants(room.getParticipants());
    setMuted(room.isMuted());

    const offStatus = room.onStatus(setStatus);
    const offRoster = room.onParticipants(setParticipants);
    const offError = room.onError(setError);

    return () => {
      offStatus();
      offRoster();
      offError();
      // Leaving on unmount is deliberate: the server only broadcasts
      // `voice:left` on an explicit leave, so skipping it would strand
      // us in everyone else's roster.
      room.leave();
    };
  }, [room]);

  const join = useCallback(async () => {
    if (!room) return;
    setError(null);
    try {
      await room.join();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [room]);

  const leave = useCallback(() => {
    room?.leave();
  }, [room]);

  const toggleMute = useCallback(() => {
    if (!room) return;
    setMuted(room.toggleMute());
  }, [room]);

  return { status, participants, muted, error, join, leave, toggleMute };
}
