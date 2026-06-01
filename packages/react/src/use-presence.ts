import type { PresenceSnapshot, Uuid } from '@poolse/sdk';
import { useEffect, useState } from 'react';
import { usePoolse } from './provider.js';

interface UsePresenceState {
  /** Set of user_ids currently online in this conversation. */
  online: Set<Uuid>;
}

/**
 * Who's currently joined to `conversationId`'s channel. Backed by
 * Phoenix.Presence broadcasts (`presence_state` snapshot on join,
 * `presence_diff` on changes).
 */
export function usePresence(conversationId: string): UsePresenceState {
  const chat = usePoolse();
  const [online, setOnline] = useState<Set<Uuid>>(new Set());

  useEffect(() => {
    setOnline(new Set());

    // Empty id = "do nothing" — same convention as `useMembers` /
    // `useMessages`. Lets callers conditionally enable presence
    // tracking without re-mounting the hook.
    if (!conversationId) return;

    const conv = chat.realtime.conversation(conversationId);

    const applyState = (state: PresenceSnapshot) => {
      setOnline(new Set(Object.keys(state)));
    };

    const applyDiff = (diff: { joins?: PresenceSnapshot; leaves?: PresenceSnapshot }) => {
      setOnline((prev) => {
        const next = new Set(prev);
        if (diff.joins) Object.keys(diff.joins).forEach((id) => next.add(id));
        if (diff.leaves) Object.keys(diff.leaves).forEach((id) => next.delete(id));
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
