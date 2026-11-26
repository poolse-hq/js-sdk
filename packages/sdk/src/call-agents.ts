// Agents in calls (the server's docs/AGENTS_IN_CALLS.md): the note-taker
// and assistant as visible call participants (AG13, AG14), the private
// whisper stream to one person (AG15), and an agent attending on
// someone's behalf — its brief and its questions by push (AG16).
//
//   poolse.callAgents.list(callId)                   the agents in the call
//   poolse.callAgents.invite(callId, agentId, 'notetaker')
//   poolse.callAgents.setMode(callId, agentId, 'assistant') / .remove(…)
//   poolse.callAgents.subscribe(conversationId, callId, { onAgents, onSaid })
//   poolse.callAgents.whisper.get(callId) / .set(callId, true) / .subscribe(…)
//   poolse.callAgents.briefs.create({ callId, text, rules })
//   poolse.escalations.list() / .reply(id, { decision: 'approve' }) / ({ answer })
//   poolse.notificationActions.escalation({ token, decision })   no session
//
// An agent in a call is a LiveKit participant like a person (identity =
// the agent's poolse user id, kind AGENT) marked by its token metadata
// (`agent: true`, `mode`, `label`): `callAgentOfParticipant` reads it, so
// a tile or roster row shows the Agent badge and "Taking notes" — and its
// `speaking` is LiveKit's own, like anyone's (AG14). It never counts as
// someone keeping a call alive.
//
// Every path, field and event name is in the WIRE section and the
// `*FromWire` mappers. Unknown or missing fields map to null / empty.

import type { PoolseRealtime } from './realtime/realtime.js';
import type { Unsubscribe } from './realtime/types.js';
import type { MeResource } from './resources/me.js';
import type { RestClient } from './rest-client.js';
import type { Me } from './types.js';
import { PendingItems } from './pending-store.js';

// ── WIRE (adjust here when the server contract changes) ─────────────────

const enc = encodeURIComponent;
const call = (id: string) => `/v1/calls/${enc(id)}`;

/** Paths of the agents-in-calls endpoints (AGENTS_IN_CALLS.md §2, §4, §5). */
export const CALL_AGENTS_PATHS = {
  agents: (callId: string) => `${call(callId)}/agents`,
  agent: (callId: string, agentId: string) => `${call(callId)}/agents/${enc(agentId)}`,
  whisper: (callId: string) => `${call(callId)}/whisper`,
  briefs: () => '/v1/agent-briefs',
  brief: (id: string) => `/v1/agent-briefs/${enc(id)}`,
  escalations: () => '/v1/me/agent-escalations',
  /** User token, or the push's `reply_token` in the body (no Authorization). */
  escalationReply: (id: string) => `/v1/agent-escalations/${enc(id)}/reply`,
} as const;

/** Conversation-topic events (with `call_id`). */
export const CALL_AGENTS_EVENTS = {
  agents: 'call:agents',
  said: 'agent:said',
} as const;

/** User-topic events (only the person they're for gets them). */
export const CALL_AGENTS_USER_EVENTS = {
  whisperHint: 'whisper:hint',
  whisperChanged: 'whisper:changed',
  escalation: 'agent:escalation',
} as const;

/** The push `type` of an escalation; iOS category `poolse_agent_escalation`. */
export const ESCALATION_PUSH_TYPE = 'agent_escalation';

/** The longest answer to an escalation (characters). */
export const ESCALATION_ANSWER_MAX = 1000;
/** The longest brief text, and rule. */
export const BRIEF_TEXT_MAX = 4000;
export const BRIEF_RULE_MAX = 300;
export const BRIEF_RULES_MAX = 20;
/** Hints a person gets per call at most (the server's cap). */
export const WHISPER_HINTS_MAX = 40;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
const clip = (s: string | null, max: number): string | null =>
  s === null ? null : s.length > max ? s.slice(0, max - 1) + '…' : s;
// Only an object or list under `key` is a wrapper.
const unwrap = (res: unknown, key: string): unknown => {
  const o = obj(res);
  const wrapped = (v: unknown) => (v !== null && typeof v === 'object' ? v : undefined);
  return wrapped(o?.[key]) ?? wrapped(obj(o?.data)?.[key]) ?? o?.data ?? res;
};
const rows = (res: unknown, key: string): unknown[] => {
  const o = obj(res);
  if (Array.isArray(res)) return res;
  if (Array.isArray(o?.data)) return o.data as unknown[];
  return arr(o?.[key] ?? obj(o?.data)?.[key]);
};
const strings = (v: unknown): string[] =>
  arr(v).filter((x): x is string => typeof x === 'string' && x !== '');

// ── agents as participants (AG13, AG14) ─────────────────────────────────

/**
 * Why the agent is in the call: `notetaker` stays silent and makes the
 * transcript, summary and tasks; `assistant` also answers when addressed
 * by name; `delegate` attends for someone ("Jasir's agent", AG16).
 */
export type CallAgentMode = 'notetaker' | 'assistant' | 'delegate';

/** Where the agent's session stands. */
export type CallAgentStatus = 'joining' | 'live' | 'left' | 'failed';

/** What to show under its name: "Joining…", "Taking notes", "Listening", "Speaking". */
export type CallAgentState = 'joining' | 'taking_notes' | 'listening' | 'speaking';

/** An agent in a call. */
export interface CallAgent {
  sessionId: string | null;
  callId: string | null;
  agentId: string;
  /** Its poolse user id — its LiveKit identity (match `CallParticipant.userId`). */
  userId: string | null;
  /** The agent's own name ("Scout"). */
  name: string;
  /** What to call it in the call: "Scout", or "Jasir's agent" for a delegate. */
  label: string;
  avatarUrl: string | null;
  mode: CallAgentMode;
  status: CallAgentStatus;
  /** Speaking right now (the server's flag; LiveKit's `speaking` is live). */
  speaking: boolean;
  /** `delegate`: whose agent it is. */
  onBehalfOfUserId: string | null;
  onBehalfOfName: string | null;
  /** Null when it came by itself (the room's default note-taker, a brief). */
  invitedByUserId: string | null;
  auto: boolean;
  joinedAt: string | null;
}

const MODES: readonly CallAgentMode[] = ['notetaker', 'assistant', 'delegate'];
const STATUSES: readonly CallAgentStatus[] = ['joining', 'live', 'left', 'failed'];

const modeOf = (v: unknown): CallAgentMode =>
  MODES.includes(v as CallAgentMode) ? (v as CallAgentMode) : 'notetaker';

/** A CallAgent row (REST, `call:agents`, `meeting.agents`) → CallAgent. */
export function callAgentFromWire(raw: unknown): CallAgent | null {
  const o = obj(raw);
  const agentId = str(o?.agent_id);
  if (!o || !agentId) return null;
  const by = obj(o.on_behalf_of);
  const name = clip(str(o.name) ?? str(o.label), 80) ?? 'Agent';
  return {
    sessionId: str(o.session_id),
    callId: str(o.call_id),
    agentId,
    userId: str(o.user_id),
    name,
    label: clip(str(o.label), 80) ?? name,
    avatarUrl: str(o.avatar_url),
    mode: modeOf(o.mode),
    status: STATUSES.includes(o.status as CallAgentStatus) ? (o.status as CallAgentStatus) : 'live',
    speaking: o.speaking === true,
    onBehalfOfUserId: str(by?.user_id) ?? str(o.on_behalf_of_user_id),
    onBehalfOfName: clip(str(by?.display_name) ?? str(by?.name), 80),
    invitedByUserId: str(o.invited_by_user_id),
    auto: o.auto === true,
    joinedAt: str(o.joined_at),
  };
}

/** The agents in a list (live ones: `joining` or `live`). */
export function callAgentsFromWire(raw: unknown): CallAgent[] {
  return arr(raw)
    .map(callAgentFromWire)
    .filter((a): a is CallAgent => !!a && (a.status === 'joining' || a.status === 'live'));
}

function parseMetadata(metadata: unknown): Obj | null {
  if (typeof metadata !== 'string') return obj(metadata);
  try {
    return obj(JSON.parse(metadata));
  } catch {
    return null;
  }
}

/**
 * True for the token metadata of an agent in the call (`agent: true`) —
 * shown with the Agent badge, unlike poolse's own room assistant and
 * recorder. A string (LiveKit's raw metadata) or a parsed object.
 */
export function isAgentMetadata(metadata: unknown): boolean {
  return parseMetadata(metadata)?.agent === true;
}

/**
 * The agent behind a call participant, from its token metadata, or null
 * for a person. Pass `known` (from `useCallAgents` / `meeting.agents`)
 * to fill in what metadata doesn't carry (its own name, who invited it).
 */
export function callAgentOfParticipant(
  p: {
    userId: string;
    name?: string | null | undefined;
    metadata?: Record<string, unknown> | undefined;
    speaking?: boolean | undefined;
  },
  known?: readonly CallAgent[] | null,
): CallAgent | null {
  const fromList = known?.find((a) => a.userId === p.userId) ?? null;
  const m = p.metadata ?? {};
  if (m.agent !== true)
    return fromList ? { ...fromList, speaking: p.speaking ?? fromList.speaking } : null;
  const label = clip(str(m.label) ?? p.name ?? null, 80);
  const base: CallAgent = fromList ?? {
    sessionId: str(m.session_id),
    callId: null,
    agentId: str(m.agent_id) ?? p.userId,
    userId: p.userId,
    name: label ?? 'Agent',
    label: label ?? 'Agent',
    avatarUrl: null,
    mode: modeOf(m.mode),
    status: 'live',
    speaking: false,
    onBehalfOfUserId: str(m.on_behalf_of_user_id),
    onBehalfOfName: null,
    invitedByUserId: null,
    auto: false,
    joinedAt: null,
  };
  return { ...base, mode: modeOf(m.mode ?? base.mode), speaking: p.speaking ?? base.speaking };
}

/** What it's doing, for under its name. */
export function callAgentStateOf(
  agent: Pick<CallAgent, 'status' | 'mode' | 'speaking'>,
): CallAgentState {
  if (agent.status === 'joining') return 'joining';
  if (agent.speaking) return 'speaking';
  return agent.mode === 'notetaker' ? 'taking_notes' : 'listening';
}

/** "Joining…", "Taking notes", "Listening", "Speaking". */
export function callAgentStateLabel(state: CallAgentState): string {
  switch (state) {
    case 'joining':
      return 'Joining…';
    case 'taking_notes':
      return 'Taking notes';
    case 'speaking':
      return 'Speaking';
    default:
      return 'Listening';
  }
}

/** "Note-taker", "Assistant", "Attending for Jasir". */
export function callAgentModeLabel(agent: Pick<CallAgent, 'mode' | 'onBehalfOfName'>): string {
  if (agent.mode === 'assistant') return 'Assistant';
  if (agent.mode === 'delegate')
    return agent.onBehalfOfName ? `Attending for ${agent.onBehalfOfName}` : 'Attending for someone';
  return 'Note-taker';
}

/** `agent:said` — what an agent said aloud (an optional caption). */
export interface AgentSaid {
  callId: string;
  sessionId: string | null;
  agentId: string | null;
  text: string;
  language: string | null;
}

// ── whisper (AG15) ───────────────────────────────────────────────────────

/** A fact, a promise made last time, a question to raise, a reminder. */
export type WhisperHintKind = 'fact' | 'promise' | 'question' | 'reminder';

/** Where a hint came from. */
export interface WhisperSource {
  type: 'summary' | 'transcript' | 'memory' | 'followup' | 'message' | (string & {});
  id: string;
  title: string | null;
  callId: string | null;
  conversationId: string | null;
}

/** One private hint, only for you. */
export interface WhisperHint {
  id: string;
  callId: string;
  kind: WhisperHintKind;
  /** ≤ 300 chars. */
  text: string;
  sources: WhisperSource[];
  at: string | null;
}

/** Your whisper in one call. */
export interface WhisperState {
  callId: string;
  on: boolean;
  /** The agent whispering; null while off. */
  agent: { id: string; name: string; userId: string | null } | null;
  startedAt: string | null;
  hintCount: number;
}

const HINT_KINDS: readonly WhisperHintKind[] = ['fact', 'promise', 'question', 'reminder'];

/** A Hint (REST or the flat `whisper:hint` payload) → WhisperHint. */
export function whisperHintFromWire(raw: unknown, callId?: string): WhisperHint | null {
  const o = obj(raw);
  const id = str(o?.id);
  const text = str(o?.text);
  const cid = str(o?.call_id) ?? callId ?? null;
  if (!o || !id || !text || !cid) return null;
  return {
    id,
    callId: cid,
    kind: HINT_KINDS.includes(o.kind as WhisperHintKind) ? (o.kind as WhisperHintKind) : 'fact',
    text: clip(text, 300)!,
    sources: arr(o.sources)
      .map((s): WhisperSource | null => {
        const x = obj(s);
        const sid = str(x?.id);
        const type = str(x?.type);
        return x && sid && type
          ? {
              type,
              id: sid,
              title: clip(str(x.title), 120),
              callId: str(x.call_id),
              conversationId: str(x.conversation_id),
            }
          : null;
      })
      .filter((s): s is WhisperSource => !!s),
    at: str(o.at),
  };
}

/** A `whisper` object → WhisperState. */
export function whisperFromWire(raw: unknown, callId: string): WhisperState | null {
  const o = obj(unwrap(raw, 'whisper'));
  if (!o) return null;
  const a = obj(o.agent);
  const agentId = str(a?.id);
  return {
    callId: str(o.call_id) ?? callId,
    on: o.on === true,
    agent:
      a && agentId
        ? { id: agentId, name: clip(str(a.name), 80) ?? 'Agent', userId: str(a.user_id) }
        : null,
    startedAt: str(o.started_at),
    hintCount: Math.max(0, int(o.hint_count) ?? 0),
  };
}

/** "Fact", "You promised", "Ask about", "Reminder". */
export function whisperHintKindLabel(kind: WhisperHintKind): string {
  switch (kind) {
    case 'promise':
      return 'You promised';
    case 'question':
      return 'Ask about';
    case 'reminder':
      return 'Reminder';
    default:
      return 'Fact';
  }
}

/** A plain sentence for a failed agent invite (or mode change / removal) in a call. */
export function callAgentInviteErrorMessage(err: unknown): string {
  switch (codeOf(err)) {
    case 'not_in_call':
      return 'Join the call to invite an agent.';
    case 'agents_not_allowed':
      return 'You can’t invite agents to this call.';
    case 'agent_not_member':
      return 'Add the agent to this conversation first.';
    case 'agent_paused':
      return 'This agent is paused.';
    case 'transcription_disabled':
    case 'transcription_unavailable':
      return 'Agents need live transcription, which isn’t available here.';
    case 'speaking_disabled':
      return 'Agents can’t speak in calls here — invite it to take notes.';
    case 'voice_unavailable':
      return 'Agents can’t join calls right now. Try again soon.';
    case 'rate_limited':
      return 'Too many changes. Wait a moment.';
    default:
      return 'That didn’t work. Try again.';
  }
}

/** A plain sentence for a whisper error. */
export function whisperErrorMessage(err: unknown): string {
  const code = codeOf(err);
  switch (code) {
    case 'not_in_call':
      return 'Join the call to get hints.';
    case 'whisper_disabled':
      return 'Whisper is turned off in this workspace.';
    case 'no_agent':
      return 'There’s no agent to whisper to you yet.';
    case 'captions_disabled':
    case 'transcription_unavailable':
      return 'Whisper needs live captions, which aren’t available here.';
    case 'rate_limited':
      return 'Too many changes. Wait a moment.';
    default:
      return 'Whisper couldn’t be changed. Try again.';
  }
}

// ── briefs (AG16) ────────────────────────────────────────────────────────

export type BriefStatus = 'waiting' | 'attending' | 'done' | 'cancelled';

/** What your agent is told to do in a meeting it attends for you. */
export interface AgentBrief {
  id: string;
  userId: string | null;
  agentId: string | null;
  agentName: string | null;
  scheduledMeetingId: string | null;
  callId: string | null;
  conversationId: string | null;
  text: string;
  rules: string[];
  escalationTimeoutSeconds: number;
  status: BriefStatus;
  sessionId: string | null;
  /** After the meeting: what it said, agreed to and left open. */
  report: { said: string[]; agreed: string[]; open: string[] } | null;
  reportMessageId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

const BRIEF_STATUSES: readonly BriefStatus[] = ['waiting', 'attending', 'done', 'cancelled'];

export function briefFromWire(raw: unknown): AgentBrief | null {
  const o = obj(unwrap(raw, 'brief'));
  const id = str(o?.id);
  if (!o || !id) return null;
  const r = obj(o.report);
  return {
    id,
    userId: str(o.user_id),
    agentId: str(o.agent_id),
    agentName: clip(str(o.agent_name), 80),
    scheduledMeetingId: str(o.scheduled_meeting_id),
    callId: str(o.call_id),
    conversationId: str(o.conversation_id),
    text: str(o.text) ?? '',
    rules: strings(o.rules),
    escalationTimeoutSeconds: int(o.escalation_timeout_seconds) ?? 120,
    status: BRIEF_STATUSES.includes(o.status as BriefStatus)
      ? (o.status as BriefStatus)
      : 'waiting',
    sessionId: str(o.session_id),
    report: r ? { said: strings(r.said), agreed: strings(r.agreed), open: strings(r.open) } : null,
    reportMessageId: str(o.report_message_id),
    createdAt: str(o.inserted_at),
    updatedAt: str(o.updated_at),
  };
}

/** Writing a brief: for a scheduled meeting or a live call. */
export interface AgentBriefInput {
  scheduledMeetingId?: string;
  callId?: string;
  text: string;
  rules?: string[];
  agentId?: string;
  /** 30–600 (default 120). */
  escalationTimeoutSeconds?: number;
}

function briefBody(input: Partial<AgentBriefInput>): Obj {
  const body: Obj = {};
  if (input.scheduledMeetingId) body.scheduled_meeting_id = input.scheduledMeetingId;
  if (input.callId) body.call_id = input.callId;
  if (input.text !== undefined) body.text = input.text.trim().slice(0, BRIEF_TEXT_MAX);
  if (input.rules !== undefined)
    body.rules = input.rules
      .map((r) => r.trim().slice(0, BRIEF_RULE_MAX))
      .filter(Boolean)
      .slice(0, BRIEF_RULES_MAX);
  if (input.agentId) body.agent_id = input.agentId;
  if (input.escalationTimeoutSeconds !== undefined)
    body.escalation_timeout_seconds = Math.min(
      600,
      Math.max(30, Math.round(input.escalationTimeoutSeconds)),
    );
  return body;
}

// ── escalations (AG16) ───────────────────────────────────────────────────

/** How you can answer: approve or decline what it asks, or write an answer. */
export type EscalationDecision = 'approve' | 'decline' | 'answer';

export type EscalationStatus =
  | 'pending'
  | 'approved'
  | 'declined'
  | 'answered'
  | 'expired'
  | 'cancelled';

/** Your agent, in a meeting for you, asking something its brief doesn't cover. */
export interface AgentEscalation {
  id: string;
  sessionId: string | null;
  callId: string | null;
  conversationId: string | null;
  agentId: string | null;
  userId: string | null;
  /** "They ask for 10% off — accept?" */
  question: string;
  /** What you may answer with. */
  options: EscalationDecision[];
  status: EscalationStatus;
  /** Your written answer once given. */
  answer: string | null;
  decidedAt: string | null;
  expiresAt: string | null;
  createdAt: string | null;
}

const DECISIONS: readonly EscalationDecision[] = ['approve', 'decline', 'answer'];
const ESC_STATUSES: readonly EscalationStatus[] = [
  'pending',
  'approved',
  'declined',
  'answered',
  'expired',
  'cancelled',
];

/** An `options` value (list, or the push's comma string) → the decisions offered. */
export function parseEscalationOptions(raw: unknown): EscalationDecision[] {
  const list = typeof raw === 'string' ? raw.split(',') : Array.isArray(raw) ? raw : [];
  const set = new Set(
    list
      .map((d) => (typeof d === 'string' ? d.trim() : ''))
      .filter((d): d is EscalationDecision => DECISIONS.includes(d as EscalationDecision)),
  );
  return set.size ? DECISIONS.filter((d) => set.has(d)) : [...DECISIONS];
}

export function escalationFromWire(raw: unknown): AgentEscalation | null {
  const o = obj(unwrap(raw, 'escalation'));
  const id = str(o?.id);
  if (!o || !id) return null;
  return {
    id,
    sessionId: str(o.session_id),
    callId: str(o.call_id),
    conversationId: str(o.conversation_id),
    agentId: str(o.agent_id),
    userId: str(o.user_id),
    question: clip(str(o.question), 1000) ?? '',
    options: parseEscalationOptions(o.options),
    status: ESC_STATUSES.includes(o.status as EscalationStatus)
      ? (o.status as EscalationStatus)
      : 'pending',
    answer: clip(str(o.answer), ESCALATION_ANSWER_MAX),
    decidedAt: str(o.decided_at),
    expiresAt: str(o.expires_at),
    createdAt: str(o.inserted_at),
  };
}

/** "Waiting for you", "Approved", "Declined", "Answered", "Expired"… */
export function escalationStatusLabel(status: EscalationStatus): string {
  switch (status) {
    case 'approved':
      return 'Approved';
    case 'declined':
      return 'Declined';
    case 'answered':
      return 'Answered';
    case 'expired':
      return 'Expired';
    case 'cancelled':
      return 'No longer needed';
    default:
      return 'Waiting for you';
  }
}

/** Plain-language text for a failed reply. */
export function escalationErrorMessage(err: unknown): string {
  const code = codeOf(err);
  const status = (err as { status?: unknown } | null)?.status;
  if (code === 'not_pending' || status === 409) return 'This was already answered.';
  if (code === 'expired' || status === 410) return 'Too late — the question expired.';
  if (code === 'invalid_token' || status === 401)
    return 'This notification expired. Open the app to answer.';
  if (code === 'not_found' || status === 404) return 'This question isn’t waiting for you.';
  if (code === 'validation_failed' || status === 422)
    return `The answer can be 1 to ${ESCALATION_ANSWER_MAX} characters.`;
  if (code === 'rate_limited' || status === 429) return 'Too many tries. Wait a moment.';
  return 'The answer couldn’t be sent. Try again.';
}

/** A reply: approve / decline, or a written answer. */
export type EscalationReply = { decision: 'approve' | 'decline' } | { answer: string };

/** The body of a reply (`{decision}` or `{answer}`, plus `token` from a push). */
export function escalationReplyBody(reply: EscalationReply, token?: string): Obj {
  const body: Obj =
    'answer' in reply
      ? { answer: reply.answer.trim().slice(0, ESCALATION_ANSWER_MAX) }
      : { decision: reply.decision };
  if (token) body.token = token;
  return body;
}

/**
 * The data of an `agent_escalation` push (Android: the FCM data message,
 * all strings; iOS: the keys beside `aps`, category
 * `poolse_agent_escalation`). @poolse/native shows it with Approve /
 * Decline / Answer and replies natively, from the lock screen.
 */
export interface AgentEscalationPushData {
  cv: string;
  type: 'agent_escalation';
  escalation_id: string;
  call_id: string;
  conversation_id: string;
  conversation_name?: string;
  agent_id: string;
  agent_name: string;
  question: string;
  /** Comma-separated {@link EscalationDecision}s. */
  options: string;
  title: string;
  body: string;
  reply_url: string;
  /** Short-lived, this escalation only, usable once. */
  reply_token: string;
  expires_at: string;
  sent_at?: string;
  tenant_id?: string;
  workspace_name?: string;
  workspace_icon_url?: string;
}

function codeOf(err: unknown): string {
  const c = (err as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : '';
}

// ── the resources ────────────────────────────────────────────────────────

/** Listeners for {@link CallAgentsResource.subscribe}. */
export interface CallAgentsListeners {
  /** The agents in the call now (joined, left, or changed mode). */
  onAgents?: (agents: CallAgent[]) => void;
  /** An agent said something aloud (show as a caption, optionally). */
  onSaid?: (said: AgentSaid) => void;
}

/** `poolse.callAgents` — agents in a live call. */
export class CallAgentsResource {
  public readonly whisper: WhisperApi;
  public readonly briefs: BriefsApi;

  constructor(
    private readonly rest: RestClient,
    private readonly realtime: PoolseRealtime,
  ) {
    this.whisper = new WhisperApi(rest, realtime);
    this.briefs = new BriefsApi(rest);
  }

  /** `GET /v1/calls/:id/agents` — the live agents in the call. */
  async list(callId: string, signal?: AbortSignal): Promise<CallAgent[]> {
    const res = await this.rest.request<unknown>({
      method: 'GET',
      path: CALL_AGENTS_PATHS.agents(callId),
      ...(signal ? { signal } : {}),
    });
    return callAgentsFromWire(rows(res, 'agents'));
  }

  /**
   * `POST /v1/calls/:id/agents {agent_id, mode}` — bring an agent into
   * the live call (it starts the call's transcript). Again for an agent
   * already in changes its mode. Errors: 403 `not_in_call`,
   * `agents_not_allowed`, `transcription_disabled`, `speaking_disabled`;
   * 409 `agent_not_member`, `agent_paused`; 503 `voice_unavailable`,
   * `transcription_unavailable`.
   */
  async invite(
    callId: string,
    agentId: string,
    mode: Exclude<CallAgentMode, 'delegate'> = 'notetaker',
  ): Promise<CallAgent> {
    const res = await this.rest.request<unknown>({
      method: 'POST',
      path: CALL_AGENTS_PATHS.agents(callId),
      body: { agent_id: agentId, mode },
      maxRetries: 0,
    });
    const a = callAgentFromWire(unwrap(res, 'agent'));
    if (!a) throw new Error('invite agent: unexpected reply');
    return a;
  }

  /** `PATCH /v1/calls/:id/agents/:agent_id {mode}`. */
  async setMode(
    callId: string,
    agentId: string,
    mode: Exclude<CallAgentMode, 'delegate'>,
  ): Promise<CallAgent> {
    const res = await this.rest.request<unknown>({
      method: 'PATCH',
      path: CALL_AGENTS_PATHS.agent(callId, agentId),
      body: { mode },
    });
    const a = callAgentFromWire(unwrap(res, 'agent'));
    if (!a) throw new Error('agent mode: unexpected reply');
    return a;
  }

  /** `DELETE /v1/calls/:id/agents/:agent_id` — it leaves. */
  async remove(callId: string, agentId: string): Promise<void> {
    await this.rest.request<unknown>({
      method: 'DELETE',
      path: CALL_AGENTS_PATHS.agent(callId, agentId),
    });
  }

  /** `call:agents` and `agent:said` on the conversation's topic, for this call only. */
  subscribe(conversationId: string, callId: string, listeners: CallAgentsListeners): Unsubscribe {
    const conv = this.realtime.conversation(conversationId);
    const mine = (p: unknown) => str(obj(p)?.call_id) === callId;
    const offs: Unsubscribe[] = [];
    if (listeners.onAgents)
      offs.push(
        conv.on(CALL_AGENTS_EVENTS.agents, (p) => {
          if (mine(p)) listeners.onAgents!(callAgentsFromWire(obj(p)?.agents));
        }),
      );
    if (listeners.onSaid)
      offs.push(
        conv.on(CALL_AGENTS_EVENTS.said, (p) => {
          const o = obj(p);
          const text = str(o?.text);
          if (!mine(p) || !text) return;
          listeners.onSaid!({
            callId,
            sessionId: str(o?.session_id),
            agentId: str(o?.agent_id),
            text,
            language: str(o?.language),
          });
        }),
      );
    return () => offs.forEach((off) => off());
  }
}

/** `poolse.callAgents.whisper` — private hints for you in a call (AG15). */
export class WhisperApi {
  constructor(
    private readonly rest: RestClient,
    private readonly realtime: PoolseRealtime,
  ) {}

  /** `GET /v1/calls/:id/whisper` — on or off, and your hints so far (oldest first; 24 h after the call too). */
  async get(
    callId: string,
    signal?: AbortSignal,
  ): Promise<{ whisper: WhisperState; hints: WhisperHint[] }> {
    const res = await this.rest.request<unknown>({
      method: 'GET',
      path: CALL_AGENTS_PATHS.whisper(callId),
      ...(signal ? { signal } : {}),
    });
    const o = obj(res);
    return {
      whisper: whisperFromWire(res, callId) ?? offWhisper(callId),
      hints: arr(o?.hints ?? obj(o?.data)?.hints)
        .map((h) => whisperHintFromWire(h, callId))
        .filter((h): h is WhisperHint => !!h),
    };
  }

  /**
   * `POST /v1/calls/:id/whisper {on, agent_id?}` — opt in or out; only
   * you are affected. Errors: 403 `not_in_call`, `whisper_disabled`,
   * `captions_disabled`; 409 `no_agent`; 503 `transcription_unavailable`.
   */
  async set(callId: string, on: boolean, opts: { agentId?: string } = {}): Promise<WhisperState> {
    const res = await this.rest.request<unknown>({
      method: 'POST',
      path: CALL_AGENTS_PATHS.whisper(callId),
      body: { on, ...(opts.agentId ? { agent_id: opts.agentId } : {}) },
      maxRetries: 0,
    });
    return whisperFromWire(res, callId) ?? { ...offWhisper(callId), on };
  }

  /** `whisper:hint` and `whisper:changed` on your user topic, for this call. */
  subscribe(
    userId: string,
    callId: string,
    listeners: {
      onHint?: (hint: WhisperHint) => void;
      onChanged?: (whisper: WhisperState) => void;
    },
  ): Unsubscribe {
    const user = this.realtime.user(userId);
    const offs: Unsubscribe[] = [];
    if (listeners.onHint)
      offs.push(
        user.on(CALL_AGENTS_USER_EVENTS.whisperHint, (p) => {
          const h = whisperHintFromWire(p);
          if (h && h.callId === callId) listeners.onHint!(h);
        }),
      );
    if (listeners.onChanged)
      offs.push(
        user.on(CALL_AGENTS_USER_EVENTS.whisperChanged, (p) => {
          const w = whisperFromWire(p, callId);
          if (w && w.callId === callId) listeners.onChanged!(w);
        }),
      );
    return () => offs.forEach((off) => off());
  }
}

function offWhisper(callId: string): WhisperState {
  return { callId, on: false, agent: null, startedAt: null, hintCount: 0 };
}

/** `poolse.callAgents.briefs` — your briefs for agents attending for you (AG16). */
export class BriefsApi {
  constructor(private readonly rest: RestClient) {}

  /** `GET /v1/agent-briefs?scheduled_meeting_id=&call_id=` — yours. */
  async list(
    opts: { scheduledMeetingId?: string; callId?: string; signal?: AbortSignal } = {},
  ): Promise<AgentBrief[]> {
    const res = await this.rest.request<unknown>({
      method: 'GET',
      path: CALL_AGENTS_PATHS.briefs(),
      query: { scheduled_meeting_id: opts.scheduledMeetingId, call_id: opts.callId },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return rows(res, 'briefs')
      .map(briefFromWire)
      .filter((b): b is AgentBrief => !!b);
  }

  async get(id: string, signal?: AbortSignal): Promise<AgentBrief> {
    return this.one('GET', CALL_AGENTS_PATHS.brief(id), undefined, signal);
  }

  /**
   * `POST /v1/agent-briefs` — one per person per meeting/call (again
   * replaces it). Errors: 403 `not_member`, `delegates_not_allowed`;
   * 409 `no_agent`, `cancelled`; 410 `call_finished`.
   */
  create(input: AgentBriefInput): Promise<AgentBrief> {
    return this.one('POST', CALL_AGENTS_PATHS.briefs(), briefBody(input));
  }

  /** `PATCH /v1/agent-briefs/:id` (`text`, `rules`, `escalationTimeoutSeconds`). */
  update(
    id: string,
    patch: Pick<Partial<AgentBriefInput>, 'text' | 'rules' | 'escalationTimeoutSeconds'>,
  ): Promise<AgentBrief> {
    return this.one('PATCH', CALL_AGENTS_PATHS.brief(id), briefBody(patch));
  }

  /** `DELETE /v1/agent-briefs/:id` — while attending, the agent leaves. */
  async remove(id: string): Promise<void> {
    await this.rest.request<unknown>({ method: 'DELETE', path: CALL_AGENTS_PATHS.brief(id) });
  }

  private async one(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: Obj,
    signal?: AbortSignal,
  ): Promise<AgentBrief> {
    const res = await this.rest.request<unknown>({
      method,
      path,
      ...(body ? { body, maxRetries: 0 } : {}),
      ...(signal ? { signal } : {}),
    });
    const b = briefFromWire(res);
    if (!b) throw new Error(`${method} ${path}: unexpected reply`);
    return b;
  }
}

/**
 * `poolse.escalations` — your agent asking you during a meeting it
 * attends for you (AG16). A small live store like `poolse.approvals`:
 * `list`, your replies and `agent:escalation` on your user topic feed it.
 */
export class EscalationsResource {
  private readonly store = new PendingItems<AgentEscalation>();
  private readonly byId = this.store.byId;
  private readonly listeners = new Set<() => void>();
  private off: Unsubscribe | null = null;

  constructor(
    private readonly rest: RestClient,
    private readonly realtime: PoolseRealtime,
    private readonly me: MeResource,
  ) {}

  /** `GET /v1/me/agent-escalations?status=pending|all`. */
  async list(
    opts: { status?: 'pending' | 'all'; signal?: AbortSignal } = {},
  ): Promise<AgentEscalation[]> {
    const status = opts.status ?? 'pending';
    const since = this.store.begin();
    const res = await this.rest.request<unknown>({
      method: 'GET',
      path: CALL_AGENTS_PATHS.escalations(),
      query: { status },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const list = rows(res, 'escalations')
      .map(escalationFromWire)
      .filter((e): e is AgentEscalation => !!e);
    // A pending one the server no longer lists was answered elsewhere;
    // one that arrived while the request ran stays.
    this.store.merge(list, since, status === 'pending');
    this.notify();
    return list;
  }

  /**
   * `POST /v1/agent-escalations/:id/reply` — `{decision}` or `{answer}`
   * (1–1000 chars). The agent says it in the call. Errors (`ApiError`):
   * 404 not yours, 409 `not_pending`, 410 `expired`, 422 a bad answer.
   */
  async reply(id: string, reply: EscalationReply, signal?: AbortSignal): Promise<AgentEscalation> {
    if ('answer' in reply && !reply.answer.trim()) throw new Error('An answer needs text.');
    const res = await this.rest.request<unknown>({
      method: 'POST',
      path: CALL_AGENTS_PATHS.escalationReply(id),
      body: escalationReplyBody(reply),
      // An answer is not repeated behind the user's back.
      maxRetries: 0,
      ...(signal ? { signal } : {}),
    });
    const prev = this.byId.get(id);
    const next: AgentEscalation = escalationFromWire(res) ?? {
      ...(prev ?? emptyEscalation(id)),
      status:
        'answer' in reply ? 'answered' : reply.decision === 'approve' ? 'approved' : 'declined',
      answer: 'answer' in reply ? reply.answer.trim() : null,
      decidedAt: new Date().toISOString(),
    };
    this._apply(next);
    return next;
  }

  peek(id: string): AgentEscalation | undefined {
    return this.byId.get(id);
  }

  /** Pending ones, newest first. */
  pending(): AgentEscalation[] {
    return this.all().filter((e) => e.status === 'pending');
  }

  /** Every one seen (pending and answered), newest first. */
  all(): AgentEscalation[] {
    return [...this.byId.values()].sort((a, b) =>
      (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
    );
  }

  /** Changes; the first subscriber follows `agent:escalation` on your user topic. */
  subscribe(fn: () => void): Unsubscribe {
    this.listeners.add(fn);
    if (this.listeners.size === 1) this.bind();
    return () => {
      if (!this.listeners.delete(fn)) return;
      if (this.listeners.size === 0) {
        this.off?.();
        this.off = null;
      }
    };
  }

  /** Record one seen elsewhere (a push, a notification reply). An answered one is never undone by an older pending copy. */
  _apply(e: AgentEscalation): void {
    if (this.store.apply(e)) this.notify();
  }

  private bind(): void {
    let offUser: Unsubscribe | null = null;
    let boundId: string | null = null;
    const bindUser = (me: Me) => {
      if (me.id === boundId) return;
      offUser?.();
      boundId = me.id;
      const user = this.realtime.user(me.id);
      const offEvent = user.on(CALL_AGENTS_USER_EVENTS.escalation, (p) => {
        const e = escalationFromWire(obj(p)?.escalation);
        if (e) this._apply(e);
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
      offUser = () => {
        offEvent();
        offJoined();
      };
    };
    const known = this.me.peek();
    if (known) bindUser(known);
    else void this.me.show().catch(() => undefined);
    const offMe = this.me.onChange(bindUser);
    this.off = () => {
      offMe();
      offUser?.();
    };
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

function emptyEscalation(id: string): AgentEscalation {
  return {
    id,
    sessionId: null,
    callId: null,
    conversationId: null,
    agentId: null,
    userId: null,
    question: '',
    options: [...DECISIONS],
    status: 'pending',
    answer: null,
    decidedAt: null,
    expiresAt: null,
    createdAt: null,
  };
}
