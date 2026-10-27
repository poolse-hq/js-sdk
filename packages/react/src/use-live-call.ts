import type { LiveCall } from '@poolse/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePoolse } from './provider.js';

export interface UseLiveCall {
  /** The call running on the conversation right now, or null. */
  call: LiveCall | null;
  /** User ids in the call's room at this moment (kept live by `call:participants`). */
  participantIds: string[];
  /** Re-read from the server. */
  refresh: () => void;
}

/**
 * Whether a call is running on `conversationId` — what a "Call in
 * progress · Join" banner needs. Reads once on mount (and after every
 * reconnect, since events sent while the socket was down are gone),
 * then follows the conversation's `call:started`, `call:participants`
 * and `call:finished` events. `null` id → always idle.
 */
export function useLiveCall(conversationId: string | null): UseLiveCall {
  const chat = usePoolse();
  const [call, setCall] = useState<LiveCall | null>(null);
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const callIdRef = useRef<string | null>(null);
  const seq = useRef(0);

  const apply = useCallback((next: LiveCall | null) => {
    callIdRef.current = next?.id ?? null;
    setCall(next);
    setParticipantIds(next ? next.participants.map((p) => p.user_id) : []);
  }, []);

  const refresh = useCallback(() => {
    if (!conversationId) return;
    const mine = ++seq.current;
    chat.liveCalls
      .get(conversationId)
      .then((c) => {
        if (mine === seq.current) apply(c);
      })
      .catch(() => {
        // A failed read keeps what we have; the next event or reconnect corrects it.
      });
  }, [chat, conversationId, apply]);

  useEffect(() => {
    apply(null);
    if (!conversationId) return;
    refresh();

    const conv = chat.realtime.conversation(conversationId);
    const offStarted = conv.onCallStarted((evt) => {
      seq.current++; // newer than any read in flight
      apply(evt.call);
    });
    const offParticipants = conv.onCallParticipants((evt) => {
      if (evt.call_id === callIdRef.current) setParticipantIds(evt.participants);
      // A roster for a call we never heard start (joined mid-call): read it.
      else refresh();
    });
    const offFinished = conv.onCallFinished((evt) => {
      if (evt.call_id !== callIdRef.current) return;
      seq.current++;
      apply(null);
    });
    // The first connect isn't a reconnect: the mount already read it.
    let wasConnected = chat.realtime.getStatus() === 'connected';
    let connectedBefore = wasConnected;
    const offStatus = chat.realtime.onStatus((status) => {
      if (status === 'connected' && !wasConnected && connectedBefore) refresh();
      wasConnected = status === 'connected';
      connectedBefore ||= wasConnected;
    });
    return () => {
      offStarted();
      offParticipants();
      offFinished();
      offStatus();
    };
  }, [chat, conversationId, apply, refresh]);

  return { call, participantIds, refresh };
}
