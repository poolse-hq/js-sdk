import type { Message, MessageCreateRequest } from '@poolse/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePoolse } from './provider.js';

interface UseMessagesState {
  /** Newest-last array. The wire returns newest-first; we reverse so list rendering matches reading order. */
  messages: Message[];
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  /** Load an older page (lower sequence numbers). Idempotent if no older messages exist. */
  loadMore: () => Promise<void>;
  /** Optimistically append + POST. Replaces the optimistic row with the server response on success. */
  send: (attrs: MessageCreateRequest) => Promise<Message>;
}

const PAGE_SIZE = 50;

/**
 * Live message list for `conversationId`. Combines:
 *
 *   * Initial REST fetch (newest 50) on mount.
 *   * WebSocket subscription for `message:new`, `message:updated`,
 *     `message:deleted` — applied in-place to the cached array.
 *   * Optimistic-send via `send()` — the message appears immediately
 *     under the SAME id the server will assign (we pre-generate it
 *     client-side and pass it through), so the realtime echo and the
 *     REST response both arrive carrying that id and get deduped by
 *     `findIndex(m => m.id === msg.id)`. No heuristic match, no race.
 *
 * Re-mounting with the same `conversationId` reuses the underlying
 * channel — no extra socket traffic.
 */
export function useMessages(conversationId: string): UseMessagesState {
  const chat = usePoolse();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);

  // Cursor for `loadMore` — the lowest sequence currently in state.
  const oldestSequenceRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    setError(null);
    setHasMore(true);
    oldestSequenceRef.current = null;

    const handle = chat.conversations.one(conversationId).messages;

    handle
      .list({ limit: PAGE_SIZE })
      .then((page) => {
        if (cancelled) return;
        // Wire is newest-first; flip for natural reading order.
        const ordered = [...page.data].reverse();
        setMessages(ordered);
        setHasMore(page.data.length === PAGE_SIZE);
        oldestSequenceRef.current = ordered[0]?.sequence ?? null;
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });

    // Realtime listeners.
    const conv = chat.realtime.conversation(conversationId);

    const offNew = conv.onMessage((msg) => {
      // Simple by-id upsert. Covers three cases with one expression:
      //   1) Brand-new message from another user → append.
      //   2) Echo of our own optimistic send (id we generated below) →
      //      replace the temp row in place (preserves position).
      //   3) Re-delivery on channel rejoin → idempotent replace.
      setMessages((prev) => upsertById(prev, msg));
    });

    const offUpdated = conv.onMessageUpdated((msg) => {
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
    });

    const offDeleted = conv.onMessageDeleted((evt) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === evt.id ? { ...m, deleted_at: evt.deleted_at, body: null } : m)),
      );
    });

    return () => {
      cancelled = true;
      offNew();
      offUpdated();
      offDeleted();
      // Don't leave the channel — another component may still be reading
      // this conversation. The Poolse.destroy() at provider-unmount
      // tears everything down.
    };
  }, [chat, conversationId]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loading) return;
    const before = oldestSequenceRef.current;
    if (!before) return;

    const opts: { limit: number; before?: number } = { limit: PAGE_SIZE };
    if (before !== null) opts.before = before;

    const page = await chat.conversations.one(conversationId).messages.list(opts);
    if (page.data.length === 0) {
      setHasMore(false);
      return;
    }
    const older = [...page.data].reverse();
    setMessages((prev) => [...older, ...prev]);
    setHasMore(page.data.length === PAGE_SIZE);
    oldestSequenceRef.current = older[0]?.sequence ?? oldestSequenceRef.current;
  }, [chat, conversationId, hasMore, loading]);

  const send = useCallback(
    async (attrs: MessageCreateRequest) => {
      // Generate the message id client-side and pass it through, so
      // the optimistic row, the REST response, and the realtime echo
      // ALL share one id — id-based upsert handles every race.
      const id = attrs.id ?? crypto.randomUUID();
      const tempMsg: Message = {
        id,
        tenant_id: '',
        conversation_id: conversationId,
        sender_id: null,
        type: attrs.type ?? 'text',
        body: attrs.body,
        reply_to_id: attrs.reply_to_id ?? null,
        thread_root_id: null,
        mentions: attrs.mentions ?? [],
        reactions: {},
        edited_at: null,
        deleted_at: null,
        // MAX_SAFE_INTEGER sorts the temp row to the very end (newest
        // position) until the server returns the real `sequence`.
        sequence: Number.MAX_SAFE_INTEGER,
        inserted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, tempMsg]);

      try {
        const sent = await chat.conversations.one(conversationId).messages.send({ ...attrs, id });
        // Both REST and realtime carry the same id; whichever lands
        // first wins, and the second is an idempotent replace.
        setMessages((prev) => upsertById(prev, sent));
        return sent;
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== id));
        throw err;
      }
    },
    [chat, conversationId],
  );

  return { messages, loading, error, hasMore, loadMore, send };
}

function upsertById(prev: Message[], msg: Message): Message[] {
  const idx = prev.findIndex((m) => m.id === msg.id);
  if (idx === -1) return [...prev, msg];
  const next = prev.slice();
  next[idx] = msg;
  return next;
}
