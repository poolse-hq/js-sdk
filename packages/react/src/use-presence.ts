import type { PresenceSnapshot } from '@poolse/sdk';
import { useEffect, useState } from 'react';
import { usePoolse } from './provider.js';

interface UsePresenceState {
  /**
   * Set of `external_id`s currently online in this conversation —
   * the tenant's own user identifiers. Empty set when no one is on
   * the channel (note: an empty result during reconnect is normal;
   * pair with `useRealtimeStatus()` if you need to distinguish).
   */
  online: Set<string>;
}

// Pull external_id out of the first meta entry for each user_id key.
// Phoenix.Presence supports multiple metas per join (e.g. same user
// in two tabs); we surface the external_id once since it's identical
// across the user's metas.
function externalIdsFrom(state: PresenceSnapshot): string[] {
  const out: string[] = [];
  for (const presence of Object.values(state)) {
    const meta = presence?.metas?.[0];
    if (meta?.external_id) out.push(meta.external_id);
  }
  return out;
}

/**
 * Who's currently joined to `conversationId`'s channel. Backed by
 * Phoenix.Presence broadcasts (`presence_state` snapshot on join,
 * `presence_diff` on changes).
 */
export function usePresence(conversationId: string): UsePresenceState {
  const chat = usePoolse();
  const [online, setOnline] = useState<Set<string>>(new Set());

  useEffect(() => {
    setOnline(new Set());

    if (!conversationId) return;

    const conv = chat.realtime.conversation(conversationId);

    const applyState = (state: PresenceSnapshot) => {
      setOnline(new Set(externalIdsFrom(state)));
    };

    const applyDiff = (diff: { joins?: PresenceSnapshot; leaves?: PresenceSnapshot }) => {
      setOnline((prev) => {
        const next = new Set(prev);
        if (diff.joins) externalIdsFrom(diff.joins).forEach((ext) => next.add(ext));
        if (diff.leaves) externalIdsFrom(diff.leaves).forEach((ext) => next.delete(ext));
        return next;
      });
    };

    const offState = conv.onPresenceState(applyState);
    const offDiff = conv.onPresenceDiff(applyDiff as (s: PresenceSnapshot) => void);

    return () => {
      offState();
      offDiff();
    };
  }, [chat, conversationId]);

  return { online };
}
