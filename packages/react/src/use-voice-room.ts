import type { VoiceParticipant, VoiceRoomOptions, VoiceStatus } from '@poolse/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAloneWatch } from './internal/alone-watch.js';
import { usePoolse } from './provider.js';

export interface UseVoiceRoom {
  status: VoiceStatus;
  /** Everyone currently in the room, oldest join first. */
  participants: VoiceParticipant[];
  muted: boolean;
  /**
   * Everyone else has left and is not coming back.
   *
   * The mesh equivalent of `useCallRoom`'s flag of the same name — see
   * there for why a call needs this on top of the explicit hang-up
   * signal. Only meaningful for a room being used to carry a call; a
   * Discord-style room you sit in alone is a normal state, so wire this
   * to hang-up only on the call surface.
   */
  alone: boolean;
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
  opts: VoiceRoomOptions & {
    /** Grace before {@link UseVoiceRoom.alone}. Defaults to 1500; `0` disables. */
    aloneGraceMs?: number;
  } = {},
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

  // Whether THIS hook holds the room open. The SDK hands out one room
  // per conversation and counts holders, so leaving without having
  // joined would release someone else's claim — a call screen unmounting
  // would cut the audio out from under a voice bar in the same
  // conversation.
  const joined = useRef(false);

  /**
   * The room this hook is responsible for right now.
   *
   * Same window as `useCallRoom`: a call that ends while the room is
   * still connecting ran its cleanup before `join()` resolved, so
   * nothing released the room and it finished connecting with no
   * component behind it — audio with no UI.
   */
  const held = useRef<ReturnType<typeof poolse.realtime.voice> | null>(null);

  const room = useMemo(
    () => (conversationId ? poolse.realtime.voice(conversationId, optsRef.current) : null),
    [poolse, conversationId],
  );

  useEffect(() => {
    if (!room) return;

    held.current = room;
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
      held.current = null;
      // Leaving on unmount is deliberate: the server only broadcasts
      // `voice:left` on an explicit leave, so skipping it would strand
      // us in everyone else's roster. Only release a claim we made.
      if (joined.current) {
        joined.current = false;
        room.leave();
      }
    };
  }, [room]);

  const join = useCallback(async () => {
    const target = room;
    if (!target) return;
    setError(null);
    try {
      await target.join();

      // Superseded while connecting — release it rather than leaving a
      // room nobody holds. See `held`.
      if (held.current !== target) {
        target.leave();
        return;
      }
      joined.current = true;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [room]);

  const leave = useCallback(() => {
    if (!joined.current) return;
    joined.current = false;
    room?.leave();
  }, [room]);

  const toggleMute = useCallback(() => {
    if (!room) return;
    setMuted(room.toggleMute());
  }, [room]);

  // `participants` includes the local participant, so anyone else is
  // whatever is left over.
  const alone = useAloneWatch({
    active: status === 'connected',
    others: Math.max(0, participants.length - 1),
    graceMs: optsRef.current.aloneGraceMs ?? 1500,
  });

  return { status, participants, muted, alone, error, join, leave, toggleMute };
}
