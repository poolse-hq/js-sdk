import type { OutboxEntry, Poolse, Uuid } from '@poolse/sdk';
import { MessageQueuedError } from '@poolse/sdk';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useOptionalPoolse } from './provider.js';

export interface UseOutbox {
  /** Unsent messages, oldest first: `queued` (offline), `sending`, `failed`. */
  entries: OutboxEntry[];
  /** How many are `queued` or `sending`. */
  pending: number;
  /** How many the server refused. */
  failed: number;
  /** Send one again now. A still-offline retry stays queued. */
  retry: (id: Uuid) => Promise<void>;
  /** Drop one that hasn't been sent. */
  remove: (id: Uuid) => void;
  /** Try every queued one now. */
  flush: () => Promise<void>;
}

/**
 * The client's outbox — for an "N messages waiting to send" banner or a
 * list of failed sends. `useMessages` already shows these rows in their
 * conversation; this is the cross-conversation view.
 */
export function useOutbox(opts: { conversationId?: Uuid; client?: Poolse } = {}): UseOutbox {
  const fromContext = useOptionalPoolse();
  const chat = opts.client ?? fromContext;
  if (!chat) throw new Error('useOutbox(): pass a client, or render inside a <PoolseProvider>.');
  const subscribe = useCallback((fn: () => void) => chat.outbox.subscribe(fn), [chat]);
  const all = useSyncExternalStore(subscribe, () => chat.outbox.entries());
  const { conversationId } = opts;
  const entries = useMemo(
    () => (conversationId ? all.filter((e) => e.conversationId === conversationId) : all),
    [all, conversationId],
  );
  const retry = useCallback(
    async (id: Uuid) => {
      try {
        await chat.outbox.retry(id);
      } catch (err) {
        if (!(err instanceof MessageQueuedError)) throw err;
      }
    },
    [chat],
  );
  const remove = useCallback((id: Uuid) => chat.outbox.remove(id), [chat]);
  const flush = useCallback(() => chat.outbox.flush(), [chat]);
  return {
    entries,
    pending: entries.filter((e) => e.status !== 'failed').length,
    failed: entries.filter((e) => e.status === 'failed').length,
    retry,
    remove,
    flush,
  };
}
