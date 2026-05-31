import type { Uuid } from '@poolse/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePoolse } from './provider.js';
import { useMe } from './use-me.js';

interface UseTypingState {
  /** Set of user_ids currently typing. */
  typing: Set<Uuid>;
  /**
   * Send a typing ping to the server. Debounced inside the SDK — the
   * server squashes `typing:start` to one push per (user, conversation,
   * window). Call as often as you want from input handlers.
   */
  signalTyping: () => void;
}

/**
 * Tracks who's typing in `conversationId`. Subscribes to the
 * `typing:start` / `typing:stop` broadcasts; auto-cleans up entries
 * when stop fires.
 *
 * `signalTyping` debounces on the client side to once per 500 ms so a
 * fast-typing user doesn't flood the channel — poolse does its own
 * server-side debounce too, so both layers are safe.
 */
export function useTyping(conversationId: string): UseTypingState {
  const chat = usePoolse();
  const { me } = useMe();
  const [typing, setTyping] = useState<Set<Uuid>>(new Set());
  const lastPingRef = useRef(0);

  // `me` resolves asynchronously after first render; read it from a
  // ref inside the event handlers so the subscription doesn't need to
  // re-attach when `me` lands (which would briefly drop incoming
  // typing events from other users).
  const meIdRef = useRef<Uuid | null>(me?.id ?? null);
  meIdRef.current = me?.id ?? null;

  useEffect(() => {
    setTyping(new Set());

    const conv = chat.realtime.conversation(conversationId);

    const offStart = conv.onTypingStart((evt) => {
      // Don't render the current user's own typing — they know they're typing.
      if (meIdRef.current && evt.user_id === meIdRef.current) return;
      setTyping((prev) => {
        if (prev.has(evt.user_id)) return prev;
        const next = new Set(prev);
        next.add(evt.user_id);
        return next;
      });
    });

    const offStop = conv.onTypingStop((evt) => {
      if (meIdRef.current && evt.user_id === meIdRef.current) return;
      setTyping((prev) => {
        if (!prev.has(evt.user_id)) return prev;
        const next = new Set(prev);
        next.delete(evt.user_id);
        return next;
      });
    });

    return () => {
      offStart();
      offStop();
    };
  }, [chat, conversationId]);

  const signalTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastPingRef.current < 500) return;
    lastPingRef.current = now;
    chat.realtime.conversation(conversationId).sendTyping();
  }, [chat, conversationId]);

  return { typing, signalTyping };
}
