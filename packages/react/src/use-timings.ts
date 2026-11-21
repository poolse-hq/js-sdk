import type { Poolse } from '@poolse/sdk';
import { useCallback, useRef, useSyncExternalStore } from 'react';
import { useOptionalPoolse } from './provider.js';

/**
 * The client's timings so far, by name (`connect`, `firstConversations`,
 * `firstMessages`, `cachedMessages`, `reconnect`, and the app's own),
 * in milliseconds — re-rendering as new ones are recorded.
 */
export function useClientTimings(client?: Poolse): Record<string, number> {
  const fromContext = useOptionalPoolse();
  const chat = client ?? fromContext;
  if (!chat) {
    throw new Error('useClientTimings(): pass a client, or render inside a <PoolseProvider>.');
  }
  const snapshot = useRef<{ chat: Poolse; value: Record<string, number> } | null>(null);
  const subscribe = useCallback(
    (fn: () => void) =>
      chat.timings.on(() => {
        snapshot.current = null;
        fn();
      }),
    [chat],
  );
  const get = () => {
    if (!snapshot.current || snapshot.current.chat !== chat) {
      snapshot.current = { chat, value: chat.timings.get() };
    }
    return snapshot.current.value;
  };
  return useSyncExternalStore(subscribe, get);
}
