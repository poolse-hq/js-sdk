// Agents in chat (the server's docs/AGENTS.md, docs/MESSAGING.md §10):
//
//   * who is an agent — `is_agent` on users and members, `sender_is_agent`
//     on messages and mentions; `GET /v1/me/agents` is the directory. The
//     SDK remembers agents per external id so every avatar and name of
//     theirs carries the Agent badge (AG1);
//   * `agent_meta` on an agent's message: why it posted (`kind`), the
//     sources it cites (AG5), the approval it waits for (AG4);
//   * approvals — `GET/POST /v1/me/approvals`, `agent:approval` on the user
//     channel (AG4);
//   * scopes per conversation (AG3), "What we know" (AG10), follow-ups (AG11).
//
// Every wire shape is read in the "wire mapping" section below and
// nowhere else, so a renamed field is a change to one function here.

import type { PoolseRealtime, UserChannel } from './realtime/realtime.js';
import type { Unsubscribe } from './realtime/types.js';
import type { MeResource } from './resources/me.js';
import type { RestClient } from './rest-client.js';
import type { Me, Message, Uuid } from './types.js';
import { PendingItems } from './pending-store.js';

/** What the UI needs to know about an agent. */
export interface AgentInfo {
  /** The agent's own id (not its user id); null when only the flag is known. */
  id: string | null;
  /** The agent's name, e.g. "Scout"; null until the directory says. */
  name: string | null;
  /** The template it came from (`note_taker`, `support_triage`…), when known. */
  kind: string | null;
}

/** An agent in the directory (`GET /v1/me/agents`). */
export interface AgentProfile {
  id: string;
  userId: Uuid | null;
  externalId: string | null;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  template: string | null;
  status: 'active' | 'paused';
  stopped: boolean;
  /** The person's own assistant (AG5). */
  assistant: boolean;
  mayPostUnasked: boolean;
  voiceEnabled: boolean;
}

/** Why an agent posted (`agent_meta.kind`). */
export type AgentMessageKind =
  | 'asked'
  | 'watch'
  | 'schedule'
  | 'reminder'
  | 'followup_missed'
  | 'standup'
  | 'standup_update'
  | (string & {});

/** `agent_meta` of an agent's message, read. */
export interface AgentMeta {
  kind: AgentMessageKind | null;
  citations: Citation[];
  /** The approval this message waits for (AG4). */
  approvalId: string | null;
  followupId: string | null;
  standupId: string | null;
}

/** What a citation points at. */
export type CitationType = 'message' | 'file' | 'transcript' | 'summary' | 'memory';

/** One numbered source under an assistant's answer (`agent_meta.citations`). */
export interface Citation {
  /** The `[n]` in the answer's text. */
  n: number;
  type: CitationType;
  id: string;
  conversationId: Uuid | null;
  /** The conversation's name, or null. */
  title: string | null;
  /** ≤ 200 chars around the match. */
  snippet: string;
  at: string | null;
  /** message / file: the message; thread replies also `threadRootId`. */
  messageId: string | null;
  threadRootId: string | null;
  /** file */
  attachmentId: string | null;
  fileName: string | null;
  contentType: string | null;
  /** transcript / summary */
  callId: string | null;
  transcriptId: string | null;
  summaryId: string | null;
  /** transcript: ms since the transcript started. */
  startMs: number | null;
  speaker: string | null;
  /** memory */
  factId: string | null;
}

/** Where an approval stands. Only `pending` can be answered. */
export type ApprovalStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'declined'
  | 'expired'
  | 'replaced'
  | 'cancelled';

/** One line of what an approval would do ("To", "Subject", …). */
export interface ApprovalDetail {
  /** Empty for free text. */
  label: string;
  value: string;
}

/** An agent asking before it calls a tool with an outside effect (AG4). */
export interface AgentApproval {
  id: string;
  agentId: string | null;
  /** From the directory when known; else null (show the message's sender). */
  agent: AgentInfo | null;
  conversationId: Uuid | null;
  requesterUserId: Uuid | null;
  /** Set when it was asked during a call. */
  callId: string | null;
  /** The tool, e.g. `github.create_issue`. */
  tool: string;
  /** One line from the tool's name: "Create issue (github)". */
  summary: string;
  /** The call's arguments as label/value lines. */
  details: ApprovalDetail[];
  status: ApprovalStatus;
  reason: string | null;
  decidedByUserId: Uuid | null;
  decidedAt: string | null;
  expiresAt: string | null;
  createdAt: string | null;
}

/** Longest reason sent with an answer. */
export const APPROVAL_REASON_MAX = 500;

/** A conversation's agent with its scope (`GET /v1/conversations/:id/agents`). */
export interface ConversationAgent extends AgentProfile {
  scope: AgentScope | null;
}

/** An agent's scope in one conversation: the admin's ceiling ∩ the conversation's narrowing (AG3). */
export interface AgentScope {
  agentId: string;
  conversationId: Uuid;
  ceiling: { tools: string[] | null; readHistory: boolean; mayPostUnasked: boolean };
  /** Null: the conversation hasn't narrowed it. */
  conversation: {
    mode: 'mention' | 'watch';
    tools: string[] | null;
    readHistory: boolean | null;
    updatedByUserId: Uuid | null;
    updatedAt: string | null;
  } | null;
  effective: {
    mode: 'mention' | 'watch';
    watch: boolean;
    tools: string[] | null;
    readHistory: boolean;
  };
}

/** `PUT …/agents/:agent_id/scope` — send what changes. */
export interface AgentScopeUpdate {
  mode?: 'mention' | 'watch';
  /** Null: the ceiling's. */
  tools?: string[] | null;
  readHistory?: boolean;
}

export type MemoryKind = 'decision' | 'owner' | 'deadline' | 'fact';

/** A "What we know" fact (AG10). */
export interface MemoryFact {
  id: string;
  kind: MemoryKind;
  text: string;
  ownerUserId: Uuid | null;
  dueOn: string | null;
  /** Null: workspace-wide (edited by admins only). */
  conversationId: Uuid | null;
  source: { type: string; id: string | null; snippet: string | null } | null;
  agentId: string | null;
  createdByUserId: Uuid | null;
  updatedByUserId: Uuid | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export type FollowupStatus = 'open' | 'reminded' | 'done' | 'missed' | 'cancelled';

/** A promise an agent is tracking (AG11). */
export interface Followup {
  id: string;
  agentId: string | null;
  conversationId: Uuid | null;
  ownerUserId: Uuid | null;
  requesterUserId: Uuid | null;
  text: string;
  dueOn: string | null;
  status: FollowupStatus;
  source: unknown;
  remindedAt: string | null;
  resolvedAt: string | null;
}

// ── wire mapping (adjust here when the server contract changes) ─────────

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
const bool = (v: unknown): boolean => v === true;
const unwrap = (res: unknown): unknown => obj(res)?.data ?? res;
const rowsOf = (res: unknown): unknown[] => {
  const rows = unwrap(res);
  return Array.isArray(rows) ? rows : [];
};

/**
 * A user, member or message row → AgentInfo when it is an agent's, else
 * null: `is_agent` (users, members) or `sender_is_agent` (messages,
 * `mention:new`).
 */
export function agentFromWire(raw: unknown): AgentInfo | null {
  const o = obj(raw);
  if (!o) return null;
  if (o.is_agent !== true && o.sender_is_agent !== true) return null;
  return { id: null, name: null, kind: null };
}

/** The agent that sent a message, or null for a person. */
export function messageAgent(message: unknown): AgentInfo | null {
  const o = obj(message);
  return o?.sender_is_agent === true ? { id: null, name: null, kind: null } : null;
}

/** A directory row (`GET /v1/me/agents`) → AgentProfile. */
export function agentProfileFromWire(raw: unknown): AgentProfile | null {
  const o = obj(raw);
  const id = str(o?.id);
  if (!o || !id) return null;
  return {
    id,
    userId: str(o.user_id),
    externalId: str(o.external_id),
    name: clip(str(o.name), 80) ?? 'Agent',
    description: clip(str(o.description), 500),
    avatarUrl: str(o.avatar_url),
    template: str(o.template),
    status: o.status === 'paused' ? 'paused' : 'active',
    stopped: bool(o.stopped),
    assistant: bool(o.assistant),
    mayPostUnasked: bool(o.may_post_unasked),
    voiceEnabled: bool(o.voice_enabled),
  };
}

const CITATION_TYPES: readonly CitationType[] = [
  'message',
  'file',
  'transcript',
  'summary',
  'memory',
];

function citationFromWire(raw: unknown, index: number): Citation | null {
  const o = obj(raw);
  if (!o || !CITATION_TYPES.includes(o.type as CitationType)) return null;
  const id = str(o.id);
  if (!id) return null;
  return {
    n: num(o.n) ?? index + 1,
    type: o.type as CitationType,
    id,
    conversationId: str(o.conversation_id),
    title: clip(str(o.title), 120),
    snippet: clip(str(o.snippet)?.replace(/\s+/g, ' ').trim() ?? null, 200) ?? '',
    at: str(o.at),
    messageId: str(o.message_id),
    threadRootId: str(o.thread_root_id),
    attachmentId: str(o.attachment_id),
    fileName: clip(str(o.file_name), 120),
    contentType: str(o.content_type),
    callId: str(o.call_id),
    transcriptId: str(o.transcript_id),
    summaryId: str(o.summary_id),
    startMs: num(o.start_ms),
    speaker: clip(str(o.speaker), 80),
    factId: str(o.fact_id),
  };
}

/** A message's `agent_meta`, read; null on a person's message. */
export function agentMetaOf(message: {
  agent_meta?: unknown;
  deleted_at?: string | null;
}): AgentMeta | null {
  const m = obj(message.agent_meta);
  if (!m || message.deleted_at) return null;
  return {
    kind: str(m.kind),
    citations: Array.isArray(m.citations)
      ? m.citations
          .slice(0, 30)
          .map(citationFromWire)
          .filter((c): c is Citation => !!c)
      : [],
    approvalId: str(m.approval_id),
    followupId: str(m.followup_id),
    standupId: str(m.standup_id),
  };
}

/** The numbered sources under an assistant's answer (`agent_meta.citations`). */
export function citationsOf(message: {
  agent_meta?: unknown;
  deleted_at?: string | null;
}): Citation[] {
  return agentMetaOf(message)?.citations ?? [];
}

/** The approval an agent's message waits for (`agent_meta.approval_id`), else null. */
export function approvalIdOf(message: {
  agent_meta?: unknown;
  deleted_at?: string | null;
}): string | null {
  return agentMetaOf(message)?.approvalId ?? null;
}

const STATUSES: readonly ApprovalStatus[] = [
  'pending',
  'running',
  'done',
  'failed',
  'declined',
  'expired',
  'replaced',
  'cancelled',
];

/** An Approval row (REST or `agent:approval`) → AgentApproval. */
export function approvalFromWire(raw: unknown): AgentApproval | null {
  const o = obj(raw);
  const id = str(o?.id);
  if (!o || !id) return null;
  const tool = str(o.tool) ?? '';
  return {
    id,
    agentId: str(o.agent_id),
    agent: null,
    conversationId: str(o.conversation_id),
    requesterUserId: str(o.requester_user_id),
    callId: str(o.call_id),
    tool,
    summary: toolLabel(tool),
    details: detailsFromWire(o.arguments),
    status: STATUSES.includes(o.status as ApprovalStatus)
      ? (o.status as ApprovalStatus)
      : 'pending',
    reason: clip(str(o.reason), APPROVAL_REASON_MAX),
    decidedByUserId: str(o.decided_by_user_id),
    decidedAt: str(o.decided_at),
    expiresAt: str(o.expires_at),
    createdAt: str(o.inserted_at),
  };
}

function scopeFromWire(raw: unknown): AgentScope | null {
  const o = obj(raw);
  const agentId = str(o?.agent_id);
  const conversationId = str(o?.conversation_id);
  if (!o || !agentId || !conversationId) return null;
  const c = obj(o.ceiling) ?? {};
  const n = obj(o.conversation);
  const e = obj(o.effective) ?? {};
  const tools = (v: unknown) =>
    Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : null;
  return {
    agentId,
    conversationId,
    ceiling: {
      tools: tools(c.tools),
      readHistory: bool(c.read_history),
      mayPostUnasked: bool(c.may_post_unasked),
    },
    conversation: n
      ? {
          mode: n.mode === 'watch' ? 'watch' : 'mention',
          tools: tools(n.tools),
          readHistory: typeof n.read_history === 'boolean' ? n.read_history : null,
          updatedByUserId: str(n.updated_by_user_id),
          updatedAt: str(n.updated_at),
        }
      : null,
    effective: {
      mode: e.mode === 'watch' ? 'watch' : 'mention',
      watch: bool(e.watch),
      tools: tools(e.tools),
      readHistory: bool(e.read_history),
    },
  };
}

function conversationAgentFromWire(raw: unknown): ConversationAgent | null {
  const p = agentProfileFromWire(raw);
  return p ? { ...p, scope: scopeFromWire(obj(raw)?.scope) } : null;
}

const MEMORY_KINDS: readonly MemoryKind[] = ['decision', 'owner', 'deadline', 'fact'];

/** A Fact row → MemoryFact. */
export function memoryFactFromWire(raw: unknown): MemoryFact | null {
  const o = obj(raw);
  const id = str(o?.id);
  if (!o || !id) return null;
  const s = obj(o.source);
  return {
    id,
    kind: MEMORY_KINDS.includes(o.kind as MemoryKind) ? (o.kind as MemoryKind) : 'fact',
    text: typeof o.text === 'string' ? o.text : '',
    ownerUserId: str(o.owner_user_id),
    dueOn: str(o.due_on),
    conversationId: str(o.conversation_id),
    source: s ? { type: str(s.type) ?? 'manual', id: str(s.id), snippet: str(s.snippet) } : null,
    agentId: str(o.agent_id),
    createdByUserId: str(o.created_by_user_id),
    updatedByUserId: str(o.updated_by_user_id),
    createdAt: str(o.inserted_at),
    updatedAt: str(o.updated_at),
  };
}

const FOLLOWUP_STATUSES: readonly FollowupStatus[] = [
  'open',
  'reminded',
  'done',
  'missed',
  'cancelled',
];

/** A Follow-up row → Followup. */
export function followupFromWire(raw: unknown): Followup | null {
  const o = obj(raw);
  const id = str(o?.id);
  if (!o || !id) return null;
  return {
    id,
    agentId: str(o.agent_id),
    conversationId: str(o.conversation_id),
    ownerUserId: str(o.owner_user_id),
    requesterUserId: str(o.requester_user_id),
    text: typeof o.text === 'string' ? o.text : '',
    dueOn: str(o.due_on),
    status: FOLLOWUP_STATUSES.includes(o.status as FollowupStatus)
      ? (o.status as FollowupStatus)
      : 'open',
    source: o.source ?? null,
    remindedAt: str(o.reminded_at),
    resolvedAt: str(o.resolved_at),
  };
}

function detailsFromWire(raw: unknown): ApprovalDetail[] {
  if (typeof raw === 'string') return raw.trim() ? [{ label: '', value: clip(raw, 2000)! }] : [];
  const o = obj(raw);
  if (!o) return [];
  return Object.entries(o)
    .map(([k, v]) => ({ label: humanize(k), value: valueText(v) }))
    .filter((d) => d.value !== '')
    .slice(0, 30)
    .map((d) => ({ label: clip(d.label, 60)!, value: clip(d.value, 2000)! }));
}

function valueText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) {
    return v.join(', ');
  }
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

/** `to_address` → "To address". */
function humanize(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/** `github.create_issue` → "Create issue (github)". */
export function toolLabel(tool: string): string {
  if (!tool) return 'An action needs your approval';
  const i = tool.lastIndexOf('.');
  const name = humanize(i >= 0 ? tool.slice(i + 1) : tool) || tool;
  const server = i > 0 ? tool.slice(0, i) : null;
  return clip(server ? `${name} (${server})` : name, 120)!;
}

function clip(s: string | null, max: number): string | null {
  if (s === null) return null;
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * The JSON object in a system/custom message body with this `kind`, else
 * null (the `call_summary` message).
 */
export function kindPayload(
  message: Pick<Message, 'type' | 'body'> & { deleted_at?: string | null },
  kind: string,
): Record<string, unknown> | null {
  if (message.deleted_at) return null;
  const body = message.body;
  if (typeof body !== 'string') return null;
  const trimmed = body.trim();
  if (!trimmed.startsWith('{') || !trimmed.includes(`"${kind}"`)) return null;
  try {
    const o = obj(JSON.parse(trimmed));
    return o?.kind === kind ? o : null;
  } catch {
    return null;
  }
}

// ── display ─────────────────────────────────────────────────────────────

/** "Waiting for approval", "Running…", "Done", "Failed", "Denied", "Expired"… */
export function approvalStatusLabel(status: ApprovalStatus): string {
  switch (status) {
    case 'running':
      return 'Running…';
    case 'done':
      return 'Done';
    case 'failed':
      return 'Failed';
    case 'declined':
      return 'Denied';
    case 'expired':
      return 'Expired';
    case 'replaced':
      return 'Replaced';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Waiting for approval';
  }
}

/** The link text for a citation: its snippet, else what it is. */
export function citationLabel(c: Citation): string {
  if (c.snippet) return c.snippet;
  if (c.type === 'file' && c.fileName) return c.fileName;
  if (c.title) return c.title;
  switch (c.type) {
    case 'transcript':
      return 'From a meeting';
    case 'summary':
      return 'A meeting summary';
    case 'memory':
      return 'What we know';
    case 'file':
      return 'A file';
    default:
      return 'A message';
  }
}

/** Plain-language text for a failed approve / deny. */
export function approvalErrorMessage(err: unknown): string {
  const e = err as { code?: unknown; status?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  if (code === 'not_pending' || e?.status === 409) return 'Someone already answered this request.';
  if (code === 'expired' || e?.status === 410) return 'This request expired. Ask the agent again.';
  if (code === 'not_found' || e?.status === 404) return 'This request isn’t waiting for you.';
  switch (code) {
    case 'validation_failed':
      return `The reason can be up to ${APPROVAL_REASON_MAX} characters.`;
    case 'rate_limited':
      return 'Too many tries. Wait a minute and try again.';
    default:
      return 'The answer couldn’t be sent. Try again.';
  }
}

// ── REST + live store: approvals ────────────────────────────────────────

export interface ApprovalListOptions {
  /** `pending` (default) or `all`. */
  status?: 'pending' | 'all';
  signal?: AbortSignal;
}

/**
 * `poolse.approvals` — an agent's requests to act, and your answers.
 *
 *   await poolse.approvals.list()                 // GET /v1/me/approvals?status=pending
 *   await poolse.approvals.approve(id)
 *   await poolse.approvals.deny(id, { reason: 'Not this week' })
 *
 * Also a small live store (`subscribe` / `peek`) fed by `list`, your
 * answers and `agent:approval` on the user channel, so a card in the chat
 * and a pending list show the same status. `ensure(id)` loads the
 * approval a message points at.
 */
export class ApprovalsResource {
  private readonly store = new PendingItems<AgentApproval>();
  private readonly byId = this.store.byId;
  private readonly listeners = new Set<() => void>();
  private unbind: (() => void) | null = null;
  private allInflight: Promise<void> | null = null;
  private allLoadedAt = 0;

  constructor(
    private readonly rest: RestClient,
    private readonly realtime: PoolseRealtime,
    private readonly me: MeResource,
    private readonly agentInfo: (agentId: string) => AgentInfo | null = () => null,
  ) {}

  /** `GET /v1/me/approvals?status=pending|all` — the ones waiting for you (or all of yours). */
  async list(opts: ApprovalListOptions = {}): Promise<AgentApproval[]> {
    const status = opts.status ?? 'pending';
    const since = this.store.begin();
    const res = await this.rest.request<unknown>({
      method: 'GET',
      path: '/v1/me/approvals',
      query: { status },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const rows = rowsOf(res)
      .map(approvalFromWire)
      .filter((a): a is AgentApproval => !!a)
      .map((a) => this.withAgent(a));
    // A pending one the server no longer lists was answered elsewhere;
    // one that arrived while the request ran stays.
    this.store.merge(rows, since, status === 'pending');
    this.notify();
    return rows;
  }

  /**
   * Load one approval (through `status=all`) unless it is known. Resolves
   * with it, or null when it isn't yours (only the person asked sees an
   * approval). Concurrent calls share one request.
   */
  async ensure(id: string): Promise<AgentApproval | null> {
    const known = this.byId.get(id);
    if (known) return known;
    if (!this.allInflight && Date.now() - this.allLoadedAt > 5_000) {
      this.allInflight = this.list({ status: 'all' })
        .then(() => undefined)
        .finally(() => {
          this.allInflight = null;
          this.allLoadedAt = Date.now();
        });
    }
    if (this.allInflight) await this.allInflight.catch(() => undefined);
    return this.byId.get(id) ?? null;
  }

  /**
   * `POST /v1/me/approvals/:id/approve` `{reason?}` — runs it now. Errors
   * (`ApiError`): 404 not yours, 409 `not_pending`, 410 `expired`.
   */
  approve(
    id: string,
    opts: { reason?: string; signal?: AbortSignal } = {},
  ): Promise<AgentApproval> {
    return this.decide(id, 'approve', opts);
  }

  /** `POST /v1/me/approvals/:id/deny` `{reason?}` — nothing runs. Same errors as `approve`. */
  deny(id: string, opts: { reason?: string; signal?: AbortSignal } = {}): Promise<AgentApproval> {
    return this.decide(id, 'deny', opts);
  }

  /** The latest seen state of one approval. */
  peek(id: string): AgentApproval | undefined {
    return this.byId.get(id);
  }

  /** Every pending approval seen, newest first. */
  pending(): AgentApproval[] {
    return [...this.byId.values()]
      .filter((a) => a.status === 'pending')
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }

  /**
   * Changes to the store. The first subscriber follows `agent:approval`
   * on the user channel; the last one gone stops that.
   */
  subscribe(fn: () => void): Unsubscribe {
    this.listeners.add(fn);
    if (this.listeners.size === 1) this.activate();
    return () => {
      if (!this.listeners.delete(fn)) return;
      if (this.listeners.size === 0) {
        this.unbind?.();
        this.unbind = null;
      }
    };
  }

  /** Record an approval seen elsewhere. A decided one is never undone by an older pending copy. */
  _apply(a: AgentApproval): void {
    if (this.store.apply(this.withAgent(a))) this.notify();
  }

  /** @internal The directory learned names: fill them in. */
  _refreshAgents(): void {
    let changed = false;
    for (const [id, a] of this.byId) {
      if (!a.agent && a.agentId) {
        const agent = this.agentInfo(a.agentId);
        if (agent) {
          this.byId.set(id, { ...a, agent });
          changed = true;
        }
      }
    }
    if (changed) this.notify();
  }

  private withAgent(a: AgentApproval): AgentApproval {
    if (a.agent || !a.agentId) return a;
    const agent = this.agentInfo(a.agentId);
    return agent ? { ...a, agent } : a;
  }

  private async decide(
    id: string,
    action: 'approve' | 'deny',
    opts: { reason?: string; signal?: AbortSignal },
  ): Promise<AgentApproval> {
    const reason = opts.reason?.trim();
    const res = await this.rest.request<unknown>({
      method: 'POST',
      path: `/v1/me/approvals/${encodeURIComponent(id)}/${action}`,
      body: reason ? { reason: reason.slice(0, APPROVAL_REASON_MAX) } : {},
      // An answer is not repeated behind the user's back.
      maxRetries: 0,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const prev = this.byId.get(id);
    const fromServer = approvalFromWire(unwrap(res));
    const next: AgentApproval = fromServer
      ? this.withAgent(fromServer)
      : {
          ...(prev ?? emptyApproval(id)),
          status: action === 'approve' ? 'running' : 'declined',
          reason: reason ?? null,
          decidedAt: new Date().toISOString(),
        };
    if (this.store.apply(next)) this.notify();
    return this.byId.get(id) ?? next;
  }

  private activate(): void {
    let offUser: (() => void) | null = null;
    let boundId: Uuid | null = null;
    const bind = (me: Me) => {
      if (me.id === boundId) return;
      offUser?.();
      boundId = me.id;
      offUser = this.bindUser(this.realtime.user(me.id));
    };
    const known = this.me.peek();
    if (known) bind(known);
    else void this.me.show().catch(() => {});
    const offMe = this.me.onChange(bind);
    this.unbind = () => {
      offMe();
      offUser?.();
    };
  }

  private bindUser(user: UserChannel): () => void {
    const offEvents = user.onAgentApproval((evt) => {
      const a = approvalFromWire(obj(evt)?.approval);
      if (a) this._apply(a);
    });
    // Events missed while away are not replayed: list again on rejoin.
    let first = true;
    const offJoined = user.onJoined(() => {
      if (first) {
        first = false;
        return;
      }
      void this.list().catch(() => undefined);
    });
    return () => {
      offEvents();
      offJoined();
    };
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

function emptyApproval(id: string): AgentApproval {
  return {
    id,
    agentId: null,
    agent: null,
    conversationId: null,
    requesterUserId: null,
    callId: null,
    tool: '',
    summary: toolLabel(''),
    details: [],
    status: 'pending',
    reason: null,
    decidedByUserId: null,
    decidedAt: null,
    expiresAt: null,
    createdAt: null,
  };
}

// ── REST: directory, scopes, memory, follow-ups ─────────────────────────

/**
 * `poolse.agents` — the directory (`GET /v1/me/agents`), scopes per
 * conversation (AG3), "What we know" (AG10) and follow-ups (AG11). Loading
 * the directory also teaches `poolse.users` the agents' names.
 */
export class AgentsResource {
  private readonly byId = new Map<string, AgentProfile>();

  constructor(
    private readonly rest: RestClient,
    private readonly onDirectory: (agents: AgentProfile[]) => void = () => undefined,
  ) {}

  /** `GET /v1/me/agents` — every agent the user can see. */
  async list(signal?: AbortSignal): Promise<AgentProfile[]> {
    const res = await this.rest.request<unknown>({
      method: 'GET',
      path: '/v1/me/agents',
      ...(signal ? { signal } : {}),
    });
    const rows = rowsOf(res)
      .map(agentProfileFromWire)
      .filter((a): a is AgentProfile => !!a);
    for (const a of rows) this.byId.set(a.id, a);
    this.onDirectory(rows);
    return rows;
  }

  /** An agent from the last directory load, by its agent id. */
  peek(agentId: string): AgentProfile | undefined {
    return this.byId.get(agentId);
  }

  /** `GET /v1/conversations/:id/agents` — its agents with their scopes (members). */
  async inConversation(conversationId: string, signal?: AbortSignal): Promise<ConversationAgent[]> {
    const res = await this.rest.request<unknown>({
      method: 'GET',
      path: `/v1/conversations/${encodeURIComponent(conversationId)}/agents`,
      ...(signal ? { signal } : {}),
    });
    const rows = rowsOf(res)
      .map(conversationAgentFromWire)
      .filter((a): a is ConversationAgent => !!a);
    for (const a of rows) this.byId.set(a.id, a);
    this.onDirectory(rows);
    return rows;
  }

  /**
   * `PUT /v1/conversations/:id/agents/:agent_id/scope` — narrow what the
   * agent may do here. Owners and admins (`forbidden`); `not_found` when
   * it isn't a member. A narrowing can only take away from the ceiling.
   */
  async setScope(
    conversationId: string,
    agentId: string,
    patch: AgentScopeUpdate,
    signal?: AbortSignal,
  ): Promise<AgentScope> {
    const res = await this.rest.request<unknown>({
      method: 'PUT',
      path: scopePath(conversationId, agentId),
      body: {
        ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
        ...(patch.tools !== undefined ? { tools: patch.tools } : {}),
        ...(patch.readHistory !== undefined ? { read_history: patch.readHistory } : {}),
      },
      ...(signal ? { signal } : {}),
    });
    return requireScope(res);
  }

  /** `DELETE …/scope` — back to the admin's ceiling. */
  async resetScope(
    conversationId: string,
    agentId: string,
    signal?: AbortSignal,
  ): Promise<AgentScope> {
    const res = await this.rest.request<unknown>({
      method: 'DELETE',
      path: scopePath(conversationId, agentId),
      ...(signal ? { signal } : {}),
    });
    return requireScope(res);
  }

  /** `GET /v1/me/memory?conversation_id&kind&q&limit` — facts the user may see. */
  async memory(
    opts: {
      conversationId?: string;
      kind?: MemoryKind;
      q?: string;
      limit?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<MemoryFact[]> {
    const res = await this.rest.request<unknown>({
      method: 'GET',
      path: '/v1/me/memory',
      query: {
        ...(opts.conversationId ? { conversation_id: opts.conversationId } : {}),
        ...(opts.kind ? { kind: opts.kind } : {}),
        ...(opts.q?.trim() ? { q: opts.q.trim().slice(0, 200) } : {}),
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return rowsOf(res)
      .map(memoryFactFromWire)
      .filter((f): f is MemoryFact => !!f);
  }

  /** `POST /v1/me/memory` — add a fact to a conversation you are in (`forbidden` otherwise). */
  async addMemory(input: {
    kind: MemoryKind;
    text: string;
    conversationId: string;
    ownerUserId?: string | null;
    dueOn?: string | null;
  }): Promise<MemoryFact> {
    const res = await this.rest.request<unknown>({
      method: 'POST',
      path: '/v1/me/memory',
      body: {
        kind: input.kind,
        text: input.text,
        conversation_id: input.conversationId,
        ...(input.ownerUserId !== undefined ? { owner_user_id: input.ownerUserId } : {}),
        ...(input.dueOn !== undefined ? { due_on: input.dueOn } : {}),
      },
    });
    return requireFact(res);
  }

  /** `PATCH /v1/me/memory/:id` — workspace-wide facts are `forbidden` (admins edit them). */
  async updateMemory(
    id: string,
    patch: { kind?: MemoryKind; text?: string; ownerUserId?: string | null; dueOn?: string | null },
  ): Promise<MemoryFact> {
    const res = await this.rest.request<unknown>({
      method: 'PATCH',
      path: `/v1/me/memory/${encodeURIComponent(id)}`,
      body: {
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        ...(patch.text !== undefined ? { text: patch.text } : {}),
        ...(patch.ownerUserId !== undefined ? { owner_user_id: patch.ownerUserId } : {}),
        ...(patch.dueOn !== undefined ? { due_on: patch.dueOn } : {}),
      },
    });
    return requireFact(res);
  }

  /** `DELETE /v1/me/memory/:id`. */
  async deleteMemory(id: string): Promise<void> {
    await this.rest.request<unknown>({
      method: 'DELETE',
      path: `/v1/me/memory/${encodeURIComponent(id)}`,
    });
  }

  /** `GET /v1/me/followups?status` — promises you made or are owed. */
  async followups(
    opts: { status?: FollowupStatus; signal?: AbortSignal } = {},
  ): Promise<Followup[]> {
    const res = await this.rest.request<unknown>({
      method: 'GET',
      path: '/v1/me/followups',
      query: { ...(opts.status ? { status: opts.status } : {}) },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return rowsOf(res)
      .map(followupFromWire)
      .filter((f): f is Followup => !!f);
  }

  /** `POST /v1/me/followups/:id/done` — owner or requester. */
  followupDone(id: string): Promise<Followup> {
    return this.followupAction(id, 'done');
  }

  /** `POST /v1/me/followups/:id/cancel` — owner or requester. */
  followupCancel(id: string): Promise<Followup> {
    return this.followupAction(id, 'cancel');
  }

  private async followupAction(id: string, action: 'done' | 'cancel'): Promise<Followup> {
    const res = await this.rest.request<unknown>({
      method: 'POST',
      path: `/v1/me/followups/${encodeURIComponent(id)}/${action}`,
      body: {},
    });
    const f = followupFromWire(unwrap(res));
    if (!f) throw new TypeError('followup: unexpected reply');
    return f;
  }
}

const scopePath = (conversationId: string, agentId: string) =>
  `/v1/conversations/${encodeURIComponent(conversationId)}/agents/${encodeURIComponent(agentId)}/scope`;

function requireScope(res: unknown): AgentScope {
  const s = scopeFromWire(unwrap(res));
  if (!s) throw new TypeError('agent scope: unexpected reply');
  return s;
}

function requireFact(res: unknown): MemoryFact {
  const f = memoryFactFromWire(unwrap(res));
  if (!f) throw new TypeError('memory: unexpected reply');
  return f;
}
