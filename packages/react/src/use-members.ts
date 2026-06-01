import type { AddMemberOptions, MemberReadEvent, MemberRole, Membership, Uuid } from '@poolse/sdk';
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
 * mount; mutation helpers update local state in place.
 *
 * Realtime: subscribes to `member:read` on the conversation channel
 * and advances the matching membership's `last_read_message_id` /
 * `last_read_at` so the sender's read-receipt glyph flips from "sent"
 * to "read" without a refetch. `member:joined` / `member:left` aren't
 * broadcast yet — for cross-client adds/removes, call `refetch()`.
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

  // Buffer for `member:read` events that arrive BEFORE the initial
  // fetch lands. The realtime subscription runs almost immediately on
  // mount; the HTTP fetch takes a roundtrip. If another user reads in
  // that window, the broadcast fires while local state is still empty
  // and the `prev.map` no-ops — leaving the read invisible forever.
  // We buffer here and replay inside the fetcher after `setMembers`
  // commits the snapshot.
  const pendingReadsRef = useRef<MemberReadEvent[]>([]);
  const hasFetchedRef = useRef(false);

  const applyRead = (list: Membership[], evt: MemberReadEvent): Membership[] =>
    list.map((m) =>
      m.user_id === evt.user_id
        ? {
            ...m,
            last_read_message_id: evt.last_read_message_id,
            last_read_at: evt.last_read_at,
          }
        : m,
    );

  const fetcher = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      // Empty id = "skip fetch" — used by callers that conditionally
      // want member data (e.g. ConversationView's `mentions={false}
      // readReceipts={false}` configuration). Better than asking
      // every caller to wrap in `enabled ? useMembers(id) : null`.
      if (!conversationId) {
        setLoading(false);
        setMembers([]);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const { data } = await chat.conversations.one(conversationId).listMembers(signal);
        // Drain any buffered `member:read` events that fired before the
        // fetch landed. Without this, reads that arrive in the
        // subscribe→response gap would be lost.
        let next = data;
        if (pendingReadsRef.current.length > 0) {
          for (const evt of pendingReadsRef.current) next = applyRead(next, evt);
          pendingReadsRef.current = [];
        }
        setMembers(next);
        hasFetchedRef.current = true;
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return;
        // Surface to console with a recognisable prefix so callers can
        // grep for it in production logs / DevTools. Without this the
        // hook silently sets `error` state and the UI just shows a
        // generic placeholder.
        console.error('[poolse] useMembers fetch failed:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setLoading(false);
      }
    },
    [chat, conversationId],
  );

  useEffect(() => {
    // Reset per-conversation state so a swap of `conversationId`
    // doesn't carry stale buffered reads from a previous channel.
    hasFetchedRef.current = false;
    pendingReadsRef.current = [];
    const controller = new AbortController();
    void fetcher(controller.signal);
    return () => controller.abort();
  }, [fetcher]);

  // Real-time read-cursor sync. When ANY member reads, advance their
  // membership row locally — the sender's UI uses
  // max(memberships.last_read_message_id.sequence) to decide whether
  // to show the "read" glyph, so this single state edit drives the
  // whole receipt UI.
  useEffect(() => {
    if (!conversationId) return;
    const channel = chat.realtime.conversation(conversationId);
    const off = channel.onMemberRead((evt) => {
      // Diagnostic log so the read-receipt path is observable from
      // DevTools without source-mapped breakpoints. Removing once
      // the realtime pipeline is verified stable in customer use.
      console.log('[poolse] member:read received', evt);
      // Buffer if the initial fetch hasn't landed — the fetcher's
      // try-block drains the buffer once it has membership rows to
      // apply the read to. See the matching ref pair above.
      if (!hasFetchedRef.current) {
        pendingReadsRef.current.push(evt);
        return;
      }
      setMembers((prev) => applyRead(prev, evt));
    });
    return () => off();
  }, [chat, conversationId]);

  const refetch = useCallback(() => fetcher(), [fetcher]);

  const addMembers = useCallback(
    async (externalIds: string[], opts: { role?: MemberRole } = {}) => {
      const addOpts: AddMemberOptions = opts.role !== undefined ? { role: opts.role } : {};
      const { data } = await chat.conversations
        .one(conversationId)
        .addMembers(externalIds, addOpts);
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
