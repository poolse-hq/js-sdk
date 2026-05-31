import type { Conversation, ConversationCreateRequest } from '@poolse/sdk';
import { useCallback, useEffect, useState } from 'react';
import { usePoolse } from './provider.js';
import { useMe } from './use-me.js';

interface UseConversationsState {
  conversations: Conversation[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  create: (attrs: ConversationCreateRequest) => Promise<Conversation>;
}

/**
 * List of conversations the current End User can see.
 *
 * On mount: REST-fetches the list and subscribes to the user's
 * `user:<id>` channel for `conversation:created` events — fired by
 * the server both when this user creates a conversation AND when
 * someone else adds them to one. New rows are prepended to local
 * state with id-based dedup so an optimistic `create()` followed by
 * the realtime echo doesn't insert twice.
 *
 * `refetch()` is still here for explicit re-syncs (e.g. after a
 * mutation that the SDK doesn't yet observe — name changes,
 * settings updates). `create()` returns the canonical server row.
 */
export function useConversations(): UseConversationsState {
  const chat = usePoolse();
  const { me } = useMe();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const list = await chat.conversations.list();
      setConversations(list.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [chat]);

  const create = useCallback(
    async (attrs: ConversationCreateRequest) => {
      const conv = await chat.conversations.create(attrs);
      // Optimistically prepend; if the realtime echo arrives later
      // for the same conv (because the server also broadcast it to
      // us as the creator), the id-based dedup in `prepend` keeps
      // it from inserting twice.
      setConversations((prev) => prepend(prev, conv));
      return conv;
    },
    [chat],
  );

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Realtime: subscribe to `user:<me.id>:conversation:created` once we
  // know who "me" is. Re-subscribes if `me.id` changes (rare — only on
  // sign-in/sign-out within the same provider, which is itself rare).
  useEffect(() => {
    if (!me) return;
    const userChan = chat.realtime.user(me.id);
    const off = userChan.onConversationCreated((conv) => {
      setConversations((prev) => prepend(prev, conv));
    });
    return off;
  }, [chat, me]);

  return { conversations, loading, error, refetch, create };
}

/**
 * Prepend `conv` if its id isn't already in `prev`; otherwise replace
 * the existing row (covers the race where the realtime echo arrives
 * for a conversation our local `create()` already inserted).
 */
function prepend(prev: Conversation[], conv: Conversation): Conversation[] {
  const idx = prev.findIndex((c) => c.id === conv.id);
  if (idx === -1) return [conv, ...prev];
  const next = prev.slice();
  next[idx] = conv;
  return next;
}
