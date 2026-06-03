// React binding over `chat.users.get(externalId)`.
//
// Uses plain useState + useEffect (NOT `useSyncExternalStore`).
// useSyncExternalStore reaches into React internals and surfaces
// any latent React-duplication immediately as "Invalid hook call".
// The pattern below works the same way for our purposes — read
// from the cache on mount, subscribe for updates, update state —
// without that fragility.

import type { PoolseUserProfile } from '@poolse/sdk';
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
 * Resolve the tenant's `external_id` (your own user id) to
 * `{ displayName, avatarUrl }` via the configured `userResolver`.
 *
 * Returns `{ profile: null, loading: false }` when:
 *   * no resolver is configured
 *   * resolver returned null (user not found)
 *   * resolver threw (logged once, then cached as null)
 *
 * Pass `null` / empty string to opt out (the hook becomes a no-op).
 * Useful for self bubbles (you already know who you are).
 */
export function useUser(externalId: string | null | undefined): UseUserState {
  const chat = usePoolse();
  const [state, setState] = useState<UseUserState>(() => {
    if (!externalId) return EMPTY;
    const cached = chat.users.peek(externalId);
    if (cached === undefined) return { profile: null, loading: true };
    return { profile: cached, loading: false };
  });

  useEffect(() => {
    if (!externalId) {
      setState(EMPTY);
      return;
    }

    const apply = () => {
      const cached = chat.users.peek(externalId);
      if (cached === undefined) {
        setState({ profile: null, loading: true });
        void chat.users.get(externalId);
      } else {
        setState({ profile: cached, loading: false });
      }
    };

    const off = chat.users.subscribe(externalId, apply);
    apply();
    return off;
  }, [chat, externalId]);

  return state;
}
