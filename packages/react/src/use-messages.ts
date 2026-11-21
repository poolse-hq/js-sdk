import type { Message, MessageCreateRequest, OutboxEntry, Poolse, Uuid } from '@poolse/sdk';
import {
  MessageQueuedError,
  applyThreadUpdate,
  markQuoteDeleted,
  mergeMessage,
  safeUuid,
  toTombstone,
} from '@poolse/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConversationsStore, usePoolse } from './provider.js';
import { useMe } from './use-me.js';

interface UseMessagesState {
  /** Newest-last array. The wire returns newest-first; we reverse so list rendering matches reading order. */
  messages: Message[];
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  /** Load an older page (lower sequence numbers). Idempotent if no older messages exist. */
  loadMore: () => Promise<void>;
  /**
   * Optimistically append + POST. Replaces the optimistic row with the
   * server response on success.
   *
   * With the client's outbox on (the default), a send that can't reach
   * the server stays in the list as `local_status: 'queued'` and goes
   * out by itself on reconnect (same id, so never twice); the promise
   * rejects with `MessageQueuedError`, which is not a failure to show.
   * A send the server refuses stays as `local_status: 'failed'` (with
   * `local_error`) until `retry(id)` or `discard(id)`; the promise
   * rejects with the server's error. With `outbox: false` a failed
   * send is removed from the list and rejects, as before.
   */
  send: (attrs: MessageCreateRequest) => Promise<Message>;
  /** Send a queued or failed message again now (the Retry on a failed row). */
  retry: (messageId: Uuid) => Promise<void>;
  /** Remove a queued or failed message that hasn't been sent (the Delete on a failed row). */
  discard: (messageId: Uuid) => void;
  /**
   * Edit a message you previously sent. Optimistically updates the
   * local row, rolls back on server error. Server enforces
   * sender-only authorization — calling this for a message you didn't
   * send will throw an ApiError.
   */
  edit: (messageId: Uuid, body: string) => Promise<Message>;
  /**
   * Soft-delete a message you sent (or that you have admin authority
   * over). Optimistically applies the tombstone (`deleted_at` + null
   * body) locally, rolls back on error.
   */
  delete: (messageId: Uuid) => Promise<void>;
  /**
   * Load older pages until `messageId` is in `messages` — to jump to a
   * message further back than what's loaded. Resolves `true` once it's
   * there, `false` when history runs out (or after `maxPages` pages,
   * default 20) without it: deleted, a thread reply, or not in this
   * conversation.
   */
  loadUntil: (messageId: Uuid, maxPages?: number) => Promise<boolean>;
  /**
   * Advance the caller's read cursor to `messageId`. Server emits
   * read-receipt updates to other members. Once it accepts, the
   * conversation's unread and mention counts drop to zero in every
   * `useConversations()` under the same provider (the server's
   * `conversation:read` push then confirms the exact counts on all of
   * the user's devices).
   */
  markReadUpTo: (messageId: Uuid) => Promise<void>;
  /**
   * The messages shown came from the local cache and the server hasn't
   * answered yet (or can't be reached: offline).
   */
  fromCache: boolean;
  /**
   * Re-fetch the newest page (PAGE_SIZE) and replace the cached
   * messages. Useful when the app returns from background or the
   * realtime socket reconnects after a drop — any messages we missed
   * while disconnected are pulled in via REST. Pagination resets:
   * `hasMore` becomes true again so `loadMore()` will walk back from
   * the new tail.
   */
  refetch: () => Promise<void>;
}

const PAGE_SIZE = 50;

/**
 * Live message list for `conversationId`. Combines:
 *
 *   * Initial REST fetch (newest 50) on mount.
 *   * WebSocket subscription for `message:new`, `message:updated`,
 *     `message:deleted` and `thread:updated` — applied in-place to the
 *     cached array: an update (an edit, or link previews arriving) is
 *     merged into the row, a delete leaves the server's tombstone
 *     (and marks quotes of it deleted), and a thread summary
 *     (`reply_count`, `last_reply_at`, `thread_participants`) lands on
 *     its root.
 *   * Optimistic-send via `send()` — the message appears immediately
 *     under the SAME id the server will assign (we pre-generate it
 *     client-side and pass it through), so the realtime echo and the
 *     REST response both arrive carrying that id and get deduped by
 *     `findIndex(m => m.id === msg.id)`. No heuristic match, no race.
 *
 * Re-mounting with the same `conversationId` reuses the underlying
 * channel — no extra socket traffic.
 *
 * The newest messages of every conversation opened are kept in the
 * client's warm cache (`chat.cache`): opening it again — or switching
 * back to its workspace — shows them at once while the page refetches
 * quietly. With `config.storage` they are also stored, so the history
 * is readable offline and right after a restart. Unsent messages from
 * the outbox show at the end with their `local_status`.
 */
export function useMessages(conversationId: string): UseMessagesState {
  const chat = usePoolse();
  const conversationsStore = useConversationsStore();
  const { me } = useMe();
  const [messages, setMessages] = useState<Message[]>(
    () => initialRows(chat, conversationId) ?? [],
  );
  const [loading, setLoading] = useState(() => !initialRows(chat, conversationId));
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [fromCache, setFromCache] = useState(() => !!chat.cache.peekMessages(conversationId));
  // The conversation the rows in state belong to (cache writes check it).
  const rowsForRef = useRef<string | null>(null);

  // Cursor for `loadMore` — the lowest sequence currently in state.
  const oldestSequenceRef = useRef<number | null>(null);
  // Latest list and `hasMore` for `loadUntil`, which pages in a loop
  // and can't wait for a re-render between pages.
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  // Mutable refetch implementation. Set per-effect (it captures the
  // current conversation's `messages` resource handle). Exposed
  // through the stable `refetch` callback below so consumers can wire
  // it to e.g. `AppState` 'active' without re-binding on every render.
  const refetchRef = useRef<(() => Promise<void>) | null>(null);

  // Hold `me.id` in a ref so `send()` stays stable across renders
  // (otherwise its identity changes every time `me` reloads, which
  // would re-create handlers in calling components).
  const meIdRef = useRef<string | null>(me?.id ?? null);
  meIdRef.current = me?.id ?? null;
  const meExternalIdRef = useRef<string | null>(me?.external_id ?? null);
  meExternalIdRef.current = me?.external_id ?? null;

  // Keep the warm cache in step with what's shown. Declared before the
  // loading effect so that, in the commit that switches conversations,
  // it still sees the old rows paired with the old id and skips.
  useEffect(() => {
    if (rowsForRef.current !== conversationId) return;
    if (messages.some((m) => m.conversation_id !== conversationId)) return;
    if (loading) return;
    chat.cache.setMessages(conversationId, messages);
  }, [chat, conversationId, messages, loading]);

  useEffect(() => {
    let cancelled = false;
    let fresh = false;
    const cached = chat.cache.peekMessages(conversationId);
    rowsForRef.current = conversationId;
    setError(null);
    setHasMore(true);
    if (cached) {
      setMessages(withOutbox(cached, chat, conversationId));
      setLoading(false);
      setFromCache(true);
      oldestSequenceRef.current = cached[0]?.sequence ?? null;
      chat.timings._once('cachedMessages');
    } else {
      setLoading(true);
      setMessages(withOutbox([], chat, conversationId));
      setFromCache(false);
      oldestSequenceRef.current = null;
      // A stored copy (previous session, offline) while the page loads.
      void chat.cache.loadMessages(conversationId).then((stored) => {
        if (cancelled || fresh || !stored || stored.length === 0) return;
        setMessages(withOutbox(stored, chat, conversationId));
        setLoading(false);
        setError(null);
        setFromCache(true);
        oldestSequenceRef.current = stored[0]?.sequence ?? null;
        chat.timings._once('cachedMessages');
      });
    }

    const handle = chat.conversations.one(conversationId).messages;

    handle
      .list({ limit: PAGE_SIZE })
      .then((page) => {
        if (cancelled) return;
        fresh = true;
        // Wire is newest-first; flip for natural reading order.
        const ordered = [...page.data].reverse();
        setMessages((prev) => keepLocal(ordered, prev));
        setHasMore(page.data.length === PAGE_SIZE);
        oldestSequenceRef.current = ordered[0]?.sequence ?? null;
        setLoading(false);
        setFromCache(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Offline with cached rows: show those, not an error.
        if (chat.cache.peekMessages(conversationId)) {
          setLoading(false);
          return;
        }
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });

    refetchRef.current = async () => {
      const page = await handle.list({ limit: PAGE_SIZE });
      const ordered = [...page.data].reverse();
      setMessages((prev) => keepLocal(ordered, prev));
      setHasMore(page.data.length === PAGE_SIZE);
      oldestSequenceRef.current = ordered[0]?.sequence ?? null;
      setFromCache(false);
    };

    // Unsent messages: follow the outbox (queued → failed, a retry, a
    // discard), and swap in the server's row once one is delivered.
    const syncOutbox = () => {
      if (cancelled) return;
      const entries = chat.outbox.entries(conversationId);
      setMessages((prev) => applyOutbox(prev, entries));
    };
    const offOutbox = chat.outbox.subscribe(syncOutbox);
    const offSent = chat.outbox.onSent((entry, sent) => {
      if (cancelled || entry.conversationId !== conversationId) return;
      setMessages((prev) => upsertById(prev, sent));
    });

    // Realtime listeners.
    const conv = chat.realtime.conversation(conversationId);

    const offNew = conv.onMessage((msg) => {
      // Thread replies don't live in the main feed — they belong to
      // the side-pane that `useThread` populates. So when a reply
      // arrives over realtime, route it to the root's reply_count
      // ONLY, and skip the main-list upsert. The server now mirrors
      // this rule on the REST list (`WHERE thread_root_id IS NULL`),
      // so post-refresh state matches realtime behavior.
      if (msg.thread_root_id) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msg.thread_root_id ? { ...m, reply_count: (m.reply_count ?? 0) + 1 } : m,
          ),
        );
        return;
      }
      // Top-level message: standard by-id upsert. Covers three cases:
      //   1) Brand-new message from another user → append.
      //   2) Echo of our own optimistic send (id we generated below) →
      //      replace the temp row in place (preserves position).
      //   3) Re-delivery on channel rejoin → idempotent replace.
      setMessages((prev) => upsertById(prev, msg));
    });

    // An edit, or the link previews the server fetched after a send:
    // merged, so fields an older server leaves out survive.
    const offUpdated = conv.onMessageUpdated((msg) => {
      setMessages((prev) => patchById(prev, msg.id, (m) => mergeMessage(m, msg)));
    });

    const offDeleted = conv.onMessageDeleted((evt) => {
      setMessages((prev) => {
        // The thread the message was in: the event says (newer servers),
        // else a row we hold does. Replies aren't in this list, so
        // without the event's field a reply's root isn't found.
        const rootId = evt.thread_root_id ?? prev.find((m) => m.id === evt.id)?.thread_root_id;
        return prev.map((m) => {
          if (m.id === evt.id) return toTombstone(m, evt.deleted_at);
          if (rootId && m.id === rootId) {
            m = { ...m, reply_count: Math.max(0, (m.reply_count ?? 0) - 1) };
          }
          return markQuoteDeleted(m, evt.id, evt.deleted_at);
        });
      });
    });

    // The server's own thread summary after a reply was posted or
    // deleted — overrides the local +1 / -1 above.
    const offThread = conv.onThreadUpdated((evt) => {
      setMessages((prev) => patchById(prev, evt.message_id, (m) => applyThreadUpdate(m, evt)));
    });

    // Events sent while the socket was down (a network drop, or the app
    // in the background) are never replayed, so catch up from REST once
    // it is back. Merged by id, so older loaded pages and pending sends
    // survive.
    // The socket's first connect isn't a reconnect: the list above is
    // already loading.
    let wasConnected = chat.realtime.getStatus() === 'connected';
    let connectedBefore = wasConnected;
    const offStatus = chat.realtime.onStatus((status) => {
      const reconnected = status === 'connected' && !wasConnected && connectedBefore;
      wasConnected = status === 'connected';
      connectedBefore ||= wasConnected;
      if (!reconnected || cancelled) return;
      handle
        .list({ limit: PAGE_SIZE })
        .then((page) => {
          if (!cancelled) {
            setMessages((prev) => mergeLatest(prev, page.data));
            setFromCache(false);
          }
        })
        .catch(() => {
          // The next reconnect or an explicit refetch() tries again.
        });
    });

    return () => {
      cancelled = true;
      offNew();
      offUpdated();
      offDeleted();
      offThread();
      offStatus();
      offOutbox();
      offSent();
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
    // Overlapping loads (two `loadMore`s, or one beside `loadUntil`) can
    // fetch the same page: keep each message once.
    setMessages((prev) => {
      const have = new Set(prev.map((m) => m.id));
      return [...older.filter((m) => !have.has(m.id)), ...prev];
    });
    setHasMore(page.data.length === PAGE_SIZE);
    const first = older[0]?.sequence;
    const current = oldestSequenceRef.current;
    if (first != null)
      oldestSequenceRef.current = current == null ? first : Math.min(current, first);
  }, [chat, conversationId, hasMore, loading]);

  const loadUntil = useCallback(
    async (messageId: Uuid, maxPages = 20): Promise<boolean> => {
      if (messagesRef.current.some((m) => m.id === messageId)) return true;
      const handle = chat.conversations.one(conversationId).messages;
      for (let i = 0; i < maxPages; i++) {
        const before = oldestSequenceRef.current;
        if (before === null || !hasMoreRef.current) return false;
        const page = await handle.list({ limit: PAGE_SIZE, before });
        const older = [...page.data].reverse();
        if (older.length > 0) {
          // A concurrent `loadMore` may have fetched the same page.
          setMessages((prev) => {
            const have = new Set(prev.map((m) => m.id));
            return [...older.filter((m) => !have.has(m.id)), ...prev];
          });
          oldestSequenceRef.current = older[0]!.sequence;
        }
        hasMoreRef.current = page.data.length === PAGE_SIZE;
        setHasMore(hasMoreRef.current);
        if (older.some((m) => m.id === messageId)) return true;
      }
      return false;
    },
    [chat, conversationId],
  );

  const send = useCallback(
    async (attrs: MessageCreateRequest) => {
      // Generate the message id client-side and pass it through, so
      // the optimistic row, the REST response, and the realtime echo
      // ALL share one id — id-based upsert handles every race.
      const id = attrs.id ?? safeUuid();
      const tempMsg: Message = {
        id,
        tenant_id: '',
        conversation_id: conversationId,
        // Stamp the current user's id so the optimistic row renders
        // on the right (self) side from the moment it appears. Null
        // here would briefly flash the row on the "other" side until
        // the realtime echo replaced it with the canonical row.
        sender_id: meIdRef.current,
        sender_external_id: meExternalIdRef.current,
        type: attrs.type ?? 'text',
        body: attrs.body ?? null,
        reply_to_id: attrs.reply_to_id ?? null,
        thread_root_id: null,
        // Optimistic quote: keep the id locally so the bubble can flag
        // itself as a quote-reply immediately. `quoted_message` (the
        // preview card body/sender) only lands when the server echo
        // arrives — the UI can render a placeholder ("Quoted message")
        // in the gap or wait silently; current bubble does the latter.
        quoted_message_id: attrs.quoted_message_id ?? null,
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

      if (chat.outboxEnabled) {
        setMessages((prev) => upsertById(prev, { ...tempMsg, local_status: 'sending' }));
        // Queued (offline) or refused: the row stays, following the
        // outbox; the rejection tells the caller which.
        const sent = await chat.outbox.send(conversationId, { ...attrs, id }, tempMsg);
        setMessages((prev) => upsertById(prev, sent));
        return sent;
      }

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

  const edit = useCallback(
    async (messageId: Uuid, body: string): Promise<Message> => {
      // Optimistic: capture the previous body so we can roll back if the
      // PATCH fails. `edited_at` is set to "now" client-side; the server
      // will overwrite with its authoritative timestamp on the realtime
      // echo + REST response.
      let previous: Message | undefined;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          previous = m;
          return { ...m, body, edited_at: new Date().toISOString() };
        }),
      );

      try {
        const updated = await chat.messages.one(messageId).update({ body });
        // Merge in the canonical row (right edited_at, etc).
        setMessages((prev) => patchById(prev, messageId, (m) => mergeMessage(m, updated)));
        return updated;
      } catch (err) {
        if (previous) {
          const restore = previous;
          setMessages((prev) => prev.map((m) => (m.id === messageId ? restore : m)));
        }
        throw err;
      }
    },
    [chat],
  );

  const deleteMessage = useCallback(
    async (messageId: Uuid): Promise<void> => {
      // Optimistic tombstone — same shape the realtime delete handler
      // applies, so the UI is consistent regardless of which path
      // (REST response or WS push) lands first.
      let previous: Message | undefined;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          previous = m;
          return toTombstone(m, new Date().toISOString());
        }),
      );

      try {
        await chat.messages.one(messageId).delete();
      } catch (err) {
        if (previous) {
          const restore = previous;
          setMessages((prev) => prev.map((m) => (m.id === messageId ? restore : m)));
        }
        throw err;
      }
    },
    [chat],
  );

  const markReadUpTo = useCallback(
    async (messageId: Uuid): Promise<void> => {
      // Fire-and-forget — server updates the caller's last_read_message_id
      // and broadcasts the resulting membership update to other clients
      // (which is what drives read-receipt glyphs in their UIs).
      await chat.conversations.one(conversationId).messages.markRead(messageId);
      conversationsStore.markRead(conversationId);
    },
    [chat, conversationId, conversationsStore],
  );

  const retry = useCallback(
    async (messageId: Uuid): Promise<void> => {
      try {
        await chat.outbox.retry(messageId);
      } catch (err) {
        // Still offline: it stays queued. A refusal stays as failed.
        if (err instanceof MessageQueuedError) return;
        throw err;
      }
    },
    [chat],
  );

  const discard = useCallback(
    (messageId: Uuid): void => {
      chat.outbox.remove(messageId);
      setMessages((prev) => prev.filter((m) => m.id !== messageId || !m.local_status));
    },
    [chat],
  );

  const refetch = useCallback(async (): Promise<void> => {
    const fn = refetchRef.current;
    if (!fn) return;
    await fn();
  }, []);

  return {
    messages,
    loading,
    error,
    hasMore,
    loadMore,
    loadUntil,
    send,
    retry,
    discard,
    edit,
    delete: deleteMessage,
    markReadUpTo,
    fromCache,
    refetch,
  };
}

// The rows to show before anything loads: the warm cache (plus unsent).
function initialRows(chat: Poolse, conversationId: string): Message[] | null {
  const cached = chat.cache.peekMessages(conversationId);
  return cached ? withOutbox(cached, chat, conversationId) : null;
}

function withOutbox(rows: Message[], chat: Poolse, conversationId: string): Message[] {
  return applyOutbox(rows, chat.outbox.entries(conversationId));
}

/**
 * Bring the unsent rows in line with the outbox: each entry's row
 * (added, or updated while it's still the local copy), and local rows
 * whose entry is gone (sent — the server row replaces it — or
 * discarded) removed.
 */
function applyOutbox(prev: Message[], entries: ReadonlyArray<OutboxEntry>): Message[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  let next = prev.filter((m) => !m.local_status || byId.has(m.id));
  for (const entry of entries) {
    const idx = next.findIndex((m) => m.id === entry.id);
    // The server's row arrived (realtime echo): it wins.
    if (idx !== -1 && !next[idx]!.local_status) continue;
    if (idx !== -1 && next[idx] === entry.message) continue;
    next = upsertById(next, entry.message);
  }
  return next.length === prev.length && next.every((m, i) => m === prev[i]) ? prev : next;
}

/** A fresh page, plus the unsent rows that aren't in it. */
function keepLocal(page: Message[], prev: Message[]): Message[] {
  const local = prev.filter((m) => m.local_status && !page.some((p) => p.id === m.id));
  return local.length === 0 ? page : [...page, ...local];
}

function patchById(prev: Message[], id: Uuid, fn: (m: Message) => Message): Message[] {
  const idx = prev.findIndex((m) => m.id === id);
  if (idx === -1) return prev;
  const next = prev.slice();
  next[idx] = fn(prev[idx]!);
  return next;
}

function upsertById(prev: Message[], msg: Message): Message[] {
  const idx = prev.findIndex((m) => m.id === msg.id);
  if (idx === -1) return [...prev, msg];
  const next = prev.slice();
  next[idx] = msg;
  return next;
}

/** Upsert a freshly fetched page into the list, kept in sequence order. */
function mergeLatest(prev: Message[], page: Message[]): Message[] {
  let next = prev;
  for (const msg of page) next = upsertById(next, msg);
  return next === prev ? prev : [...next].sort((a, b) => a.sequence - b.sequence);
}
