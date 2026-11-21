// React binding over `chat.users.get(externalId)`.
//
// Uses plain useState + useEffect (NOT `useSyncExternalStore`).
// useSyncExternalStore reaches into React internals and surfaces
// any latent React-duplication immediately as "Invalid hook call".
// The pattern below works the same way for our purposes — read
// from the cache on mount, subscribe for updates, update state —
// without that fragility.

import type { AgentInfo, PoolseUserProfile } from '@poolse/sdk';
import { useEffect, useRef, useState } from 'react';
import { usePoolse } from './provider.js';

export interface UseUserState {
  /** Resolved profile, or null when the resolver returned null / errored / isn't configured. */
  profile: PoolseUserProfile | null;
  /** True while the SDK is mid-fetch (or before the first fetch fires). */
  loading: boolean;
  /**
   * Set when this user is an agent (AG1) — from the server's `is_agent`
   * on members and messages, or the resolver's `isAgent`. Show the
   * Agent badge whenever it is set.
   */
  agent: AgentInfo | null;
}

const EMPTY: UseUserState = { profile: null, loading: false, agent: null };

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
 *
 * After `chat.users.invalidate(externalId)` (or a `member:updated` app
 * event) the hook re-resolves the user, showing the old profile until
 * the new one lands.
 */
export function useUser(externalId: string | null | undefined): UseUserState {
  const chat = usePoolse();
  // Whose profile `state` holds, so a refresh keeps it on screen but a
  // switch to another user doesn't.
  const shownForRef = useRef<string | null>(null);
  const agentRef = useRef<AgentInfo | null>(null);
  const [state, setState] = useState<UseUserState>(() => {
    if (!externalId) return EMPTY;
    const cached = chat.users.peek(externalId);
    const agent = chat.users.agentOf(externalId);
    if (cached === undefined) return { profile: null, loading: true, agent };
    return { profile: cached, loading: false, agent };
  });

  useEffect(() => {
    if (!externalId) {
      setState(EMPTY);
      return;
    }

    const apply = () => {
      const cached = chat.users.peek(externalId);
      const agent = sameAgent(agentRef.current, chat.users.agentOf(externalId));
      agentRef.current = agent;
      if (cached === undefined) {
        const keep = shownForRef.current === externalId;
        setState((prev) => ({ profile: keep ? prev.profile : null, loading: true, agent }));
        void chat.users.get(externalId);
      } else {
        shownForRef.current = externalId;
        setState({ profile: cached, loading: false, agent });
      }
    };

    const off = chat.users.subscribe(externalId, apply);
    apply();
    return off;
  }, [chat, externalId]);

  return state;
}

/** The same object when nothing changed, so renders stay cheap. */
function sameAgent(prev: AgentInfo | null, next: AgentInfo | null): AgentInfo | null {
  if (prev && next && prev.id === next.id && prev.name === next.name && prev.kind === next.kind) {
    return prev;
  }
  return next;
}

/** Whether `externalId` is an agent, live (AG1): its `AgentInfo`, or null for a person. */
export function useAgent(externalId: string | null | undefined): AgentInfo | null {
  return useUser(externalId).agent;
}
