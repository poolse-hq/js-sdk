// Agents in chat (docs: README "Agents"):
//
//   * who is an agent — `is_agent` / `agent` on users, members and
//     messages, remembered per external id so every avatar and name of
//     that user carries the Agent badge (AG1);
//   * approval requests — the `{"kind":"agent_approval",…}` message an
//     agent posts before doing anything with an effect outside the chat,
//     and `GET/POST /v1/approvals` to list and answer them (AG4);
//   * citations under an assistant's answer (AG5).
//
// Every wire shape is read in the "wire mapping" section below and
// nowhere else: the server side of these features is still settling,
// so a renamed field is a change to one function here.

import type { PoolseRealtime, UserChannel } from './realtime/realtime.js';
import type { Unsubscribe } from './realtime/types.js';
import type { MeResource } from './resources/me.js';
import type { RestClient } from './rest-client.js';
import type { Me, Message, Uuid } from './types.js';

/** What the UI needs to know about an agent. */
export interface AgentInfo {
  /** The agent's own id (not its user id); null when only `is_agent` was sent. */
  id: string | null;
  /** The agent's name, e.g. "Scout". */
  name: string | null;
  /** What kind of agent: `assistant`, `note_taker`, a template key… Free-form. */
  kind: string | null;
}

/** Where an approval request stands. */
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

/** One line of an approval's details ("To", "Subject", …). */
export interface ApprovalDetail {
  /** Empty for free text. */
  label: string;
  value: string;
}

/** An agent asking before it acts (`kind: "agent_approval"` messages, `/v1/approvals`). */
export interface AgentApproval {
  id: string;
  agent: AgentInfo | null;
  /** One line: "Send an email to ana@acme.com". */
  summary: string;
  /** What exactly it will do, as label/value lines. */
  details: ApprovalDetail[];
  status: ApprovalStatus;
  conversationId: Uuid | null;
  /** The approval message in the conversation, when known. */
  messageId: Uuid | null;
  createdAt: string | null;
  expiresAt: string | null;
  decidedAt: string | null;
  decidedByUserId: Uuid | null;
  /** The reason given with the answer. */
  reason: string | null;
}

/** What an assistant's answer points at. */
export type CitationType = 'message' | 'file' | 'transcript';

/** One source under an assistant's answer (`message.citations`). */
export interface Citation {
  type: CitationType;
  /** Message id, attachment id or transcript id. */
  id: string;
  conversationId: Uuid | null;
  callId: string | null;
  /** Transcript citations: where in the call (ms since the transcript started). */
  startMs: number | null;
  /** The quoted words, for the link's text. */
  snippet: string;
}

/** Longest reason sent with an answer. */
export const APPROVAL_REASON_MAX = 500;

// ── wire mapping (adjust here when the server contract changes) ─────────

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;

/** `agent: {id, name, kind}` (or `is_agent: true` alone) → AgentInfo; null for people. */
export function agentFromWire(raw: unknown): AgentInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const a = o.agent && typeof o.agent === 'object' ? (o.agent as Record<string, unknown>) : null;
  if (o.is_agent !== true && !a) return null;
  return { id: str(a?.id), name: str(a?.name), kind: str(a?.kind) };
}

/** The agent that sent a message (`is_agent` / `agent` on the message); null for a person. */
export function messageAgent(message: unknown): AgentInfo | null {
  return agentFromWire(message);
}

const STATUSES: readonly ApprovalStatus[] = ['pending', 'approved', 'denied', 'expired'];

/** One approval as the server sends it (REST row, event payload or message body). */
export function approvalFromWire(raw: unknown): AgentApproval | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.approval_id) ?? str(o.id);
  if (!id) return null;
  const status = STATUSES.includes(o.status as ApprovalStatus)
    ? (o.status as ApprovalStatus)
    : 'pending';
  const agentRaw = o.agent && typeof o.agent === 'object' ? { agent: o.agent } : null;
  return {
    id,
    agent: agentFromWire(agentRaw),
    summary:
      clip(str(o.summary) ?? str(o.action_summary) ?? str(o.action), 300) ??
      'An action needs your approval',
    details: detailsFromWire(o.details),
    status,
    conversationId: str(o.conversation_id),
    messageId: str(o.message_id),
    createdAt: str(o.inserted_at) ?? str(o.created_at),
    expiresAt: str(o.expires_at),
    decidedAt: str(o.decided_at),
    decidedByUserId: str(o.decided_by_user_id),
    reason: clip(str(o.reason), APPROVAL_REASON_MAX),
  };
}

function detailsFromWire(raw: unknown): ApprovalDetail[] {
  if (typeof raw === 'string') return raw.trim() ? [{ label: '', value: clip(raw, 2000)! }] : [];
  if (Array.isArray(raw)) {
    return raw
      .map((d) => {
        if (typeof d === 'string') return { label: '', value: d };
        if (d && typeof d === 'object') {
          const r = d as Record<string, unknown>;
          return { label: str(r.label) ?? '', value: valueText(r.value) };
        }
        return null;
      })
      .filter((d): d is ApprovalDetail => !!d && d.value !== '')
      .slice(0, 30)
      .map((d) => ({ label: clip(d.label, 60)!, value: clip(d.value, 2000)! }));
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .map(([k, v]) => ({ label: humanize(k), value: valueText(v) }))
      .filter((d) => d.value !== '')
      .slice(0, 30)
      .map((d) => ({ label: clip(d.label, 60)!, value: clip(d.value, 2000)! }));
  }
  return [];
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

function clip(s: string | null, max: number): string | null {
  if (s === null) return null;
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** The JSON object in a system/custom message body with this `kind`, else null. */
export function kindPayload(
  message: Pick<Message, 'type' | 'body'> & { deleted_at?: string | null; kind?: unknown },
  kind: string,
): Record<string, unknown> | null {
  if (message.deleted_at) return null;
  // A top-level `kind` with the fields beside it (`payload` / `data`).
  if (message.kind === kind) {
    const m = message as unknown as Record<string, unknown>;
    const inner = m.payload ?? m.data;
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      return inner as Record<string, unknown>;
    }
  }
  const body = message.body;
  if (typeof body !== 'string') return null;
  const trimmed = body.trim();
  if (!trimmed.startsWith('{') || !trimmed.includes(`"${kind}"`)) return null;
  try {
    const raw: unknown = JSON.parse(trimmed);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return (raw as Record<string, unknown>).kind === kind ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The approval request a message carries (`kind: "agent_approval"`), else null. */
export function parseApproval(
  message: Pick<Message, 'type' | 'body'> & {
    id?: string;
    conversation_id?: string;
    inserted_at?: string;
    deleted_at?: string | null;
  },
): AgentApproval | null {
  const payload = kindPayload(message, 'agent_approval');
  if (!payload) return null;
  const a = approvalFromWire(payload);
  if (!a) return null;
  return {
    ...a,
    // The message's sender is the agent when the body leaves it out.
    agent: a.agent ?? messageAgent(message),
    conversationId: a.conversationId ?? message.conversation_id ?? null,
    messageId: a.messageId ?? message.id ?? null,
    createdAt: a.createdAt ?? message.inserted_at ?? null,
  };
}

const CITATION_TYPES: readonly CitationType[] = ['message', 'file', 'transcript'];

/** The sources under an assistant's answer (`message.citations`), in order. */
export function citationsOf(message: {
  citations?: unknown;
  deleted_at?: string | null;
}): Citation[] {
  if (message.deleted_at || !Array.isArray(message.citations)) return [];
  const out: Citation[] = [];
  for (const raw of message.citations.slice(0, 20)) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    if (!CITATION_TYPES.includes(o.type as CitationType)) continue;
    const id = str(o.id);
    if (!id) continue;
    out.push({
      type: o.type as CitationType,
      id,
      conversationId: str(o.conversation_id),
      callId: str(o.call_id),
      startMs: num(o.start_ms),
      snippet: clip(str(o.snippet)?.replace(/\s+/g, ' ').trim() ?? null, 200) ?? '',
    });
  }
  return out;
}

// ── display ─────────────────────────────────────────────────────────────

/** "Waiting for approval", "Approved", "Denied", "Expired". */
export function approvalStatusLabel(status: ApprovalStatus): string {
  switch (status) {
    case 'approved':
      return 'Approved';
    case 'denied':
      return 'Denied';
    case 'expired':
      return 'Expired';
    default:
      return 'Waiting for approval';
  }
}

/** The link text for a citation: its snippet, else what it is. */
export function citationLabel(c: Citation): string {
  if (c.snippet) return c.snippet;
  if (c.type === 'transcript') return 'From a meeting';
  if (c.type === 'file') return 'A file';
  return 'A message';
}

/** Conversation-list preview for an approval body; null when it isn't one. */
export function formatApprovalPreview(preview: string | null | undefined): string | null {
  if (typeof preview !== 'string') return null;
  const a = parseApproval({ type: 'custom', body: preview });
  return a ? `Approval: ${a.summary}` : null;
}

/** Plain-language text for a failed approve / deny. */
export function approvalErrorMessage(err: unknown): string {
  const e = err as { code?: unknown; status?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  switch (code) {
    case 'already_decided':
    case 'not_pending':
      return 'Someone already answered this request.';
    case 'expired':
    case 'approval_expired':
      return 'This request expired. Ask the agent again.';
    case 'forbidden':
    case 'not_allowed':
      return 'You can’t answer this request.';
    case 'not_found':
      return 'This request no longer exists.';
    case 'validation_failed':
      return `The reason can be up to ${APPROVAL_REASON_MAX} characters.`;
    case 'rate_limited':
      return 'Too many tries. Wait a minute and try again.';
    default:
      return 'The answer couldn’t be sent. Try again.';
  }
}

// ── REST + live store ───────────────────────────────────────────────────

export interface ApprovalListOptions {
  /** Default `pending`. */
  status?: ApprovalStatus;
  limit?: number;
  signal?: AbortSignal;
}

/**
 * `poolse.approvals` — an agent's requests to act, and your answers.
 *
 *   await poolse.approvals.list()                      // pending ones
 *   await poolse.approvals.approve(id)
 *   await poolse.approvals.deny(id, { reason: 'Not this week' })
 *
 * Also a small live store (`subscribe` / `peek`): every approval seen
 * through `list`, an answer, a realtime event or `_apply` (the UI feeds
 * it the approval messages it renders), so a card in the chat and a
 * pending list show the same status.
 */
export class ApprovalsResource {
  private readonly byId = new Map<string, AgentApproval>();
  private readonly listeners = new Set<() => void>();
  private unbind: (() => void) | null = null;

  constructor(
    private readonly rest: RestClient,
    private readonly realtime: PoolseRealtime,
    private readonly me: MeResource,
  ) {}

  /** `GET /v1/approvals?status=pending` — newest first. */
  async list(opts: ApprovalListOptions = {}): Promise<AgentApproval[]> {
    const res = await this.rest.request<unknown>({
      method: 'GET',
      path: '/v1/approvals',
      query: {
        status: opts.status ?? 'pending',
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const rows = listFromWire(res);
    for (const a of rows) this.byId.set(a.id, a);
    // A pending row the server no longer lists was answered elsewhere.
    if ((opts.status ?? 'pending') === 'pending' && opts.limit === undefined) {
      const listed = new Set(rows.map((a) => a.id));
      for (const [id, a] of this.byId) {
        if (a.status === 'pending' && !listed.has(id)) this.byId.delete(id);
      }
    }
    this.notify();
    return rows;
  }

  /**
   * `POST /v1/approvals/:id/approve` — the agent goes ahead. Errors
   * (`ApiError.code`): `forbidden`, `not_found`, `already_decided`,
   * `expired`, `validation_failed` (reason too long), `rate_limited`.
   */
  approve(
    id: string,
    opts: { reason?: string; signal?: AbortSignal } = {},
  ): Promise<AgentApproval> {
    return this.decide(id, 'approve', opts);
  }

  /** `POST /v1/approvals/:id/deny` — the agent doesn't do it. Same errors as `approve`. */
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
   * Changes to the store. The first subscriber follows the user
   * channel's approval events; the last one gone stops that.
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

  /** Record an approval seen elsewhere (a message). A newer answer is never undone by an older copy. */
  _apply(a: AgentApproval): void {
    const prev = this.byId.get(a.id);
    if (prev && prev.status !== 'pending' && a.status === 'pending') return;
    if (prev && sameApproval(prev, a)) return;
    this.byId.set(a.id, prev ? { ...prev, ...a, agent: a.agent ?? prev.agent } : a);
    this.notify();
  }

  private async decide(
    id: string,
    action: 'approve' | 'deny',
    opts: { reason?: string; signal?: AbortSignal },
  ): Promise<AgentApproval> {
    const reason = opts.reason?.trim();
    const res = await this.rest.request<unknown>({
      method: 'POST',
      path: `/v1/approvals/${encodeURIComponent(id)}/${action}`,
      body: reason ? { reason: reason.slice(0, APPROVAL_REASON_MAX) } : {},
      // An answer is not repeated behind the user's back.
      maxRetries: 0,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const prev = this.byId.get(id);
    const fromServer = approvalFromWire(unwrap(res));
    const next: AgentApproval = fromServer
      ? { ...fromServer, agent: fromServer.agent ?? prev?.agent ?? null }
      : {
          ...(prev ?? emptyApproval(id)),
          status: action === 'approve' ? 'approved' : 'denied',
          reason: reason ?? null,
          decidedAt: new Date().toISOString(),
        };
    this.byId.set(id, next);
    this.notify();
    return next;
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
    const offEvents = user.onApproval((payload) => {
      const a = approvalFromWire(unwrap(payload));
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

function unwrap(res: unknown): unknown {
  if (res && typeof res === 'object' && 'data' in (res as object)) {
    return (res as { data: unknown }).data;
  }
  if (res && typeof res === 'object' && 'approval' in (res as object)) {
    return (res as { approval: unknown }).approval;
  }
  return res;
}

function listFromWire(res: unknown): AgentApproval[] {
  const rows = unwrap(res);
  if (!Array.isArray(rows)) return [];
  return rows.map(approvalFromWire).filter((a): a is AgentApproval => !!a);
}

function emptyApproval(id: string): AgentApproval {
  return {
    id,
    agent: null,
    summary: 'An action needs your approval',
    details: [],
    status: 'pending',
    conversationId: null,
    messageId: null,
    createdAt: null,
    expiresAt: null,
    decidedAt: null,
    decidedByUserId: null,
    reason: null,
  };
}

function sameApproval(a: AgentApproval, b: AgentApproval): boolean {
  return (
    a.status === b.status &&
    a.summary === b.summary &&
    a.reason === b.reason &&
    a.decidedAt === b.decidedAt &&
    a.details.length === b.details.length
  );
}
