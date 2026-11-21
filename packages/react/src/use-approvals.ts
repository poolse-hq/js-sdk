// Agent approvals (AG4): the pending list, and one approval's live state
// for the card under the agent's message that asked.

import type { AgentApproval } from '@poolse/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';

import { onReconnect } from './capture-state.js';
import { usePoolse } from './provider.js';

export interface UseApprovals {
  /** Pending approvals for you, newest first. */
  approvals: AgentApproval[];
  /** True until the first list arrives. */
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  approve: (id: string, reason?: string) => Promise<AgentApproval>;
  deny: (id: string, reason?: string) => Promise<AgentApproval>;
}

/**
 * Everything waiting for your answer (`GET /v1/me/approvals?status=pending`),
 * kept live: `agent:approval` on your user channel, your own answers, a
 * re-list after every reconnect, and (as a fallback) every `pollMs`
 * (default 60 s; 0 turns it off).
 */
export function useApprovals(opts: { pollMs?: number } = {}): UseApprovals {
  const chat = usePoolse();
  const pollMs = opts.pollMs ?? 60_000;
  const [approvals, setApprovals] = useState<AgentApproval[]>(() => chat.approvals.pending());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      await chat.approvals.list();
      if (mounted.current) setError(null);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [chat]);

  useEffect(() => {
    mounted.current = true;
    const off = chat.approvals.subscribe(() => setApprovals(chat.approvals.pending()));
    setApprovals(chat.approvals.pending());
    void refresh();
    // Names come from the directory.
    void chat.agents.list().catch(() => undefined);
    const offStatus = onReconnect(chat, () => void refresh());
    const timer = pollMs > 0 ? setInterval(() => void refresh(), pollMs) : null;
    return () => {
      mounted.current = false;
      off();
      offStatus();
      if (timer) clearInterval(timer);
    };
  }, [chat, refresh, pollMs]);

  const approve = useCallback(
    (id: string, reason?: string) =>
      chat.approvals.approve(id, reason !== undefined ? { reason } : {}),
    [chat],
  );
  const deny = useCallback(
    (id: string, reason?: string) =>
      chat.approvals.deny(id, reason !== undefined ? { reason } : {}),
    [chat],
  );

  return { approvals, loading, error, refresh, approve, deny };
}

export interface UseApproval {
  /** The newest state seen; null while loading, or when it isn't yours to see. */
  approval: AgentApproval | null;
  /** Looking it up (`id` given and not known yet). */
  loading: boolean;
  /** An answer is on its way. */
  pending: 'approve' | 'deny' | null;
  /** The last answer failed. */
  error: Error | null;
  approve: (reason?: string) => Promise<void>;
  deny: (reason?: string) => Promise<void>;
}

/**
 * One approval, for a card: an id (`approvalIdOf(message)` — loaded from
 * `GET /v1/me/approvals?status=all` when not known) or an approval from
 * `useApprovals()`. Follows the shared store, so an answer given here, in
 * the pending list or on another device shows at once.
 */
export function useApproval(source: AgentApproval | string | null): UseApproval {
  const chat = usePoolse();
  const id = typeof source === 'string' ? source : (source?.id ?? null);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const read = () =>
    id
      ? (chat.approvals.peek(id) ??
        (typeof sourceRef.current === 'object' ? sourceRef.current : null))
      : null;
  const [approval, setApproval] = useState<AgentApproval | null>(read);
  const [loading, setLoading] = useState(() => !!id && !read());
  const [pending, setPending] = useState<'approve' | 'deny' | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!id) {
      setApproval(null);
      setLoading(false);
      return;
    }
    const given = sourceRef.current;
    if (given && typeof given === 'object') chat.approvals._apply(given);
    const update = () => setApproval(read());
    const off = chat.approvals.subscribe(update);
    update();
    let live = true;
    if (!chat.approvals.peek(id)) {
      setLoading(true);
      void chat.approvals
        .ensure(id)
        .catch(() => null)
        .finally(() => {
          if (live) {
            setLoading(false);
            update();
          }
        });
    }
    return () => {
      live = false;
      off();
    };
    // `read` closes over `id` and the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat, id]);

  const decide = useCallback(
    async (action: 'approve' | 'deny', reason?: string) => {
      if (!id) return;
      setPending(action);
      setError(null);
      try {
        const opts = reason !== undefined ? { reason } : {};
        await (action === 'approve'
          ? chat.approvals.approve(id, opts)
          : chat.approvals.deny(id, opts));
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        setPending(null);
      }
    },
    [chat, id],
  );

  return {
    approval,
    loading,
    pending,
    error,
    approve: (reason) => decide('approve', reason),
    deny: (reason) => decide('deny', reason),
  };
}
