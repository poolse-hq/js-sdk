import type { AddMemberOptions, MemberRole, Membership, Uuid } from '@poolse/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePoolse } from './provider.js';

interface UseMembersState {
  members: Membership[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  /**
   * Add one or more users by external_id. The returned memberships
   * are appended to local state on success.
   */
  addMembers: (externalIds: string[], opts?: { role?: MemberRole }) => Promise<Membership[]>;
  /**
   * Remove a member by user_id. Optimistically removes from state;
   * rolls back on server error.
   */
  removeMember: (userId: Uuid) => Promise<void>;
}

/**
 * Live-ish membership list for a conversation. Initial REST fetch on
 * mount; mutation helpers update local state in place. No realtime
 * sync yet — the backend doesn't broadcast `member:joined` /
 * `member:left` events. For now, callers who depend on
 * cross-client member updates should poll with `refetch()` or
 * remount the hook.
 */
export function useMembers(conversationId: Uuid): UseMembersState {
  const chat = usePoolse();
  const [members, setMembers] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Shadow ref tracking the latest committed members. Lets the
  // optimistic rollback path capture a snapshot synchronously
  // without racing the React updater queue against an `await`.
  const membersRef = useRef<Membership[]>([]);
  membersRef.current = members;

  const fetcher = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await chat.conversations.one(conversationId).listMembers(signal);
        setMembers(data);
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setLoading(false);
      }
    },
    [chat, conversationId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetcher(controller.signal);
    return () => controller.abort();
  }, [fetcher]);

  const refetch = useCallback(() => fetcher(), [fetcher]);

  const addMembers = useCallback(
    async (externalIds: string[], opts: { role?: MemberRole } = {}) => {
      const addOpts: AddMemberOptions = opts.role !== undefined ? { role: opts.role } : {};
      const { data } = await chat.conversations.one(conversationId).addMembers(externalIds, addOpts);
      // Dedup by id in case the server returns a row that was already
      // a member (idempotent re-add).
      setMembers((prev) => {
        const byId = new Map(prev.map((m) => [m.id, m]));
        for (const m of data) byId.set(m.id, m);
        return Array.from(byId.values());
      });
      return data;
    },
    [chat, conversationId],
  );

  const removeMember = useCallback(
    async (userId: Uuid) => {
      const snapshot = membersRef.current;
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
      try {
        await chat.conversations.one(conversationId).removeMember(userId);
      } catch (err) {
        setMembers(snapshot);
        throw err;
      }
    },
    [chat, conversationId],
  );

  return { members, loading, error, refetch, addMembers, removeMember };
}
