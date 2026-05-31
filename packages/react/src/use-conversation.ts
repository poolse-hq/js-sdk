import type { Conversation, Uuid } from '@poolse/sdk';
import { useCallback, useEffect, useState } from 'react';
import { usePoolse } from './provider.js';

interface UseConversationState {
  /** The fetched conversation, or `null` while loading or on error. */
  conversation: Conversation | null;
  loading: boolean;
  error: Error | null;
  /** Re-run the GET. Use after a `chat.conversations.one(id).update(...)` to refresh state. */
  refetch: () => Promise<void>;
}

/**
 * Fetch a single conversation by id. Re-fetches when `id` changes
 * (e.g. routing to a different conversation in the same component).
 *
 * Doesn't subscribe to realtime updates yet — the backend doesn't
 * broadcast `conversation:updated` to user channels. Use `refetch()`
 * after a mutation if you need fresh state in the same render cycle.
 *
 * ```ts
 * const { conversation, loading } = useConversation(convId);
 * if (loading) return <Spinner />;
 * if (!conversation) return <NotFound />;
 * return <h1>{conversation.name ?? 'Untitled'}</h1>;
 * ```
 */
export function useConversation(id: Uuid | null): UseConversationState {
  const chat = usePoolse();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(id !== null);
  const [error, setError] = useState<Error | null>(null);

  // The fetcher is wrapped in useCallback so it's stable across
  // renders for the same id — lets callers depend on it in their
  // own effects (e.g. polling) without re-firing on every render.
  const fetcher = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      if (id === null) return;
      setLoading(true);
      setError(null);
      try {
        const conv = await chat.conversations.one(id).show(signal);
        setConversation(conv);
      } catch (err) {
        // Ignore AbortError — the caller hit unmount or a new id.
        if ((err as DOMException)?.name === 'AbortError') return;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setLoading(false);
      }
    },
    [chat, id],
  );

  useEffect(() => {
    if (id === null) {
      setConversation(null);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    void fetcher(controller.signal);
    return () => controller.abort();
  }, [fetcher, id]);

  const refetch = useCallback(() => fetcher(), [fetcher]);

  return { conversation, loading, error, refetch };
}
