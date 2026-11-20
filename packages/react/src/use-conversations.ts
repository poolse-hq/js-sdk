import type { Conversation, ConversationCreateRequest, Uuid } from '@poolse/sdk';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useConversationsStore } from './provider.js';
import { useMe } from './use-me.js';

interface UseConversationsState {
  conversations: Conversation[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  create: (attrs: ConversationCreateRequest) => Promise<Conversation>;
  /**
   * Per-conversation unread count, keyed by conversation id (only
   * conversations with unread messages appear). Sourced from
   * `Conversation.unread_count` and kept fresh by realtime
   * (`conversation:updated`, and `conversation:read` when the user
   * reads on any of their devices) and by `markReadUpTo` /
   * `markConversationRead` anywhere under the same provider.
   */
  unreadCounts: Record<Uuid, number>;
  /** Like `unreadCounts`, for unread messages that mention the user. */
  mentionUnreadCounts: Record<Uuid, number>;
  /**
   * Force a conversation's unread and mention counts to 0 in every
   * view. `useMessages().markReadUpTo` does this for you once the
   * server accepts it.
   */
  markConversationRead: (conversationId: Uuid) => void;
}

/**
 * List of conversations the current End User can see.
 *
 * Every `useConversations()` under one `<PoolseProvider>` shares one
 * list: a sidebar and an inbox header show the same rows and the same
 * badges, and reading a conversation anywhere clears its badge
 * everywhere.
 *
 * The first one mounted REST-fetches the list and subscribes to the
 * user's `user:<id>` channel for `conversation:created` (this user
 * created a conversation or was added to one), `conversation:updated`
 * (a message was sent) and `conversation:read` (this user read it on
 * some device). New rows are prepended with id-based dedup so an
 * optimistic `create()` followed by the realtime echo doesn't insert
 * twice.
 *
 * `refetch()` is still here for explicit re-syncs (e.g. after a
 * mutation that the SDK doesn't yet observe — name changes,
 * settings updates). `create()` returns the canonical server row.
 */
export function useConversations(): UseConversationsState {
  const store = useConversationsStore();
  // Loads the user, so the store knows whose channel to listen on.
  useMe();
  const [snapshot, setSnapshot] = useState(() => store.getSnapshot());

  useEffect(() => {
    const off = store.subscribe(() => setSnapshot(store.getSnapshot()));
    setSnapshot(store.getSnapshot());
    return off;
  }, [store]);

  const refetch = useCallback(() => store.refetch(), [store]);
  const create = useCallback((attrs: ConversationCreateRequest) => store.create(attrs), [store]);
  const markConversationRead = useCallback(
    (conversationId: Uuid) => store.markRead(conversationId),
    [store],
  );

  const { conversations, loading, error } = snapshot;

  const unreadCounts = useMemo(() => countsOf(conversations, 'unread_count'), [conversations]);
  const mentionUnreadCounts = useMemo(
    () => countsOf(conversations, 'mention_unread_count'),
    [conversations],
  );

  return {
    conversations,
    loading,
    error,
    refetch,
    create,
    unreadCounts,
    mentionUnreadCounts,
    markConversationRead,
  };
}

function countsOf(
  conversations: Conversation[],
  key: 'unread_count' | 'mention_unread_count',
): Record<Uuid, number> {
  const out: Record<Uuid, number> = {};
  for (const c of conversations) {
    const n = c[key];
    if (typeof n === 'number' && n > 0) out[c.id] = n;
  }
  return out;
}
