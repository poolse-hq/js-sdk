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

// How long after the most recent `typing:start` ping we assume the
// remote user has stopped typing. The server emits one ping every
// ~500ms while the keystroke debounce is hot; 4s gives a comfortable
// safety margin without leaving the chip on after the user clearly
// stopped. Independent of the server's own `typing:stop` window so
// the UI is responsive even if that broadcast is late or dropped.
const TYPING_TIMEOUT_MS = 4000;

/**
 * Tracks who's typing in `conversationId`. Subscribes to the
 * `typing:start` / `typing:stop` broadcasts, plus two purely
 * client-side eviction paths that keep the chip from lingering when
 * the server is slow (or never) to send `typing:stop`:
 *
 *   1. Per-user inactivity timer — each `typing:start` resets a 4 s
 *      timeout for that `external_id`; when it fires we drop them
 *      from the set. Covers "they stopped typing without sending".
 *   2. `message:new` from the same sender — if a typing user sends a
 *      message, we evict them immediately. Covers "they just sent".
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
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const evict = (ext: string) => {
      const t = timers.get(ext);
      if (t) {
        clearTimeout(t);
        timers.delete(ext);
      }
      setTyping((prev) => {
        if (!prev.has(ext)) return prev;
        const next = new Set(prev);
        next.delete(ext);
        return next;
      });
    };

    const conv = chat.realtime.conversation(conversationId);

    const offStart = conv.onTypingStart((evt) => {
      const ext = evt.external_id;
      if (!ext) return;
      // Don't render the current user's own typing — they know.
      if (meExtRef.current && ext === meExtRef.current) return;
      // (Re)arm the inactivity timer for this user.
      const existing = timers.get(ext);
      if (existing) clearTimeout(existing);
      timers.set(
        ext,
        setTimeout(() => evict(ext), TYPING_TIMEOUT_MS),
      );
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
      evict(ext);
    });

    // If the typing user sends a message, they're definitely done
    // typing — evict immediately rather than waiting for the server's
    // typing:stop broadcast.
    const offMessage = conv.onMessage((msg) => {
      const ext = msg.sender_external_id;
      if (!ext) return;
      if (meExtRef.current && ext === meExtRef.current) return;
      evict(ext);
    });

    return () => {
      offStart();
      offStop();
      offMessage();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
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
