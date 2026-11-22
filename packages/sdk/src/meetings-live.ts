// Live meeting features of a call (the server's docs/MEETINGS.md): the
// stage and raised hands (CL3), Q&A with votes, breakout rooms (CL5),
// the lobby (CL10), marked moments (CL14), the agenda (CA5), the
// whiteboard's doc token (CL12), meeting cards in chat (CA4 / CA11) and
// "move the call to this device" (CL11).
//
//   poolse.live.stage.get(callId)            poolse.live.stage.raiseHand(callId)
//   poolse.live.questions.ask(callId, text)  poolse.live.questions.vote(questionId)
//   poolse.live.breakouts.open(callId, …)    poolse.live.lobby.admit(callId, entryId)
//   poolse.live.moments.mark(callId)         poolse.live.agenda.done(callId, itemId)
//   poolse.live.subscribe(conversationId, callId, { onStage, onQuestion, … })
//
// Reactions travel peer to peer over the call's data channel (see
// `CallReactions`), not through here.
//
// ── Assumed contract ────────────────────────────────────────────────────
// Written before MEETINGS.md was final. Every path, field and event name
// lives in this file's WIRE section and the `*FromWire` mappers, so
// moving to the final contract changes nothing outside it. Unknown or
// missing fields map to null / empty rather than throwing.

import type { RestClient } from './rest-client.js';
import type { PoolseRealtime } from './realtime/realtime.js';
import type { Unsubscribe } from './realtime/types.js';
import type { LiveCall, LiveCallMember } from './resources/live-calls.js';
import type { RoomSession } from './resources/rooms.js';

// ── WIRE (adjust here when the server contract changes) ─────────────────

const call = (id: string) => `/v1/calls/${encodeURIComponent(id)}`;

/** Paths of the live meeting endpoints. */
export const MEETINGS_LIVE_PATHS = {
  stage: (callId: string) => `${call(callId)}/stage`,
  hand: (callId: string) => `${call(callId)}/hand`,
  role: (callId: string) => `${call(callId)}/stage/roles`,
  questions: (callId: string) => `${call(callId)}/questions`,
  question: (id: string) => `/v1/questions/${encodeURIComponent(id)}`,
  vote: (id: string) => `/v1/questions/${encodeURIComponent(id)}/vote`,
  breakouts: (callId: string) => `${call(callId)}/breakouts`,
  breakoutsClose: (callId: string) => `${call(callId)}/breakouts/close`,
  breakoutJoin: (roomId: string) => `/v1/breakouts/${encodeURIComponent(roomId)}/join`,
  breakoutReturn: (callId: string) => `${call(callId)}/breakouts/return`,
  lobby: (callId: string) => `${call(callId)}/lobby`,
  lobbyAdmit: (callId: string, entryId: string) =>
    `${call(callId)}/lobby/${encodeURIComponent(entryId)}/admit`,
  lobbyDeny: (callId: string, entryId: string) =>
    `${call(callId)}/lobby/${encodeURIComponent(entryId)}/deny`,
  lobbyAdmitAll: (callId: string) => `${call(callId)}/lobby/admit_all`,
  guestLobby: (entryId: string) => `/v1/guest/lobby/${encodeURIComponent(entryId)}`,
  moments: (callId: string) => `${call(callId)}/moments`,
  agenda: (callId: string) => `${call(callId)}/agenda`,
  agendaItem: (callId: string, itemId: string, action: 'start' | 'done' | 'reopen') =>
    `${call(callId)}/agenda/${encodeURIComponent(itemId)}/${action}`,
  whiteboard: (callId: string) => `${call(callId)}/whiteboard`,
  join: (callId: string) => `${call(callId)}/join`,
} as const;

/** Conversation-topic events carrying live meeting state. */
export const MEETINGS_LIVE_EVENTS = {
  stage: 'stage:updated',
  questionCreated: 'question:created',
  questionUpdated: 'question:updated',
  questionDeleted: 'question:deleted',
  breakouts: 'breakout:updated',
  breakoutsClosing: 'breakout:closing',
  lobbyUpdated: 'lobby:updated',
  moment: 'moment:created',
  agenda: 'agenda:updated',
  agendaOvertime: 'agenda:overtime',
  meetingUpdated: 'meeting:updated',
} as const;

/** The longest question the server takes (characters). */
export const QUESTION_MAX = 500;
/** The longest note on a marked moment. */
export const MOMENT_NOTE_MAX = 200;
/** How many breakout rooms one split may make. */
export const BREAKOUT_ROOMS_MAX = 50;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const unwrap = (res: unknown, key: string): unknown => {
  const o = obj(res);
  return o?.[key] ?? obj(o?.data)?.[key] ?? o?.data ?? res;
};

// ── people ───────────────────────────────────────────────────────────────

/** Someone as a meeting payload names them. */
export interface MeetingPerson {
  userId: string;
  externalId: string | null;
  displayName: string | null;
  /** Joined from a guest link (CL9): shown with a Guest mark. */
  guest: boolean;
}

function personFromWire(raw: unknown): MeetingPerson | null {
  const o = obj(raw);
  const userId = str(o?.user_id) ?? str(o?.id);
  if (!o || !userId) return null;
  return {
    userId,
    externalId: str(o.external_id),
    displayName: str(o.display_name) ?? str(o.name),
    guest: o.guest === true || o.is_guest === true,
  };
}

// ── stage (CL3) ──────────────────────────────────────────────────────────

/** A role in a call. `meeting`-mode calls have everyone as `speaker`. */
export type StageRole = 'moderator' | 'speaker' | 'audience';

export interface RaisedHand {
  userId: string;
  raisedAt: string | null;
}

/** Who may speak in a call, and who is asking to. */
export interface StageState {
  callId: string;
  /** `stage` — a town hall with an audience; `meeting` — everyone speaks. */
  mode: 'stage' | 'meeting';
  /** user id → role. Missing users are `audience` on a stage, `speaker` in a meeting. */
  roles: Record<string, StageRole>;
  /** Oldest first — the order a moderator brings people up. */
  hands: RaisedHand[];
  /** Your own role. */
  myRole: StageRole;
}

const ROLES: readonly StageRole[] = ['moderator', 'speaker', 'audience'];
const roleOf = (v: unknown): StageRole | null =>
  typeof v === 'string' && (ROLES as readonly string[]).includes(v) ? (v as StageRole) : null;

export function stageFromWire(raw: unknown): StageState | null {
  const o = obj(unwrap(raw, 'stage'));
  const callId = str(o?.call_id);
  if (!o || !callId) return null;
  const mode = o.mode === 'stage' ? 'stage' : 'meeting';
  const roles: Record<string, StageRole> = {};
  const rawRoles = obj(o.roles);
  if (rawRoles) {
    for (const [k, v] of Object.entries(rawRoles)) {
      const r = roleOf(v);
      if (r) roles[k] = r;
    }
  }
  for (const entry of arr(o.participants)) {
    const e = obj(entry);
    const id = str(e?.user_id);
    const r = roleOf(e?.role);
    if (id && r) roles[id] = r;
  }
  const hands = arr(o.hands)
    .map((h): RaisedHand | null => {
      if (typeof h === 'string') return { userId: h, raisedAt: null };
      const e = obj(h);
      const userId = str(e?.user_id);
      return userId ? { userId, raisedAt: str(e?.raised_at) } : null;
    })
    .filter((h): h is RaisedHand => !!h)
    .sort((a, b) => (a.raisedAt ?? '').localeCompare(b.raisedAt ?? ''));
  return {
    callId,
    mode,
    roles,
    hands,
    myRole: roleOf(o.my_role) ?? (mode === 'stage' ? 'audience' : 'speaker'),
  };
}

/** A user's role on a stage, with the mode's default for anyone unlisted. */
export function stageRoleOf(stage: StageState | null, userId: string): StageRole {
  if (!stage) return 'speaker';
  return stage.roles[userId] ?? (stage.mode === 'stage' ? 'audience' : 'speaker');
}

/**
 * A participant's role from their LiveKit token metadata
 * (`CallParticipant.metadata.role`), for when the stage state has not
 * loaded yet. null when the token says nothing.
 */
export function participantRoleOf(metadata: Record<string, unknown> | undefined): StageRole | null {
  return roleOf(metadata?.['role']);
}

// ── Q&A (CL3) ────────────────────────────────────────────────────────────

export type QuestionStatus = 'open' | 'answered' | 'dismissed';

export interface Question {
  id: string;
  callId: string;
  /** null when asked anonymously. */
  author: MeetingPerson | null;
  text: string;
  votes: number;
  /** Whether you voted. Events don't carry it: the store keeps your own votes. */
  votedByMe: boolean;
  status: QuestionStatus;
  createdAt: string | null;
  answeredAt: string | null;
}

export function questionFromWire(raw: unknown): Question | null {
  const o = obj(unwrap(raw, 'question'));
  const id = str(o?.id);
  const callId = str(o?.call_id);
  const text = str(o?.text) ?? str(o?.body);
  if (!o || !id || !callId || !text) return null;
  const status = o.status === 'answered' || o.status === 'dismissed' ? o.status : 'open';
  return {
    id,
    callId,
    author: o.anonymous === true ? null : personFromWire(o.author ?? o.asked_by),
    text: text.slice(0, QUESTION_MAX),
    votes: Math.max(0, int(o.votes) ?? int(o.vote_count) ?? 0),
    votedByMe: o.voted_by_me === true || o.voted === true,
    status,
    createdAt: str(o.created_at),
    answeredAt: str(o.answered_at),
  };
}

/** Open questions by votes (then oldest first), then answered ones, newest first. */
export function sortQuestions(list: readonly Question[]): Question[] {
  const open = list
    .filter((q) => q.status === 'open')
    .sort((a, b) => b.votes - a.votes || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  const answered = list
    .filter((q) => q.status === 'answered')
    .sort((a, b) => (b.answeredAt ?? '').localeCompare(a.answeredAt ?? ''));
  return [...open, ...answered];
}

// ── breakouts (CL5) ──────────────────────────────────────────────────────

export interface BreakoutRoom {
  id: string;
  name: string;
  /** The sub-room's own call, once someone is in it. */
  callId: string | null;
  /** Who is assigned. */
  userIds: string[];
  /** Who is in it right now. */
  participants: string[];
}

export interface BreakoutSession {
  id: string;
  /** The main call the breakouts came from. */
  callId: string;
  /** `closing`: everyone is being brought back (`returnAt`). */
  status: 'open' | 'closing' | 'closed';
  /** When the rooms end by themselves; null with no timer. */
  endsAt: string | null;
  /** While closing: when everyone is moved back. */
  returnAt: string | null;
  rooms: BreakoutRoom[];
  /** The room you are assigned to, or null (you stay in the main call). */
  myRoomId: string | null;
}

export function breakoutsFromWire(raw: unknown): BreakoutSession | null {
  const o = obj(unwrap(raw, 'breakouts'));
  const id = str(o?.id);
  const callId = str(o?.call_id);
  if (!o || !id || !callId) return null;
  const status = o.status === 'closing' || o.status === 'closed' ? o.status : 'open';
  const ids = (v: unknown) => arr(v).filter((x): x is string => typeof x === 'string');
  return {
    id,
    callId,
    status,
    endsAt: str(o.ends_at),
    returnAt: str(o.return_at),
    rooms: arr(o.rooms)
      .map((r): BreakoutRoom | null => {
        const e = obj(r);
        const roomId = str(e?.id);
        if (!e || !roomId) return null;
        return {
          id: roomId,
          name: str(e.name) ?? 'Room',
          callId: str(e.call_id),
          userIds: ids(e.user_ids),
          participants: ids(e.participants),
        };
      })
      .filter((r): r is BreakoutRoom => !!r),
    myRoomId: str(o.my_room_id),
  };
}

/** How to split: named rooms with their people, or a count to fill at random. */
export type BreakoutPlan =
  | { rooms: Array<{ name: string; userIds: string[] }>; durationMinutes?: number | null }
  | { count: number; durationMinutes?: number | null };

/**
 * Split people over `count` rooms round robin, in the order given — a
 * preview for the host before `breakouts.open`. Pure.
 */
export function planBreakouts(
  userIds: readonly string[],
  count: number,
  name: (index: number) => string = (i) => `Room ${i + 1}`,
): Array<{ name: string; userIds: string[] }> {
  const n = Math.max(1, Math.min(BREAKOUT_ROOMS_MAX, Math.floor(count)));
  const rooms = Array.from({ length: n }, (_, i) => ({ name: name(i), userIds: [] as string[] }));
  userIds.forEach((id, i) => rooms[i % n]!.userIds.push(id));
  return rooms;
}

// ── lobby (CL10) ─────────────────────────────────────────────────────────

export interface LobbyEntry {
  id: string;
  /** The name the guest typed (or the member's name). */
  name: string;
  guest: boolean;
  userId: string | null;
  requestedAt: string | null;
}

export interface LobbyState {
  callId: string;
  enabled: boolean;
  /** Oldest first. */
  waiting: LobbyEntry[];
}

function lobbyEntryFromWire(raw: unknown): LobbyEntry | null {
  const o = obj(raw);
  const id = str(o?.id);
  if (!o || !id) return null;
  return {
    id,
    name: (str(o.name) ?? str(o.display_name) ?? 'Guest').slice(0, 80),
    guest: o.guest !== false,
    userId: str(o.user_id),
    requestedAt: str(o.requested_at),
  };
}

export function lobbyFromWire(raw: unknown): LobbyState | null {
  const o = obj(unwrap(raw, 'lobby'));
  const callId = str(o?.call_id);
  if (!o || !callId) return null;
  return {
    callId,
    enabled: o.enabled !== false,
    waiting: arr(o.waiting)
      .map(lobbyEntryFromWire)
      .filter((e): e is LobbyEntry => !!e)
      .sort((a, b) => (a.requestedAt ?? '').localeCompare(b.requestedAt ?? '')),
  };
}

/** A guest's place in the lobby, from their own side. */
export type GuestLobbyStatus =
  | { status: 'waiting' }
  | { status: 'admitted'; session: RoomSession | null }
  | { status: 'denied' }
  | { status: 'ended' };

export function guestLobbyFromWire(raw: unknown): GuestLobbyStatus {
  const o = obj(unwrap(raw, 'lobby')) ?? {};
  switch (o.status) {
    case 'admitted': {
      const session = obj(o.session) as RoomSession | null;
      return { status: 'admitted', session: session && obj(session.livekit) ? session : null };
    }
    case 'denied':
      return { status: 'denied' };
    case 'ended':
    case 'finished':
      return { status: 'ended' };
    default:
      return { status: 'waiting' };
  }
}

/**
 * Wait in a call's lobby as a guest — no poolse session, only the
 * `lobbyToken` the guest join answered with. Polls
 * `GET /v1/guest/lobby/:entryId` every `intervalMs` (default 2 s) until
 * admitted, denied or the call ends, and resolves with that. `signal`
 * stops waiting (the guest closed the page).
 */
export async function waitInLobby(opts: {
  apiUrl: string;
  entryId: string;
  lobbyToken: string;
  intervalMs?: number;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  onStatus?: (status: GuestLobbyStatus) => void;
}): Promise<GuestLobbyStatus> {
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const url = opts.apiUrl.replace(/\/+$/, '') + MEETINGS_LIVE_PATHS.guestLobby(opts.entryId);
  const every = Math.max(500, opts.intervalMs ?? 2000);
  for (;;) {
    if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    let status: GuestLobbyStatus = { status: 'waiting' };
    try {
      const res = await doFetch(url, {
        headers: { authorization: `Bearer ${opts.lobbyToken}`, accept: 'application/json' },
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      if (res.status === 404 || res.status === 410) status = { status: 'ended' };
      else if (res.status === 403) status = { status: 'denied' };
      else if (res.ok) status = guestLobbyFromWire(await res.json());
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') throw err;
      // A blip on a guest's network: keep waiting.
    }
    opts.onStatus?.(status);
    if (status.status !== 'waiting') return status;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, every);
      opts.signal?.addEventListener('abort', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}

// ── moments (CL14) ───────────────────────────────────────────────────────

export interface MarkedMoment {
  id: string;
  callId: string;
  userId: string | null;
  createdAt: string | null;
  /** Since the call started, in ms (recording time is the summary's job). */
  offsetMs: number | null;
  note: string | null;
}

export function markedMomentFromWire(raw: unknown): MarkedMoment | null {
  const o = obj(unwrap(raw, 'moment'));
  const id = str(o?.id);
  const callId = str(o?.call_id);
  if (!o || !id || !callId) return null;
  return {
    id,
    callId,
    userId: str(o.user_id),
    createdAt: str(o.created_at),
    offsetMs: int(o.offset_ms),
    note: str(o.note),
  };
}

// ── agenda (CA5) ─────────────────────────────────────────────────────────

export interface AgendaItem {
  id: string;
  title: string;
  owner: MeetingPerson | null;
  /** Planned minutes; null when not timed. */
  minutes: number | null;
  status: 'pending' | 'active' | 'done';
  startedAt: string | null;
  doneAt: string | null;
}

export interface Agenda {
  callId: string;
  meetingId: string | null;
  items: AgendaItem[];
  /** The item being covered now. */
  currentItemId: string | null;
}

export function agendaFromWire(raw: unknown): Agenda | null {
  const o = obj(unwrap(raw, 'agenda'));
  const callId = str(o?.call_id);
  if (!o || !callId) return null;
  const items = arr(o.items)
    .map((x): AgendaItem | null => {
      const e = obj(x);
      const id = str(e?.id);
      const title = str(e?.title);
      if (!e || !id || !title) return null;
      const status = e.status === 'active' || e.status === 'done' ? e.status : 'pending';
      const minutes = int(e.minutes);
      return {
        id,
        title: title.slice(0, 200),
        owner: personFromWire(e.owner),
        minutes: minutes !== null && minutes > 0 ? minutes : null,
        status,
        startedAt: str(e.started_at),
        doneAt: str(e.done_at),
      };
    })
    .filter((x): x is AgendaItem => !!x);
  return {
    callId,
    meetingId: str(o.meeting_id),
    items,
    currentItemId: str(o.current_item_id) ?? items.find((i) => i.status === 'active')?.id ?? null,
  };
}

/**
 * How far an active item is over its minutes, in ms (0 when on time or
 * untimed) — for the nudge "Budget review is 3 min over".
 */
export function agendaOverrunMs(item: AgendaItem, now: number = Date.now()): number {
  if (item.status !== 'active' || !item.minutes || !item.startedAt) return 0;
  const started = Date.parse(item.startedAt);
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, now - started - item.minutes * 60_000);
}

// ── whiteboard (CL12) ────────────────────────────────────────────────────

/** A doc-relay token for the call's whiteboard (open it with `realtime.doc`). */
export interface WhiteboardAccess {
  docId: string;
  docToken: string;
  expiresAt: string | null;
  rights: 'read' | 'write';
}

export function whiteboardAccessFromWire(raw: unknown): WhiteboardAccess | null {
  const o = obj(unwrap(raw, 'whiteboard'));
  const docId = str(o?.doc_id);
  const docToken = str(o?.doc_token) ?? str(o?.token);
  if (!o || !docId || !docToken) return null;
  return {
    docId,
    docToken,
    expiresAt: str(o.expires_at),
    rights: o.rights === 'read' ? 'read' : 'write',
  };
}

// ── meeting cards (CA4, CA11) ────────────────────────────────────────────

export type RsvpResponse = 'accepted' | 'declined' | 'tentative';

/** A meeting invite as a chat card shows it. */
export interface MeetingCard {
  meetingId: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  media: 'audio' | 'video';
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  /** The room the meeting happens in (join it there). */
  roomConversationId: string | null;
  /** The live call, once started. */
  callId: string | null;
  organizer: MeetingPerson | null;
  /** Who answered what, by user id. */
  rsvps: Record<RsvpResponse, string[]>;
  /** Your own answer, when known. */
  myRsvp: RsvpResponse | null;
  /** Invited people (for "4 of 6 accepted"). */
  inviteeCount: number | null;
}

/**
 * A meeting card from a message (`metadata.meeting`, or a body of
 * `{"type":"meeting_card", …}`), else null. The card stays live through
 * `message:updated` — the server rewrites it as RSVPs come in.
 */
export function meetingCardOf(
  message: { body?: unknown; metadata?: unknown; type?: unknown } | null | undefined,
): MeetingCard | null {
  if (!message) return null;
  const meta = obj(message.metadata);
  let raw: unknown = meta?.meeting ?? (meta?.kind === 'meeting' ? meta : null);
  if (!raw && typeof message.body === 'string' && message.body.startsWith('{')) {
    try {
      const parsed = obj(JSON.parse(message.body));
      if (parsed?.type === 'meeting_card') raw = parsed.meeting ?? parsed;
    } catch {
      // Ordinary text.
    }
  }
  return meetingCardFromWire(raw);
}

export function meetingCardFromWire(raw: unknown): MeetingCard | null {
  const o = obj(unwrap(raw, 'meeting'));
  const meetingId = str(o?.meeting_id) ?? str(o?.id);
  if (!o || !meetingId) return null;
  const statuses = ['scheduled', 'live', 'ended', 'cancelled'] as const;
  const status = (statuses as readonly unknown[]).includes(o.status)
    ? (o.status as MeetingCard['status'])
    : 'scheduled';
  const r = obj(o.rsvps) ?? {};
  const ids = (v: unknown) => arr(v).filter((x): x is string => typeof x === 'string');
  const my = o.my_rsvp;
  return {
    meetingId,
    title: (str(o.title) ?? 'Meeting').slice(0, 200),
    startsAt: str(o.starts_at),
    endsAt: str(o.ends_at),
    media: o.media === 'video' ? 'video' : 'audio',
    status,
    roomConversationId: str(o.room_conversation_id) ?? str(o.conversation_id),
    callId: str(o.call_id),
    organizer: personFromWire(o.organizer),
    rsvps: { accepted: ids(r.accepted), declined: ids(r.declined), tentative: ids(r.tentative) },
    myRsvp: my === 'accepted' || my === 'declined' || my === 'tentative' ? my : null,
    inviteeCount: int(o.invitee_count),
  };
}

/** Your answer on a card: `myRsvp`, else found in the lists. */
export function rsvpOf(card: MeetingCard, userId: string | null | undefined): RsvpResponse | null {
  if (card.myRsvp) return card.myRsvp;
  if (!userId) return null;
  for (const k of ['accepted', 'tentative', 'declined'] as const) {
    if (card.rsvps[k].includes(userId)) return k;
  }
  return null;
}

/**
 * Whether a card's Join button is live: the meeting is live, or starts
 * within `earlyMs` (default 10 min) and has not ended.
 */
export function meetingJoinable(
  card: MeetingCard,
  now: number = Date.now(),
  earlyMs = 10 * 60_000,
): boolean {
  if (card.status === 'live') return true;
  if (card.status !== 'scheduled' || !card.startsAt) return false;
  const start = Date.parse(card.startsAt);
  const end = card.endsAt ? Date.parse(card.endsAt) : start + 60 * 60_000;
  return Number.isFinite(start) && now >= start - earlyMs && now < end;
}

// ── handoff (CL11) ───────────────────────────────────────────────────────

/**
 * You are in this call on another device and not here: offer "Move the
 * call here". `connectedHere` — this device holds the call's media.
 */
export function inCallElsewhere(
  live: Pick<LiveCall, 'participants' | 'state'> | null | undefined,
  myUserId: string | null | undefined,
  connectedHere: boolean,
): boolean {
  if (!live || live.state !== 'live' || !myUserId || connectedHere) return false;
  return live.participants.some((p: LiveCallMember) => p.user_id === myUserId);
}

// ── the resource ─────────────────────────────────────────────────────────

/** Listeners for {@link LiveMeetingsResource.subscribe}. */
export interface LiveMeetingsListeners {
  onStage?: (stage: StageState) => void;
  onQuestion?: (question: Question) => void;
  onQuestionDeleted?: (questionId: string) => void;
  onBreakouts?: (session: BreakoutSession) => void;
  onLobby?: (lobby: LobbyState) => void;
  onMoment?: (moment: MarkedMoment) => void;
  onAgenda?: (agenda: Agenda) => void;
  /** An agenda item ran over its minutes. */
  onAgendaOvertime?: (evt: { itemId: string; overByMs: number }) => void;
  onMeetingCard?: (card: MeetingCard) => void;
}

/** `poolse.live` — the live meeting features of a call. */
export class LiveMeetingsResource {
  public readonly stage: StageApi;
  public readonly questions: QuestionsApi;
  public readonly breakouts: BreakoutsApi;
  public readonly lobby: LobbyApi;
  public readonly moments: MomentsApi;
  public readonly agenda: AgendaApi;

  constructor(
    private readonly rest: RestClient,
    private readonly realtime: PoolseRealtime,
  ) {
    this.stage = new StageApi(rest);
    this.questions = new QuestionsApi(rest);
    this.breakouts = new BreakoutsApi(rest);
    this.lobby = new LobbyApi(rest);
    this.moments = new MomentsApi(rest);
    this.agenda = new AgendaApi(rest);
  }

  /**
   * `POST /v1/calls/:id/whiteboard` — a doc-relay token for the call's
   * board (created on first use, saved with the meeting). `forbidden`
   * when not in the call.
   */
  async whiteboard(callId: string, signal?: AbortSignal): Promise<WhiteboardAccess> {
    const res = await this.rest.request<unknown>({
      method: 'POST',
      path: MEETINGS_LIVE_PATHS.whiteboard(callId),
      ...(signal ? { signal } : {}),
    });
    const access = whiteboardAccessFromWire(res);
    if (!access) throw new Error('whiteboard: unexpected reply');
    return access;
  }

  /**
   * Move the call to this device (CL11): `POST /v1/calls/:id/join`. The
   * server keeps one media presence per user, so joining here
   * supersedes the other device — it sees `onDisconnected('moved')` (web)
   * or `reason: 'moved'` (native) and closes its call screen. Connect the
   * returned session's LiveKit credentials (`CallRoom` with a
   * `tokenProvider` that returns them).
   */
  moveHere(callId: string, signal?: AbortSignal): Promise<RoomSession> {
    return this.rest.request<RoomSession>({
      method: 'POST',
      path: MEETINGS_LIVE_PATHS.join(callId),
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * Live meeting events of one call, on its conversation's topic. Only
   * events for `callId` reach the listeners (breakout events also for
   * the session's main call).
   */
  subscribe(conversationId: string, callId: string, listeners: LiveMeetingsListeners): Unsubscribe {
    const conv = this.realtime.conversation(conversationId);
    const E = MEETINGS_LIVE_EVENTS;
    const mine = (p: unknown) => str(obj(p)?.call_id) === callId;
    const offs: Unsubscribe[] = [];
    const on = (event: string, fn: (payload: unknown) => void) => offs.push(conv.on(event, fn));

    if (listeners.onStage)
      on(E.stage, (p) => {
        const s = mine(p) ? stageFromWire(p) : null;
        if (s) listeners.onStage!(s);
      });
    if (listeners.onQuestion) {
      const fn = (p: unknown) => {
        const q = questionFromWire(p);
        if (q && q.callId === callId) listeners.onQuestion!(q);
      };
      on(E.questionCreated, fn);
      on(E.questionUpdated, fn);
    }
    if (listeners.onQuestionDeleted)
      on(E.questionDeleted, (p) => {
        const id = str(obj(p)?.question_id) ?? str(obj(obj(p)?.question)?.id);
        if (id && mine(p)) listeners.onQuestionDeleted!(id);
      });
    if (listeners.onBreakouts) {
      const fn = (p: unknown) => {
        const b = breakoutsFromWire(p);
        if (b && b.callId === callId) listeners.onBreakouts!(b);
      };
      on(E.breakouts, fn);
      on(E.breakoutsClosing, fn);
    }
    if (listeners.onLobby)
      on(E.lobbyUpdated, (p) => {
        const l = lobbyFromWire(p);
        if (l && l.callId === callId) listeners.onLobby!(l);
      });
    if (listeners.onMoment)
      on(E.moment, (p) => {
        const m = markedMomentFromWire(p);
        if (m && m.callId === callId) listeners.onMoment!(m);
      });
    if (listeners.onAgenda)
      on(E.agenda, (p) => {
        const a = agendaFromWire(p);
        if (a && a.callId === callId) listeners.onAgenda!(a);
      });
    if (listeners.onAgendaOvertime)
      on(E.agendaOvertime, (p) => {
        const o = obj(p);
        const itemId = str(o?.item_id);
        if (itemId && mine(p))
          listeners.onAgendaOvertime!({ itemId, overByMs: int(o?.over_by_ms) ?? 0 });
      });
    if (listeners.onMeetingCard)
      on(E.meetingUpdated, (p) => {
        const c = meetingCardFromWire(p);
        if (c) listeners.onMeetingCard!(c);
      });
    return () => offs.forEach((off) => off());
  }
}

abstract class Api {
  constructor(protected readonly rest: RestClient) {}

  protected async send<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    map: (res: unknown) => T | null,
    body?: object,
    signal?: AbortSignal,
  ): Promise<T> {
    const res = await this.rest.request<unknown>({
      method,
      path,
      ...(body ? { body } : {}),
      ...(signal ? { signal } : {}),
    });
    const out = map(res);
    if (out === null) throw new Error(`${method} ${path}: unexpected reply`);
    return out;
  }
}

/** Roles and raised hands (CL3). */
export class StageApi extends Api {
  /** `GET /v1/calls/:id/stage`. */
  get(callId: string, signal?: AbortSignal): Promise<StageState> {
    return this.send('GET', MEETINGS_LIVE_PATHS.stage(callId), stageFromWire, undefined, signal);
  }

  /** `POST /v1/calls/:id/hand {raised: true}` — raise your hand. */
  raiseHand(callId: string): Promise<StageState> {
    return this.send('POST', MEETINGS_LIVE_PATHS.hand(callId), stageFromWire, { raised: true });
  }

  /** Lower your hand — or, as a moderator, someone else's (`userId`). */
  lowerHand(callId: string, userId?: string): Promise<StageState> {
    return this.send('POST', MEETINGS_LIVE_PATHS.hand(callId), stageFromWire, {
      raised: false,
      ...(userId ? { user_id: userId } : {}),
    });
  }

  /**
   * `POST /v1/calls/:id/stage/roles {user_id, role}` — a moderator brings
   * someone up (`speaker`), sends them back (`audience`) or hands over
   * (`moderator`). Bringing someone up lowers their hand. `forbidden`
   * unless you moderate.
   */
  setRole(callId: string, userId: string, role: StageRole): Promise<StageState> {
    return this.send('POST', MEETINGS_LIVE_PATHS.role(callId), stageFromWire, {
      user_id: userId,
      role,
    });
  }
}

/** Q&A with votes (CL3). */
export class QuestionsApi extends Api {
  /** `GET /v1/calls/:id/questions`. */
  list(callId: string, signal?: AbortSignal): Promise<Question[]> {
    return this.send(
      'GET',
      MEETINGS_LIVE_PATHS.questions(callId),
      (res) =>
        arr(unwrap(res, 'questions'))
          .map(questionFromWire)
          .filter((q): q is Question => !!q),
      undefined,
      signal,
    );
  }

  /** `POST /v1/calls/:id/questions {text, anonymous}` — up to {@link QUESTION_MAX} characters. */
  ask(callId: string, text: string, opts: { anonymous?: boolean } = {}): Promise<Question> {
    return this.send('POST', MEETINGS_LIVE_PATHS.questions(callId), questionFromWire, {
      text: text.trim().slice(0, QUESTION_MAX),
      anonymous: opts.anonymous ?? false,
    });
  }

  /** `POST /v1/questions/:id/vote` — one vote per person; again is a no-op. */
  vote(questionId: string): Promise<Question> {
    return this.send('POST', MEETINGS_LIVE_PATHS.vote(questionId), questionFromWire);
  }

  /** `DELETE /v1/questions/:id/vote`. */
  unvote(questionId: string): Promise<Question> {
    return this.send('DELETE', MEETINGS_LIVE_PATHS.vote(questionId), questionFromWire);
  }

  /** `PATCH /v1/questions/:id {status}` — a moderator marks it answered or dismisses it. */
  setStatus(questionId: string, status: QuestionStatus): Promise<Question> {
    return this.send('PATCH', MEETINGS_LIVE_PATHS.question(questionId), questionFromWire, {
      status,
    });
  }
}

/** Breakout rooms (CL5). */
export class BreakoutsApi extends Api {
  /** `GET /v1/calls/:id/breakouts` — null when none are open. */
  async get(callId: string, signal?: AbortSignal): Promise<BreakoutSession | null> {
    const res = await this.rest.request<unknown>({
      method: 'GET',
      path: MEETINGS_LIVE_PATHS.breakouts(callId),
      ...(signal ? { signal } : {}),
    });
    return breakoutsFromWire(res);
  }

  /**
   * `POST /v1/calls/:id/breakouts` — the host splits the call: named
   * rooms with people, or `count` rooms filled by the server, with an
   * optional timer. Everyone assigned gets `breakout:updated` and joins
   * their room (`join`).
   */
  open(callId: string, plan: BreakoutPlan): Promise<BreakoutSession> {
    const body =
      'rooms' in plan
        ? {
            rooms: plan.rooms
              .slice(0, BREAKOUT_ROOMS_MAX)
              .map((r) => ({ name: r.name.slice(0, 80), user_ids: r.userIds })),
          }
        : { count: Math.max(1, Math.min(BREAKOUT_ROOMS_MAX, Math.floor(plan.count))) };
    return this.send('POST', MEETINGS_LIVE_PATHS.breakouts(callId), breakoutsFromWire, {
      ...body,
      ...(plan.durationMinutes ? { duration_minutes: plan.durationMinutes } : {}),
    });
  }

  /**
   * `POST /v1/calls/:id/breakouts/close {after_seconds}` — bring everyone
   * back, after a short warning (default 60 s; `0` at once).
   */
  close(callId: string, afterSeconds = 60): Promise<BreakoutSession> {
    return this.send('POST', MEETINGS_LIVE_PATHS.breakoutsClose(callId), breakoutsFromWire, {
      after_seconds: Math.max(0, Math.floor(afterSeconds)),
    });
  }

  /** `POST /v1/breakouts/:roomId/join` — join your breakout room (the session's credentials). */
  join(roomId: string): Promise<RoomSession> {
    return this.rest.request<RoomSession>({
      method: 'POST',
      path: MEETINGS_LIVE_PATHS.breakoutJoin(roomId),
    });
  }

  /** `POST /v1/calls/:id/breakouts/return` — back to the main call (its session). */
  returnToMain(callId: string): Promise<RoomSession> {
    return this.rest.request<RoomSession>({
      method: 'POST',
      path: MEETINGS_LIVE_PATHS.breakoutReturn(callId),
    });
  }
}

/** The lobby, from the host's side (CL10). Guests use {@link waitInLobby}. */
export class LobbyApi extends Api {
  /** `GET /v1/calls/:id/lobby`. */
  get(callId: string, signal?: AbortSignal): Promise<LobbyState> {
    return this.send('GET', MEETINGS_LIVE_PATHS.lobby(callId), lobbyFromWire, undefined, signal);
  }

  /** `POST /v1/calls/:id/lobby/:entryId/admit`. */
  admit(callId: string, entryId: string): Promise<LobbyState> {
    return this.send('POST', MEETINGS_LIVE_PATHS.lobbyAdmit(callId, entryId), lobbyFromWire);
  }

  /** `POST /v1/calls/:id/lobby/:entryId/deny`. */
  deny(callId: string, entryId: string): Promise<LobbyState> {
    return this.send('POST', MEETINGS_LIVE_PATHS.lobbyDeny(callId, entryId), lobbyFromWire);
  }

  /** `POST /v1/calls/:id/lobby/admit_all`. */
  admitAll(callId: string): Promise<LobbyState> {
    return this.send('POST', MEETINGS_LIVE_PATHS.lobbyAdmitAll(callId), lobbyFromWire);
  }
}

/** Mark a moment (CL14). */
export class MomentsApi extends Api {
  /**
   * `POST /v1/calls/:id/moments {note?}` — "this was important", now. The
   * summary and the recording highlight it. `rate_limited` past a few
   * marks a minute.
   */
  mark(callId: string, opts: { note?: string } = {}): Promise<MarkedMoment> {
    const note = opts.note?.trim().slice(0, MOMENT_NOTE_MAX);
    return this.send(
      'POST',
      MEETINGS_LIVE_PATHS.moments(callId),
      markedMomentFromWire,
      note ? { note } : {},
    );
  }

  /** `GET /v1/calls/:id/moments`. */
  list(callId: string, signal?: AbortSignal): Promise<MarkedMoment[]> {
    return this.send(
      'GET',
      MEETINGS_LIVE_PATHS.moments(callId),
      (res) =>
        arr(unwrap(res, 'moments'))
          .map(markedMomentFromWire)
          .filter((m): m is MarkedMoment => !!m),
      undefined,
      signal,
    );
  }
}

/** The agenda on the call (CA5). */
export class AgendaApi extends Api {
  /** `GET /v1/calls/:id/agenda` — null when the call has none. */
  async get(callId: string, signal?: AbortSignal): Promise<Agenda | null> {
    try {
      const res = await this.rest.request<unknown>({
        method: 'GET',
        path: MEETINGS_LIVE_PATHS.agenda(callId),
        ...(signal ? { signal } : {}),
      });
      return agendaFromWire(res);
    } catch (err) {
      if ((err as { status?: number })?.status === 404) return null;
      throw err;
    }
  }

  /** Start covering an item (the previous active one is left as it was). */
  start(callId: string, itemId: string): Promise<Agenda> {
    return this.send(
      'POST',
      MEETINGS_LIVE_PATHS.agendaItem(callId, itemId, 'start'),
      agendaFromWire,
    );
  }

  /** Check an item off; the next pending one becomes active. */
  done(callId: string, itemId: string): Promise<Agenda> {
    return this.send(
      'POST',
      MEETINGS_LIVE_PATHS.agendaItem(callId, itemId, 'done'),
      agendaFromWire,
    );
  }

  reopen(callId: string, itemId: string): Promise<Agenda> {
    return this.send(
      'POST',
      MEETINGS_LIVE_PATHS.agendaItem(callId, itemId, 'reopen'),
      agendaFromWire,
    );
  }
}
