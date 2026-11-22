// Agents in calls (the server's docs/AGENTS_IN_CALLS.md): who of the
// agents is in a call and inviting one (AG13), your private whisper
// (AG15) and your agent's questions while it attends for you (AG16).

import type {
  AgentBrief,
  AgentBriefInput,
  AgentEscalation,
  AgentProfile,
  AgentSaid,
  CallAgent,
  CallAgentMode,
  EscalationReply,
  WhisperHint,
  WhisperState,
} from '@poolse/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { onReconnect } from './capture-state.js';
import { usePoolse } from './provider.js';
import { useMe } from './use-me.js';

const asError = (err: unknown) => (err instanceof Error ? err : new Error(String(err)));

// ── AG13: agents in the call ─────────────────────────────────────────────

export interface UseCallAgents {
  /** The agents in the call now. */
  agents: CallAgent[];
  /** Agents you could invite: active, voice on, not in the call yet. */
  available: AgentProfile[];
  loading: boolean;
  error: Error | null;
  /** The agent id an invite / remove is on its way for. */
  pending: string | null;
  /** Bring one in (or change the mode of one already in). */
  invite: (agentId: string, mode?: Exclude<CallAgentMode, 'delegate'>) => Promise<void>;
  setMode: (agentId: string, mode: Exclude<CallAgentMode, 'delegate'>) => Promise<void>;
  remove: (agentId: string) => Promise<void>;
  /** The last thing an agent said aloud (`agent:said`), for a caption; null until one speaks. */
  said: AgentSaid | null;
  /** The agent with this LiveKit identity (its user id), for a tile or roster row. */
  agentFor: (identity: string) => CallAgent | null;
  refresh: () => void;
}

/**
 * The agents in a live call (`GET /v1/calls/:id/agents`, then
 * `call:agents`), with invite / remove and the directory's agents you
 * could still invite. Re-reads after a reconnect.
 */
export function useCallAgents(conversationId: string | null, callId: string | null): UseCallAgents {
  const chat = usePoolse();
  const [agents, setAgents] = useState<CallAgent[]>([]);
  const [directory, setDirectory] = useState<AgentProfile[]>([]);
  const [loading, setLoading] = useState(!!callId);
  const [error, setError] = useState<Error | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [said, setSaid] = useState<AgentSaid | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    setSaid(null);
    if (!callId || !conversationId) {
      setAgents([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const load = () =>
      chat.callAgents
        .list(callId, controller.signal)
        .then((list) => {
          if (controller.signal.aborted) return;
          setAgents(list);
          setError(null);
        })
        .catch((err: unknown) => {
          if (!controller.signal.aborted) setError(asError(err));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    setLoading(true);
    void load();
    const off = chat.callAgents.subscribe(conversationId, callId, {
      onAgents: setAgents,
      onSaid: setSaid,
    });
    const offRe = onReconnect(chat, () => void load());
    return () => {
      controller.abort();
      off();
      offRe();
    };
  }, [chat, conversationId, callId, nonce]);

  useEffect(() => {
    let live = true;
    chat.agents
      .list()
      .then((list) => live && setDirectory(list))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [chat]);

  const available = useMemo(() => {
    const inCall = new Set(agents.map((a) => a.agentId));
    return directory.filter(
      (a) => a.status === 'active' && !a.stopped && a.voiceEnabled && !inCall.has(a.id),
    );
  }, [agents, directory]);

  const run = useCallback(async (agentId: string, fn: () => Promise<void>) => {
    setPending(agentId);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(asError(err));
      throw err;
    } finally {
      setPending(null);
    }
  }, []);

  const upsert = (a: CallAgent) =>
    setAgents((prev) => {
      const i = prev.findIndex((x) => x.agentId === a.agentId);
      return i < 0 ? [...prev, a] : prev.map((x, j) => (j === i ? a : x));
    });

  const invite = useCallback(
    (agentId: string, mode: Exclude<CallAgentMode, 'delegate'> = 'notetaker') =>
      run(agentId, async () => {
        if (callId) upsert(await chat.callAgents.invite(callId, agentId, mode));
      }),
    [chat, callId, run],
  );

  const setMode = useCallback(
    (agentId: string, mode: Exclude<CallAgentMode, 'delegate'>) =>
      run(agentId, async () => {
        if (callId) upsert(await chat.callAgents.setMode(callId, agentId, mode));
      }),
    [chat, callId, run],
  );

  const remove = useCallback(
    (agentId: string) =>
      run(agentId, async () => {
        if (!callId) return;
        await chat.callAgents.remove(callId, agentId);
        setAgents((prev) => prev.filter((x) => x.agentId !== agentId));
      }),
    [chat, callId, run],
  );

  const agentFor = useCallback(
    (identity: string) => agents.find((a) => a.userId === identity) ?? null,
    [agents],
  );

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return {
    agents,
    available,
    loading,
    error,
    pending,
    invite,
    setMode,
    remove,
    said,
    agentFor,
    refresh,
  };
}

// ── AG15: whisper ────────────────────────────────────────────────────────

export interface UseWhisper {
  /** Whether you get hints in this call. */
  on: boolean;
  /** The whisper as the server has it (the agent, when it started). */
  whisper: WhisperState | null;
  /** The agent whispering, when on. */
  agentName: string | null;
  /** This call's hints, oldest first (the history and the live ones). */
  hints: WhisperHint[];
  /** The newest hint that arrived live since mount (for a toast); null otherwise. */
  latest: WhisperHint | null;
  loading: boolean;
  /** Turning on / off is on its way. */
  pending: boolean;
  /** Use `whisperErrorMessage(error)` for the sentence. */
  error: Error | null;
  setOn: (on: boolean, opts?: { agentId?: string }) => Promise<void>;
  toggle: () => Promise<void>;
}

/**
 * Your private hints in one call (AG15): on/off and the history from
 * `GET /v1/calls/:id/whisper`, then `whisper:hint` / `whisper:changed` on
 * your user topic. Nobody else in the call sees them — label the panel
 * "Only you see this".
 */
export function useWhisper(callId: string | null): UseWhisper {
  const chat = usePoolse();
  const { me } = useMe();
  const userId = me?.id ?? null;
  const [whisper, setWhisper] = useState<WhisperState | null>(null);
  const [hints, setHints] = useState<WhisperHint[]>([]);
  const [latest, setLatest] = useState<WhisperHint | null>(null);
  const [loading, setLoading] = useState(!!callId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const onRef = useRef(false);
  onRef.current = whisper?.on ?? false;

  const merge = useCallback((list: readonly WhisperHint[]) => {
    setHints((prev) => {
      const byId = new Map(prev.map((h) => [h.id, h]));
      for (const h of list) byId.set(h.id, h);
      return [...byId.values()].sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
    });
  }, []);

  useEffect(() => {
    setHints([]);
    setLatest(null);
    setWhisper(null);
    if (!callId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const load = () =>
      chat.callAgents.whisper
        .get(callId, controller.signal)
        .then((res) => {
          if (controller.signal.aborted) return;
          setWhisper(res.whisper);
          merge(res.hints);
          setError(null);
        })
        .catch((err: unknown) => {
          if (!controller.signal.aborted) setError(asError(err));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    setLoading(true);
    void load();
    const off = userId
      ? chat.callAgents.whisper.subscribe(userId, callId, {
          onHint: (h) => {
            merge([h]);
            setLatest(h);
          },
          onChanged: setWhisper,
        })
      : () => undefined;
    const offRe = onReconnect(chat, () => void load());
    return () => {
      controller.abort();
      off();
      offRe();
    };
  }, [chat, callId, userId, merge]);

  const setOn = useCallback(
    async (next: boolean, opts: { agentId?: string } = {}) => {
      if (!callId) return;
      setPending(true);
      setError(null);
      try {
        setWhisper(await chat.callAgents.whisper.set(callId, next, opts));
      } catch (err) {
        setError(asError(err));
        throw err;
      } finally {
        setPending(false);
      }
    },
    [chat, callId],
  );

  const toggle = useCallback(() => setOn(!onRef.current), [setOn]);

  return {
    on: whisper?.on ?? false,
    whisper,
    agentName: whisper?.on ? (whisper.agent?.name ?? null) : null,
    hints,
    latest,
    loading,
    pending,
    error,
    setOn,
    toggle,
  };
}

// ── AG16: escalations ────────────────────────────────────────────────────

export interface UseEscalations {
  /** Waiting for your answer, newest first (only this call's with `callId`). */
  escalations: AgentEscalation[];
  /** Answered ones seen this session too, newest first. */
  all: AgentEscalation[];
  loading: boolean;
  error: Error | null;
  /** The escalation id a reply is on its way for. */
  pending: string | null;
  /** `{ decision: 'approve' | 'decline' }` or `{ answer }`. */
  reply: (id: string, reply: EscalationReply) => Promise<AgentEscalation>;
  /** The agent's name for an escalation (from the directory), else "Your agent". */
  agentNameOf: (escalation: AgentEscalation) => string;
  refresh: () => Promise<void>;
}

/**
 * Your agent's questions while it attends a meeting for you (AG16),
 * kept live by `agent:escalation`, a re-list on reconnect and (fallback)
 * every `pollMs` (default 30 s; 0 off). Answers from a notification
 * reach the store through the server's event.
 */
export function useEscalations(
  opts: { callId?: string | null; pollMs?: number } = {},
): UseEscalations {
  const chat = usePoolse();
  const pollMs = opts.pollMs ?? 30_000;
  const callId = opts.callId ?? null;
  const read = useCallback(
    () => ({
      pending: chat.escalations.pending().filter((e) => !callId || e.callId === callId),
      all: chat.escalations.all().filter((e) => !callId || e.callId === callId),
    }),
    [chat, callId],
  );
  const [state, setState] = useState(read);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      await chat.escalations.list();
      if (mounted.current) setError(null);
    } catch (err) {
      if (mounted.current) setError(asError(err));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [chat]);

  useEffect(() => {
    mounted.current = true;
    const off = chat.escalations.subscribe(() => setState(read()));
    setState(read());
    void refresh();
    const offRe = onReconnect(chat, () => void refresh());
    const timer = pollMs > 0 ? setInterval(() => void refresh(), pollMs) : null;
    return () => {
      mounted.current = false;
      off();
      offRe();
      if (timer) clearInterval(timer);
    };
  }, [chat, read, refresh, pollMs]);

  const reply = useCallback(
    async (id: string, r: EscalationReply) => {
      setPending(id);
      setError(null);
      try {
        return await chat.escalations.reply(id, r);
      } catch (err) {
        if (mounted.current) setError(asError(err));
        throw err;
      } finally {
        if (mounted.current) setPending(null);
      }
    },
    [chat],
  );

  const [, setNames] = useState(0);
  useEffect(() => {
    // Names come from the directory.
    let live = true;
    void chat.agents
      .list()
      .then(() => live && setNames((n) => n + 1))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [chat]);
  const agentNameOf = useCallback(
    (e: AgentEscalation) => (e.agentId ? chat.agents.peek(e.agentId)?.name : null) ?? 'Your agent',
    [chat],
  );

  return {
    escalations: state.pending,
    all: state.all,
    loading,
    error,
    pending,
    reply,
    agentNameOf,
    refresh,
  };
}

// ── AG16: the brief (optional; the Workspace owns the editor) ───────────

export interface UseAgentBrief {
  /** Your brief for this meeting / call, or null when you've written none. */
  brief: AgentBrief | null;
  loading: boolean;
  saving: boolean;
  error: Error | null;
  /** Create or replace (one per person per meeting/call). */
  save: (input: Omit<AgentBriefInput, 'scheduledMeetingId' | 'callId'>) => Promise<AgentBrief>;
  /** Delete it (the agent leaves if it's attending). */
  remove: () => Promise<void>;
  refresh: () => void;
}

/** Your brief for an agent attending a scheduled meeting or a live call for you. */
export function useAgentBrief(target: {
  scheduledMeetingId?: string | null;
  callId?: string | null;
}): UseAgentBrief {
  const chat = usePoolse();
  const meetingId = target.scheduledMeetingId ?? null;
  const callId = target.callId ?? null;
  const [brief, setBrief] = useState<AgentBrief | null>(null);
  const [loading, setLoading] = useState(!!(meetingId || callId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    setBrief(null);
    if (!meetingId && !callId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    chat.callAgents.briefs
      .list({
        ...(meetingId ? { scheduledMeetingId: meetingId } : {}),
        ...(callId ? { callId } : {}),
        signal: controller.signal,
      })
      .then((list) => {
        if (!controller.signal.aborted) setBrief(list[0] ?? null);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(asError(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [chat, meetingId, callId, nonce]);

  const save = useCallback(
    async (input: Omit<AgentBriefInput, 'scheduledMeetingId' | 'callId'>) => {
      setSaving(true);
      setError(null);
      try {
        const b = await chat.callAgents.briefs.create({
          ...input,
          ...(meetingId ? { scheduledMeetingId: meetingId } : {}),
          ...(callId && !meetingId ? { callId } : {}),
        });
        setBrief(b);
        return b;
      } catch (err) {
        setError(asError(err));
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [chat, meetingId, callId],
  );

  const remove = useCallback(async () => {
    if (!brief) return;
    setSaving(true);
    setError(null);
    try {
      await chat.callAgents.briefs.remove(brief.id);
      setBrief(null);
    } catch (err) {
      setError(asError(err));
      throw err;
    } finally {
      setSaving(false);
    }
  }, [chat, brief]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { brief, loading, saving, error, save, remove, refresh };
}
