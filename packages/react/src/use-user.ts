// React binding over `chat.users.get(userId)`.
//
// Uses plain useState + useEffect (NOT `useSyncExternalStore`).
// useSyncExternalStore reaches into React internals and surfaces
// any latent React-duplication immediately as "Invalid hook call".
// The pattern below works the same way for our purposes — read
// from the cache on mount, subscribe for updates, update state —
// without that fragility.

import type { PoolseUserProfile, Uuid } from '@poolse/sdk';
import { useEffect, useState } from 'react';
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
  const [state, setState] = useState<UseUserState>(() => {
    if (!userId) return EMPTY;
    const cached = chat.users.peek(userId);
    if (cached === undefined) return { profile: null, loading: true };
    return { profile: cached, loading: false };
  });

  useEffect(() => {
    if (!userId) {
      setState(EMPTY);
      return;
    }

    const apply = () => {
      const cached = chat.users.peek(userId);
      if (cached === undefined) {
        setState({ profile: null, loading: true });
      } else {
        setState({ profile: cached, loading: false });
      }
    };

    // Subscribe BEFORE triggering the fetch so we never miss the
    // notify if the resolver lands synchronously.
    const off = chat.users.subscribe(userId, apply);
    void chat.users.get(userId);
    // Pull a fresh snapshot in case the cache already has the entry
    // (subscribe doesn't fire for existing values).
    apply();
    return off;
  }, [chat, userId]);

  return state;
}
