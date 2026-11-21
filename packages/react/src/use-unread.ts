// Unread totals per client (a workspace rail's badges) and the
// catch-up queue of unread conversations.

import type { Conversation, Poolse, UnreadTotals, Uuid } from '@poolse/sdk';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useOptionalPoolse, usePoolse } from './provider.js';
import { useConversations } from './use-conversations.js';

export interface UseUnreadTotals extends UnreadTotals {
  /** Fetch the totals again. */
  refresh: () => Promise<void>;
}

/**
 * Unread and mention totals for one client — every conversation on
 * that server, not just the loaded ones — kept live from realtime.
 *
 * Inside a provider it reads that provider's client; pass a client to
 * read another one (a workspace rail outside every workspace's
 * provider):
 *
 * ```tsx
 * function RailIcon({ client }: { client: Poolse }) {
 *   const { unread, mentions } = useUnreadTotals(client);
 *   return <Badge count={mentions || unread} strong={mentions > 0} />;
 * }
 * ```
 *
 * Needs the server's `GET /v1/me/unread`; on a server without it the
 * totals are the sum of the loaded conversation list (`source: 'local'`).
 */
export function useUnreadTotals(client?: Poolse): UseUnreadTotals {
  const fromContext = useOptionalPoolse();
  const chat = client ?? fromContext;
  if (!chat) {
    throw new Error('useUnreadTotals(): pass a client, or render inside a <PoolseProvider>.');
  }
  const subscribe = useCallback((fn: () => void) => chat.unread.subscribe(fn), [chat]);
  const totals = useSyncExternalStore(subscribe, () => chat.unread.get());
  const refresh = useCallback(() => chat.unread.refresh(), [chat]);
  return useMemo(() => ({ ...totals, refresh }), [totals, refresh]);
}

export interface UseUnreadQueueOptions {
  /** Conversations with unread mentions come first. Default `false`. */
  mentionsFirst?: boolean;
  /** Leave some conversations out (muted ones, say). */
  filter?: (conversation: Conversation) => boolean;
}

export interface UseUnreadQueue {
  /** Unread conversations in walk-through order (most recent activity first). */
  queue: Conversation[];
  /** The conversation being read now: stays put after it's marked read, until `next()`. */
  current: Conversation | null;
  /** How many unread conversations remain after `current`. */
  remaining: number;
  /** Mark `current` read and move to the next one. Returns it (null when caught up). */
  next: () => Conversation | null;
  /** Move to the next one without marking `current` read; it's not offered again until `reset()`. */
  skip: () => Conversation | null;
  /** Mark one conversation read up to its latest message. */
  markRead: (conversationId: Uuid) => Promise<void>;
  /** Offer skipped conversations again. */
  reset: () => void;
}

/**
 * Catch up on unreads: the unread conversations one after another —
 * j/k on desktop, a swipe on phones — marking each read as you go.
 * Built on the shared conversation list, so badges everywhere follow.
 *
 * ```tsx
 * const { current, next, skip, remaining } = useUnreadQueue({ mentionsFirst: true });
 * if (!current) return <p>All caught up.</p>;
 * return <CatchUp conversation={current} onNext={next} onSkip={skip} left={remaining} />;
 * ```
 */
export function useUnreadQueue(opts: UseUnreadQueueOptions = {}): UseUnreadQueue {
  const chat = usePoolse();
  const { conversations, markConversationRead } = useConversations();
  const { mentionsFirst = false, filter } = opts;
  const [skipped, setSkipped] = useState<ReadonlySet<Uuid>>(() => new Set());
  const [currentId, setCurrentId] = useState<Uuid | null>(null);

  const queue = useMemo(
    () => orderUnread(conversations, { mentionsFirst, ...(filter ? { filter } : {}) }),
    [conversations, mentionsFirst, filter],
  );
  const offered = useMemo(() => queue.filter((c) => !skipped.has(c.id)), [queue, skipped]);

  // `current` stays the same conversation while it's being read (it
  // leaves `queue` once marked read); otherwise the first one offered.
  const pinned = currentId ? (conversations.find((c) => c.id === currentId) ?? null) : null;
  const current = pinned ?? offered[0] ?? null;
  useEffect(() => {
    if (currentId && !pinned) setCurrentId(null);
  }, [currentId, pinned]);

  const markRead = useCallback(
    async (conversationId: Uuid) => {
      markConversationRead(conversationId);
      const page = await chat.conversations.one(conversationId).messages.list({ limit: 1 });
      const latest = page.data[0];
      if (latest) await chat.conversations.one(conversationId).messages.markRead(latest.id);
    },
    [chat, markConversationRead],
  );

  const after = (id: Uuid | undefined) => offered.find((c) => c.id !== id) ?? null;

  const next = () => {
    if (current) void markRead(current.id).catch(() => {});
    const following = after(current?.id);
    setCurrentId(following?.id ?? null);
    return following;
  };

  const skip = () => {
    const id = current?.id;
    if (id) setSkipped((s) => new Set(s).add(id));
    const following = after(id);
    setCurrentId(following?.id ?? null);
    return following;
  };

  const reset = useCallback(() => setSkipped(new Set()), []);

  return {
    queue,
    current,
    remaining: offered.filter((c) => c.id !== current?.id).length,
    next,
    skip,
    markRead,
    reset,
  };
}

/** Unread conversations, most recent activity first (mentions first if asked). */
export function orderUnread(
  conversations: ReadonlyArray<Conversation>,
  opts: UseUnreadQueueOptions = {},
): Conversation[] {
  const unread = conversations.filter(
    (c) => (c.unread_count ?? 0) > 0 && (!opts.filter || opts.filter(c)),
  );
  const at = (c: Conversation) => (c.last_message_at ? Date.parse(c.last_message_at) : 0);
  return unread.sort((a, b) => {
    if (opts.mentionsFirst) {
      const ma = (a.mention_unread_count ?? 0) > 0 ? 1 : 0;
      const mb = (b.mention_unread_count ?? 0) > 0 ? 1 : 0;
      if (ma !== mb) return mb - ma;
    }
    return at(b) - at(a);
  });
}
