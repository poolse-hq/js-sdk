import { useCallback, useEffect, useRef, useState } from 'react';
import { usePoolse } from './provider.js';
import { useMe } from './use-me.js';

interface UseTypingState {
  /**
   * Set of `external_id`s currently typing (your own user identifiers,
   * the same string you'd pass to `userResolver`). Excludes the
   * current user — they know they're typing.
   */
  typing: Set<string>;
  /**
   * Send a typing ping to the server. Debounced inside the hook to
   * once per 500 ms — the server squashes further with its own
   * per-(user, conversation) window.
   */
  signalTyping: () => void;
}

/**
 * Tracks who's typing in `conversationId`. Subscribes to the
 * `typing:start` / `typing:stop` broadcasts; auto-cleans up entries
 * when stop fires.
 */
export function useTyping(conversationId: string): UseTypingState {
  const chat = usePoolse();
  const { me } = useMe();
  const [typing, setTyping] = useState<Set<string>>(new Set());
  const lastPingRef = useRef(0);

  // `me` resolves asynchronously after first render; read it from a
  // ref inside the event handlers so the subscription doesn't need to
  // re-attach when `me` lands (which would briefly drop incoming
  // typing events from other users).
  const meExtRef = useRef<string | null>(me?.external_id ?? null);
  meExtRef.current = me?.external_id ?? null;

  useEffect(() => {
    setTyping(new Set());

    const conv = chat.realtime.conversation(conversationId);

    const offStart = conv.onTypingStart((evt) => {
      const ext = evt.external_id;
      if (!ext) return;
      // Don't render the current user's own typing — they know.
      if (meExtRef.current && ext === meExtRef.current) return;
      setTyping((prev) => {
        if (prev.has(ext)) return prev;
        const next = new Set(prev);
        next.add(ext);
        return next;
      });
    });

    const offStop = conv.onTypingStop((evt) => {
      const ext = evt.external_id;
      if (!ext) return;
      if (meExtRef.current && ext === meExtRef.current) return;
      setTyping((prev) => {
        if (!prev.has(ext)) return prev;
        const next = new Set(prev);
        next.delete(ext);
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
