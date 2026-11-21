// The agent directory, an agent's scope in a conversation (AG3), "What we
// know" (AG10) and follow-ups (AG11).

import type {
  AgentProfile,
  AgentScope,
  AgentScopeUpdate,
  ConversationAgent,
  Followup,
  FollowupStatus,
  MemoryFact,
  MemoryKind,
} from '@poolse/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';

import { usePoolse } from './provider.js';

/** A list loaded once (and on `refresh`), with the usual state. */
function useLoaded<T>(load: (signal: AbortSignal) => Promise<T[]>, key: string) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    loadRef
      .current(controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return;
        setItems(rows);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err as DOMException)?.name === 'AbortError') return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [key, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { items, setItems, loading, error, refresh };
}

export interface UseAgents {
  agents: AgentProfile[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

/** The agents the user can see (`GET /v1/me/agents`) — profiles for a directory or a picker. */
export function useAgents(): UseAgents {
  const chat = usePoolse();
  const { items, loading, error, refresh } = useLoaded((signal) => chat.agents.list(signal), 'all');
  return { agents: items, loading, error, refresh };
}

export interface UseConversationAgents {
  /** The conversation's agents, each with its `scope` (ceiling, narrowing, effective). */
  agents: ConversationAgent[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  /** Narrow an agent here (owners and admins; `ApiError` `forbidden` otherwise). */
  setScope: (agentId: string, patch: AgentScopeUpdate) => Promise<AgentScope>;
  /** Back to the admin's ceiling. */
  resetScope: (agentId: string) => Promise<AgentScope>;
}

/** A conversation's agents and their scopes (`GET /v1/conversations/:id/agents`). */
export function useConversationAgents(conversationId: string | null): UseConversationAgents {
  const chat = usePoolse();
  const { items, setItems, loading, error, refresh } = useLoaded(
    (signal) =>
      conversationId ? chat.agents.inConversation(conversationId, signal) : Promise.resolve([]),
    conversationId ?? '',
  );
  const put = (scope: AgentScope) =>
    setItems((list) => list.map((a) => (a.id === scope.agentId ? { ...a, scope } : a)));
  const setScope = useCallback(
    async (agentId: string, patch: AgentScopeUpdate) => {
      if (!conversationId) throw new Error('no conversation');
      const scope = await chat.agents.setScope(conversationId, agentId, patch);
      put(scope);
      return scope;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chat, conversationId],
  );
  const resetScope = useCallback(
    async (agentId: string) => {
      if (!conversationId) throw new Error('no conversation');
      const scope = await chat.agents.resetScope(conversationId, agentId);
      put(scope);
      return scope;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chat, conversationId],
  );
  return { agents: items, loading, error, refresh, setScope, resetScope };
}

export interface UseMemory {
  facts: MemoryFact[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  add: (input: {
    kind: MemoryKind;
    text: string;
    conversationId: string;
    ownerUserId?: string | null;
    dueOn?: string | null;
  }) => Promise<MemoryFact>;
  update: (
    id: string,
    patch: { kind?: MemoryKind; text?: string; ownerUserId?: string | null; dueOn?: string | null },
  ) => Promise<MemoryFact>;
  remove: (id: string) => Promise<void>;
}

/** "What we know" (`GET /v1/me/memory`), optionally for one conversation, kind or search. */
export function useMemory(
  opts: { conversationId?: string; kind?: MemoryKind; q?: string; limit?: number } = {},
): UseMemory {
  const chat = usePoolse();
  const key = JSON.stringify([opts.conversationId, opts.kind, opts.q, opts.limit]);
  const { items, setItems, loading, error, refresh } = useLoaded(
    (signal) =>
      chat.agents.memory({
        ...(opts.conversationId ? { conversationId: opts.conversationId } : {}),
        ...(opts.kind ? { kind: opts.kind } : {}),
        ...(opts.q ? { q: opts.q } : {}),
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        signal,
      }),
    key,
  );
  const add = useCallback<UseMemory['add']>(
    async (input) => {
      const fact = await chat.agents.addMemory(input);
      setItems((list) => [fact, ...list]);
      return fact;
    },
    [chat, setItems],
  );
  const update = useCallback<UseMemory['update']>(
    async (id, patch) => {
      const fact = await chat.agents.updateMemory(id, patch);
      setItems((list) => list.map((f) => (f.id === id ? fact : f)));
      return fact;
    },
    [chat, setItems],
  );
  const remove = useCallback(
    async (id: string) => {
      await chat.agents.deleteMemory(id);
      setItems((list) => list.filter((f) => f.id !== id));
    },
    [chat, setItems],
  );
  return { facts: items, loading, error, refresh, add, update, remove };
}

export interface UseFollowups {
  followups: Followup[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  done: (id: string) => Promise<Followup>;
  cancel: (id: string) => Promise<Followup>;
}

/** Promises an agent is tracking for you (`GET /v1/me/followups`). */
export function useFollowups(opts: { status?: FollowupStatus } = {}): UseFollowups {
  const chat = usePoolse();
  const { items, setItems, loading, error, refresh } = useLoaded(
    (signal) => chat.agents.followups({ ...(opts.status ? { status: opts.status } : {}), signal }),
    opts.status ?? '',
  );
  const act = useCallback(
    async (id: string, action: 'done' | 'cancel') => {
      const f = await (action === 'done'
        ? chat.agents.followupDone(id)
        : chat.agents.followupCancel(id));
      setItems((list) =>
        opts.status && f.status !== opts.status
          ? list.filter((x) => x.id !== id)
          : list.map((x) => (x.id === id ? f : x)),
      );
      return f;
    },
    [chat, setItems, opts.status],
  );
  return {
    followups: items,
    loading,
    error,
    refresh,
    done: (id) => act(id, 'done'),
    cancel: (id) => act(id, 'cancel'),
  };
}
