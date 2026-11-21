// Agent approvals (AG4): the pending list, and one approval's live state
// for the card that shows it.

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
 * Everything waiting for your answer (`GET /v1/approvals?status=pending`),
 * kept live: approval events on your user channel, your own answers, the
 * approval cards rendered in chat, a re-list after every reconnect, and
 * (as a fallback) every `pollMs` (default 60 s; 0 turns it off).
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
  /** The newest state seen — the message's, or a later answer. */
  approval: AgentApproval | null;
  /** An answer is on its way. */
  pending: 'approve' | 'deny' | null;
  /** The last answer failed. */
  error: Error | null;
  approve: (reason?: string) => Promise<void>;
  deny: (reason?: string) => Promise<void>;
}

/**
 * One approval, for a card: starts from `initial` (parsed from its
 * message with `parseApproval`) and follows the shared store, so an
 * answer given here, in a pending list or on another device shows at once.
 */
export function useApproval(initial: AgentApproval | null): UseApproval {
  const chat = usePoolse();
  const id = initial?.id ?? null;
  const [approval, setApproval] = useState<AgentApproval | null>(
    () => (id ? chat.approvals.peek(id) : undefined) ?? initial,
  );
  const [pending, setPending] = useState<'approve' | 'deny' | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Callers often parse the message on every render: key on what matters.
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const key = initial ? `${initial.id}|${initial.status}|${initial.summary}|${initial.reason}` : '';

  // The message's copy goes into the store (it never undoes a newer answer).
  useEffect(() => {
    if (!id) {
      setApproval(null);
      return;
    }
    if (initialRef.current) chat.approvals._apply(initialRef.current);
    const read = () => setApproval(chat.approvals.peek(id) ?? initialRef.current);
    read();
    return chat.approvals.subscribe(read);
  }, [chat, id, key]);

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
    pending,
    error,
    approve: (reason) => decide('approve', reason),
    deny: (reason) => decide('deny', reason),
  };
}
