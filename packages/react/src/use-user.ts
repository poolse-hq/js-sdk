// React binding over `chat.users.get(userId)`.
//
// Subscribes to the cache via `useSyncExternalStore` so every bubble
// rendering the same user re-renders together when the customer's
// resolver lands. Concurrent requests for the same id share one
// resolver call (dedup'd inside `UsersResource`).

import type { PoolseUserProfile, Uuid } from '@poolse/sdk';
import { useEffect, useSyncExternalStore } from 'react';
import { usePoolse } from './provider.js';

export interface UseUserState {
  /** Resolved profile, or null when the resolver returned null / errored / isn't configured. */
  profile: PoolseUserProfile | null;
  /** True while the SDK is mid-fetch (or before the first fetch fires). */
  loading: boolean;
}

const EMPTY: UseUserState = { profile: null, loading: false };

/**
 * Resolve a poolse user_id to the customer's display name + avatar
 * URL via the configured `userResolver`. Returns `{ profile: null,
 * loading: false }` when:
 *   * no resolver is configured (customer hasn't wired one up)
 *   * resolver returned null (user not found)
 *   * resolver threw (logged once, then cached as null)
 *
 * Pass `null` / empty string to opt out (the hook becomes a no-op).
 * Useful for self bubbles (you already know who you are).
 */
export function useUser(userId: Uuid | null | undefined): UseUserState {
  const chat = usePoolse();

  // Fire the fetch on mount + when the userId changes. UsersResource
  // dedupes — N components asking for the same id on the same render
  // tick share ONE resolver call.
  useEffect(() => {
    if (!userId) return;
    // We don't need the resolved value here — the subscribe path
    // below picks it up. Just trigger the lookup.
    void chat.users.get(userId);
  }, [chat, userId]);

  const subscribe = (cb: () => void): (() => void) => {
    if (!userId) return () => undefined;
    return chat.users.subscribe(userId, cb);
  };

  const getSnapshot = (): UseUserState => {
    if (!userId) return EMPTY;
    const cached = chat.users.peek(userId);
    if (cached === undefined) {
      // Not in cache yet — useEffect above will fire the fetch.
      return { profile: null, loading: true };
    }
    return { profile: cached, loading: false };
  };

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
