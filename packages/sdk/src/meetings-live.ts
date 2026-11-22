// Live meeting features of a call (the server's docs/MEETINGS.md): the
// stage and raised hands (CL3), Q&A with votes, breakout rooms (CL5),
// in-call chat and the reaction relay (CL6), phones (CL8), guest links
// and the lobby (CL10), the whiteboard's doc token (CL12), captions
// (CL13), marked moments (CL14), call quality (CL15), rooms and who's in
// (CL2), the agenda (CA5), scheduled meetings and their cards (CA4 /
// CA11) and "move the call to this device" (CL11).
//
//   poolse.live.stage.get(callId)            poolse.live.stage.raiseHand(callId)
//   poolse.live.questions.ask(callId, text)  poolse.live.questions.vote(questionId)
//   poolse.live.breakouts.open(callId, …)    poolse.live.lobby.admit(target, guestId)
//   poolse.live.moments.mark(callId)         poolse.live.agenda.done(callId, itemId)
//   poolse.live.meetings.rsvp(id, 'accepted') poolse.live.captions.set(callId, true)
//   poolse.live.subscribe(conversationId, callId, { onStage, onQuestion, … })
//   poolse.live.subscribeUser(userId, { onRoomParticipants, onMeetingStarting })
//
// The browser guest (no account) has its own client: `GuestClient`.
//
// Identities: a member is in a call as their poolse user id, a browser
// guest as `guest_<id>`, a phone as `sip_…`. Every `userId` below can be
// any of these — name them with `meetingNameOf`, never by the id.
//
// Every path, field and event name lives in this file's WIRE section and
// the `*FromWire` mappers. Unknown or missing fields map to null / empty
// rather than throwing.

import type { RestClient } from './rest-client.js';
import type { Message } from './types.js';
import type { PoolseRealtime } from './realtime/realtime.js';
import type { Unsubscribe } from './realtime/types.js';
import type { LiveCall, LiveCallMember } from './resources/live-calls.js';
import type { RoomSession } from './resources/rooms.js';

// ── WIRE (adjust here when the server contract changes) ─────────────────

const call = (id: string) => `/v1/calls/${encodeURIComponent(id)}`;

const conv = (id: string) => `/v1/conversations/${encodeURIComponent(id)}`;
const enc = encodeURIComponent;

/** Paths of the live meeting endpoints (MEETINGS.md). */
export const MEETINGS_LIVE_PATHS = {
  meeting: (callId: string) => `${call(callId)}/meeting`,
  stage: (callId: string) => `${call(callId)}/stage`,
  hand: (callId: string) => `${call(callId)}/hand`,
  role: (callId: string) => `${call(callId)}/stage/roles`,
  questions: (callId: string) => `${call(callId)}/questions`,
  question: (id: string) => `/v1/questions/${enc(id)}`,
  vote: (id: string) => `/v1/questions/${enc(id)}/vote`,
  breakouts: (callId: string) => `${call(callId)}/breakouts`,
  breakoutsClose: (callId: string) => `${call(callId)}/breakouts/close`,
  breakoutJoin: (roomId: string) => `/v1/breakouts/${enc(roomId)}/join`,
  breakoutReturn: (callId: string) => `${call(callId)}/breakouts/return`,
  callLobby: (callId: string) => `${call(callId)}/lobby`,
  conversationLobby: (conversationId: string) => `${conv(conversationId)}/lobby`,
  callLobbyEntry: (callId: string, guestId: string, action: 'admit' | 'deny') =>
    `${call(callId)}/lobby/${enc(guestId)}/${action}`,
  conversationLobbyEntry: (conversationId: string, guestId: string, action: 'admit' | 'deny') =>
    `${conv(conversationId)}/lobby/${enc(guestId)}/${action}`,
  lobbyAdmitAll: (callId: string) => `${call(callId)}/lobby/admit_all`,
  guestLinks: (conversationId: string) => `${conv(conversationId)}/guest-links`,
  guestLink: (id: string) => `/v1/guest-links/${enc(id)}`,
  moments: (callId: string) => `${call(callId)}/moments`,
  moment: (callId: string, momentId: string) => `${call(callId)}/moments/${enc(momentId)}`,
  agenda: (callId: string) => `${call(callId)}/agenda`,
  agendaItem: (callId: string, itemId: string, action: 'start' | 'done' | 'reopen') =>
    `${call(callId)}/agenda/${enc(itemId)}/${action}`,
  whiteboard: (callId: string) => `${call(callId)}/whiteboard`,
  captions: (callId: string) => `${call(callId)}/captions`,
  quality: (callId: string) => `${call(callId)}/quality`,
  messages: (callId: string) => `${call(callId)}/messages`,
  reactions: (callId: string) => `${call(callId)}/reactions`,
  phones: (callId: string) => `${call(callId)}/phones`,
  phone: (callId: string, identity: string) => `${call(callId)}/phones/${enc(identity)}`,
  dialIns: (conversationId: string) => `${conv(conversationId)}/dial-ins`,
  dialIn: (id: string) => `/v1/dial-ins/${enc(id)}`,
  myRooms: () => '/v1/me/rooms',
  conversationMeetings: (conversationId: string) => `${conv(conversationId)}/meetings`,
  scheduledMeeting: (id: string) => `/v1/meetings/${enc(id)}`,
  rsvp: (id: string) => `/v1/meetings/${enc(id)}/rsvp`,
  join: (callId: string) => `${call(callId)}/join`,
  guest: {
    link: (token: string) => `/v1/guest/links/${enc(token)}`,
    join: () => '/v1/guest/join',
    lobby: (entryId: string) => `/v1/guest/lobby/${enc(entryId)}`,
    session: () => '/v1/guest/session',
    leave: () => '/v1/guest/leave',
    hand: () => '/v1/guest/hand',
    reactions: () => '/v1/guest/reactions',
    questions: () => '/v1/guest/questions',
    vote: (id: string) => `/v1/guest/questions/${enc(id)}/vote`,
    quality: () => '/v1/guest/quality',
  },
} as const;

/** Conversation-topic events carrying live meeting state (all with `call_id`, MEETINGS.md §13). */
export const MEETINGS_LIVE_EVENTS = {
  stage: 'stage:updated',
  questionCreated: 'question:created',
  questionUpdated: 'question:updated',
  questionDeleted: 'question:deleted',
  breakouts: 'breakout:updated',
  breakoutsClosing: 'breakout:closing',
  lobbyUpdated: 'lobby:updated',
  moment: 'moment:created',
  momentRemoved: 'moment:removed',
  agenda: 'agenda:updated',
  agendaOvertime: 'agenda:overtime',
  meetingOvertime: 'meeting:overtime',
  meetingUpdated: 'meeting:updated',
  meetingRsvp: 'meeting:rsvp',
  reaction: 'call:reaction',
  quality: 'call:quality',
  attendees: 'call:attendees',
  captions: 'captions:changed',
  whiteboardOpened: 'whiteboard:opened',
} as const;

/** User-topic events (the channel an app is always on). */
export const MEETINGS_USER_EVENTS = {
  roomParticipants: 'room:participants',
  meetingStarting: 'meeting:starting',
  meetingBrief: 'meeting:brief',
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
// Only an object or list under `key` is a wrapper: a flat event can carry a
// plain field of the same name (`call:quality` has `quality: "good"`).
const unwrap = (res: unknown, key: string): unknown => {
  const o = obj(res);
  const wrapped = (v: unknown) => (v !== null && typeof v === 'object' ? v : undefined);
  return wrapped(o?.[key]) ?? wrapped(obj(o?.data)?.[key]) ?? o?.data ?? res;
};

// ── people ───────────────────────────────────────────────────────────────

/** Who an identity in a call is: a member, a browser guest, or a phone. */
export type MeetingIdentityKind = 'member' | 'guest' | 'phone';

export function identityKindOf(identity: string): MeetingIdentityKind {
  if (identity.startsWith('guest_')) return 'guest';
  if (identity.startsWith('sip_')) return 'phone';
  return 'member';
}

/**
 * "Phone ···1234" for a dialled-in `sip_<number>` (the number is never
 * shown), "Phone" for a dialled-out `sip_out_…`.
 */
export function phoneLabel(identity: string): string {
  if (identity.startsWith('sip_out_')) return 'Phone';
  const digits = identity.slice(4).replace(/\D/g, '');
  return digits.length >= 4 ? `Phone ···${digits.slice(-4)}` : 'Phone';
}

/**
 * The name to show for a call identity: the payload's name when there is
 * one (a guest's typed name), "Phone ···1234" for a phone, else null —
 * resolve members through your user directory. Never the id itself.
 */
export function meetingNameOf(identity: string, name?: string | null): string | null {
  const kind = identityKindOf(identity);
  if (kind === 'phone') return name && !/^\+?\d[\d\s-]*$/.test(name) ? name : phoneLabel(identity);
  return name || (kind === 'guest' ? 'Guest' : null);
}

/** Someone as a meeting payload names them. */
export interface MeetingPerson {
  /** A poolse user id, `guest_…` or `sip_…`. */
  userId: string;
  externalId: string | null;
  displayName: string | null;
  kind: MeetingIdentityKind;
  /** Joined from a guest link (CL9): shown with a Guest mark. */
  guest: boolean;
}

function personFromWire(raw: unknown): MeetingPerson | null {
  const o = obj(raw);
  const userId = str(o?.user_id) ?? str(o?.identity) ?? str(o?.id);
  if (!o || !userId) return null;
  const kind = identityKindOf(userId);
  return {
    userId,
    externalId: str(o.external_id),
    displayName: meetingNameOf(userId, str(o.display_name) ?? str(o.name)),
    kind,
    guest: o.guest === true || kind === 'guest',
  };
}

// ── stage (CL3) ──────────────────────────────────────────────────────────

/** A role in a call. `meeting`-mode calls have everyone as `speaker`. */
export type StageRole = 'moderator' | 'speaker' | 'audience';

export interface RaisedHand {
  /** A user id, `guest_…` or `sip_…`. */
  userId: string;
  /** The name the server sent (guests and phones included), when it sent one. */
  name: string | null;
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
  /**
   * Your own role: the reply's `my_role`, else (events carry none) your
   * entry in `roles`, else the mode's default.
   */
  myRole: StageRole;
}

const ROLES: readonly StageRole[] = ['moderator', 'speaker', 'audience'];
const roleOf = (v: unknown): StageRole | null =>
  typeof v === 'string' && (ROLES as readonly string[]).includes(v) ? (v as StageRole) : null;

export function stageFromWire(raw: unknown, selfUserId?: string | null): StageState | null {
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
      if (typeof h === 'string') return { userId: h, name: meetingNameOf(h), raisedAt: null };
      const e = obj(h);
      const userId = str(e?.user_id) ?? str(e?.identity);
      return userId
        ? { userId, name: meetingNameOf(userId, str(e?.name)), raisedAt: str(e?.raised_at) }
        : null;
    })
    .filter((h): h is RaisedHand => !!h)
    .sort((a, b) => (a.raisedAt ?? '').localeCompare(b.raisedAt ?? ''));
  return {
    callId,
    mode,
    roles,
    hands,
    myRole:
      roleOf(o.my_role) ??
      (selfUserId ? roles[selfUserId] : undefined) ??
      (mode === 'stage' ? 'audience' : 'speaker'),
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
  /** `<split id>.<n>`. */
  id: string;
  /** The room's number (1-based). */
  n: number | null;
  name: string;
  /** Always null: a breakout room is part of the main call, not a call of its own. */
  callId: null;
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
  createdByUserId: string | null;
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
        const n = int(e.n);
        return {
          id: roomId,
          n,
          name: str(e.name) ?? (n ? `Room ${n}` : 'Room'),
          callId: null,
          userIds: ids(e.user_ids),
          participants: ids(e.participants),
        };
      })
      .filter((r): r is BreakoutRoom => !!r),
    myRoomId: str(o.my_room_id),
    createdByUserId: str(o.created_by_user_id),
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
  /** The guest id (admit / deny by it). */
  id: string;
  /** The name the guest typed. */
  name: string;
  guest: boolean;
  userId: string | null;
  requestedAt: string | null;
}

/** A conversation's lobby: guests can wait before its call starts. */
export interface LobbyState {
  /** null before a call is live. */
  callId: string | null;
  conversationId: string | null;
  enabled: boolean;
  /** Oldest first. */
  waiting: LobbyEntry[];
}

/** Where a lobby lives: the conversation, and its live call when there is one. */
export interface LobbyTarget {
  conversationId: string;
  callId?: string | null;
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
  const conversationId = str(o?.conversation_id);
  if (!o || (!callId && !conversationId)) return null;
  return {
    callId,
    conversationId,
    enabled: o.enabled !== false,
    waiting: arr(o.waiting)
      .map(lobbyEntryFromWire)
      .filter((e): e is LobbyEntry => !!e)
      .sort((a, b) => (a.requestedAt ?? '').localeCompare(b.requestedAt ?? '')),
  };
}

/**
 * A guest's place in the lobby, from their own side. `waiting` lasts
 * until a member admitted them AND a call is live ("Waiting for the host").
 */
export type GuestLobbyStatus =
  | { status: 'waiting' }
  | { status: 'admitted'; session: GuestCallSession | null }
  | { status: 'denied' }
  | { status: 'ended' };

export function guestLobbyFromWire(raw: unknown): GuestLobbyStatus {
  const o = obj(unwrap(raw, 'lobby')) ?? {};
  switch (o.status) {
    case 'admitted':
      return { status: 'admitted', session: guestSessionFromWire(o.session) };
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
 * Wait in a conversation's lobby as a guest — no poolse session, only
 * the guest token `POST /guest/join` answered with (`lobby_token`, the
 * same as `token`; `entryId` is the guest id). Polls
 * `GET /v1/guest/lobby/:entryId` every `intervalMs` (default 2.5 s, the
 * server asks for 2–3 s) until admitted with a live call, denied
 * (`403`) or ended (`410`), and resolves with that. `signal` stops
 * waiting (the guest closed the page).
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
  const url = opts.apiUrl.replace(/\/+$/, '') + MEETINGS_LIVE_PATHS.guest.lobby(opts.entryId);
  const every = Math.max(500, opts.intervalMs ?? 2500);
  for (;;) {
    if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    let status: GuestLobbyStatus = { status: 'waiting' };
    try {
      const res = await doFetch(url, {
        headers: { authorization: `Bearer ${opts.lobbyToken}`, accept: 'application/json' },
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      if (res.status === 404 || res.status === 410 || res.status === 401)
        status = { status: 'ended' };
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

// ── guests from a browser (CL9) ──────────────────────────────────────────

/** What a guest link says before joining (`GET /guest/links/:token`). */
export interface GuestLinkInfo {
  conversationName: string | null;
  lobby: boolean;
  publish: 'audio_video' | 'audio' | 'none';
  expiresAt: string | null;
  /** A call is live there now. */
  live: boolean;
}

/** `POST /guest/join`'s answer. */
export interface GuestJoin {
  guestId: string;
  guestName: string;
  /** The guest token (also the lobby token). Keep it for this page only. */
  token: string;
  entryId: string;
  conversationName: string | null;
  lobby: boolean;
}

/** The guest's call: SFU credentials once admitted and live. */
export interface GuestCallSession {
  conversationName: string | null;
  call: {
    id: string;
    media: 'audio' | 'video';
    kind: string | null;
    role: StageRole | null;
  } | null;
  livekit: { url: string; token: string } | null;
  identity: string | null;
  /** The call snapshot's `meeting` (stage, hands…), raw. */
  meeting: Obj | null;
}

function publishOf(v: unknown): GuestLinkInfo['publish'] {
  return v === 'audio' || v === 'none' ? v : 'audio_video';
}

export function guestSessionFromWire(raw: unknown): GuestCallSession | null {
  const o = obj(raw);
  if (!o) return null;
  const c = obj(o.call);
  const lk = obj(o.livekit);
  const url = str(lk?.url);
  const token = str(lk?.token);
  return {
    conversationName: str(o.conversation_name),
    call:
      c && str(c.id)
        ? {
            id: str(c.id)!,
            media: c.media === 'video' ? 'video' : 'audio',
            kind: str(c.kind),
            role: roleOf(c.role),
          }
        : null,
    livekit: url && token ? { url, token } : null,
    identity: str(o.identity),
    meeting: obj(o.meeting),
  };
}

/** A guest client's failure: `link_invalid`, `guest_left`, `guest_expired`, `not_admitted`, `rate_limited`… */
export class GuestApiError extends Error {
  public override readonly name = 'GuestApiError';
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(`[${status}] ${code}`);
  }
}

/**
 * The browser call page's client for someone without an account (CL9):
 * look at the link, join with a name, wait in the lobby, get the call's
 * session, then raise a hand, react, ask and vote, report quality and
 * leave — all with the guest token, nothing stored.
 *
 *     const guest = new GuestClient({ apiUrl });
 *     const info = await guest.link(linkToken);
 *     const joined = await guest.join(linkToken, 'Ana');
 *     const st = await guest.waitInLobby({ onStatus });
 *     const session = st.status === 'admitted' ? st.session ?? await guest.session() : null;
 */
export class GuestClient {
  private readonly apiUrl: string;
  private readonly doFetch: typeof fetch;
  private token: string | null;
  private entryId: string | null = null;

  constructor(opts: { apiUrl: string; fetch?: typeof fetch; token?: string | null }) {
    this.apiUrl = opts.apiUrl.replace(/\/+$/, '');
    this.doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.token = opts.token ?? null;
  }

  /** The guest token, once joined. */
  getToken(): string | null {
    return this.token;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    auth = true,
  ): Promise<unknown> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (auth && this.token) headers['authorization'] = `Bearer ${this.token}`;
    const res = await this.doFetch(this.apiUrl + path, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 204) return null;
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const code = str(obj(obj(json)?.error)?.code) ?? `http_${res.status}`;
      throw new GuestApiError(res.status, code);
    }
    return json;
  }

  /** `GET /guest/links/:token` — what the link opens. `link_invalid` (404) when revoked or expired. */
  async link(linkToken: string): Promise<GuestLinkInfo> {
    const o =
      obj(
        unwrap(
          await this.request('GET', MEETINGS_LIVE_PATHS.guest.link(linkToken), undefined, false),
          'data',
        ),
      ) ?? {};
    return {
      conversationName: str(o.conversation_name),
      lobby: o.lobby !== false,
      publish: publishOf(o.publish),
      expiresAt: str(o.expires_at),
      live: o.live === true,
    };
  }

  /** `POST /guest/join {link, name}` — name 1–60 characters. Keeps the guest token. */
  async join(linkToken: string, name: string): Promise<GuestJoin> {
    const o =
      obj(
        await this.request(
          'POST',
          MEETINGS_LIVE_PATHS.guest.join(),
          { link: linkToken, name: name.trim().slice(0, 60) },
          false,
        ),
      ) ?? {};
    const g = obj(o.guest) ?? {};
    const token = str(o.token) ?? str(o.lobby_token);
    const entryId = str(o.entry_id) ?? str(g.id);
    if (!token || !entryId) throw new GuestApiError(500, 'unexpected_reply');
    this.token = token;
    this.entryId = entryId;
    return {
      guestId: str(g.id) ?? entryId,
      guestName: str(g.name) ?? name.trim(),
      token,
      entryId,
      conversationName: str(o.conversation_name),
      lobby: o.lobby !== false,
    };
  }

  /** Poll the lobby until admitted (with a live call), denied or ended. */
  waitInLobby(
    opts: {
      intervalMs?: number;
      signal?: AbortSignal;
      onStatus?: (s: GuestLobbyStatus) => void;
    } = {},
  ): Promise<GuestLobbyStatus> {
    if (!this.token || !this.entryId) return Promise.reject(new GuestApiError(401, 'not_joined'));
    return waitInLobby({
      apiUrl: this.apiUrl,
      entryId: this.entryId,
      lobbyToken: this.token,
      fetch: this.doFetch,
      ...opts,
    });
  }

  /** `GET /guest/session` — the call, its LiveKit token once admitted, the stage. */
  async session(): Promise<GuestCallSession | null> {
    return guestSessionFromWire(await this.request('GET', MEETINGS_LIVE_PATHS.guest.session()));
  }

  /** `POST /guest/leave`. The token stops working. */
  async leave(): Promise<void> {
    await this.request('POST', MEETINGS_LIVE_PATHS.guest.leave());
    this.token = null;
  }

  async hand(raised: boolean): Promise<StageState | null> {
    return stageFromWire(await this.request('POST', MEETINGS_LIVE_PATHS.guest.hand(), { raised }));
  }

  async react(emoji: string): Promise<void> {
    await this.request('POST', MEETINGS_LIVE_PATHS.guest.reactions(), { emoji });
  }

  async questions(): Promise<Question[]> {
    return arr(
      unwrap(await this.request('GET', MEETINGS_LIVE_PATHS.guest.questions()), 'questions'),
    )
      .map(questionFromWire)
      .filter((q): q is Question => !!q);
  }

  async ask(text: string, opts: { anonymous?: boolean } = {}): Promise<Question | null> {
    return questionFromWire(
      await this.request('POST', MEETINGS_LIVE_PATHS.guest.questions(), {
        text: text.trim().slice(0, QUESTION_MAX),
        anonymous: opts.anonymous ?? false,
      }),
    );
  }

  async vote(questionId: string, on = true): Promise<Question | null> {
    return questionFromWire(
      await this.request(on ? 'POST' : 'DELETE', MEETINGS_LIVE_PATHS.guest.vote(questionId)),
    );
  }

  /** `POST /guest/quality` — the same body as `live.quality.report`. */
  async reportQuality(body: CallQualityReportBody): Promise<void> {
    await this.request('POST', MEETINGS_LIVE_PATHS.guest.quality(), body);
  }
}

// ── moments (CL14) ───────────────────────────────────────────────────────

export interface MarkedMoment {
  id: string;
  callId: string;
  userId: string | null;
  /** Who marked it, as the server names them. */
  name: string | null;
  /** The marked time (may be a little before the tap, `at`). */
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
    name: str(o.name),
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
  /** `whiteboard:<call_id>`. */
  docId: string;
  docToken: string;
  /** About an hour out; `openWhiteboard` refreshes it. */
  expiresAt: string | null;
  rights: 'read' | 'write';
  callId: string | null;
  conversationId: string | null;
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
    callId: str(o.call_id),
    conversationId: str(o.conversation_id),
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
  /** The conversation the card was posted in. */
  conversationId: string | null;
  /** The live call, once started. */
  callId: string | null;
  organizer: MeetingPerson | null;
  /** Who answered what, by user id. */
  rsvps: Record<RsvpResponse, string[]>;
  /**
   * Your own answer — only from `GET /meetings/:id` or an RSVP reply; a
   * card's body always has null here (read it with `rsvpOf(card, me.id)`).
   */
  myRsvp: RsvpResponse | null;
  /** Invited people (for "4 of 6 accepted"). */
  inviteeCount: number | null;
  /** Answers per kind, as the server counted them. */
  counts: Record<RsvpResponse, number>;
}

/**
 * A meeting card from a message — a `system` message whose body is
 * `{"type":"meeting_card","meeting":{…}}` — else null. The server
 * restates the same message (`message:updated`, no edit mark) whenever
 * the meeting or an RSVP changes, so the card stays live by itself.
 */
export function meetingCardOf(
  message: { body?: unknown; type?: unknown } | null | undefined,
): MeetingCard | null {
  const body = message?.body;
  if (typeof body !== 'string' || !body.startsWith('{') || !body.includes('meeting_card')) {
    return null;
  }
  try {
    const parsed = obj(JSON.parse(body));
    return parsed?.type === 'meeting_card' ? meetingCardFromWire(parsed.meeting) : null;
  } catch {
    return null;
  }
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
  const c = obj(o.counts) ?? {};
  const rsvps = {
    accepted: ids(r.accepted),
    declined: ids(r.declined),
    tentative: ids(r.tentative),
  };
  const count = (k: RsvpResponse) => int(c[k]) ?? rsvps[k].length;
  return {
    meetingId,
    title: (str(o.title) ?? 'Meeting').slice(0, 200),
    startsAt: str(o.starts_at),
    endsAt: str(o.ends_at),
    media: o.media === 'video' ? 'video' : 'audio',
    status,
    roomConversationId: str(o.room_conversation_id) ?? str(o.conversation_id),
    conversationId: str(o.conversation_id),
    callId: str(o.call_id),
    organizer: personFromWire(o.organizer),
    rsvps,
    myRsvp: my === 'accepted' || my === 'declined' || my === 'tentative' ? my : null,
    inviteeCount: int(o.invitee_count),
    counts: {
      accepted: count('accepted'),
      declined: count('declined'),
      tentative: count('tentative'),
    },
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

// ── the call snapshot's meeting (§2) ─────────────────────────────────────

/** A guest or phone in the call (members are `LiveCall.participants`). */
export interface MeetingAttendee {
  identity: string;
  kind: 'guest' | 'phone';
  /** Shown as is: a guest's typed name, or "Phone ···1234". */
  name: string;
  role: StageRole | null;
}

/** One person's link as they reported it (CL15). */
export interface ParticipantQuality {
  identity: string;
  quality: 'good' | 'poor' | 'lost' | 'unknown';
  reason: 'reconnecting' | 'packet_loss' | 'high_latency' | 'jitter' | 'poor' | null;
  /** A sentence for the person: "Your network is dropping packets (8%)…". */
  explanation: string | null;
  at: string | null;
}

/** `CallSummary.meeting` / `GET /calls/:id/meeting`. */
export interface CallMeeting {
  stage: boolean;
  roles: Record<string, StageRole>;
  hands: RaisedHand[];
  /** Who has captions on. */
  captionsUserIds: string[];
  attendees: MeetingAttendee[];
  quality: Record<string, ParticipantQuality>;
  breakout: BreakoutSession | null;
  scheduledMeeting: {
    id: string;
    title: string;
    startsAt: string | null;
    endsAt: string | null;
    organizerUserId: string | null;
    agentContextAllowed: boolean;
  } | null;
  whiteboard: { docId: string } | null;
  lobbyWaiting: number;
}

export function attendeeFromWire(raw: unknown): MeetingAttendee | null {
  const o = obj(raw);
  const identity = str(o?.identity);
  if (!o || !identity) return null;
  const kind = o.kind === 'phone' || identityKindOf(identity) === 'phone' ? 'phone' : 'guest';
  return {
    identity,
    kind,
    name: meetingNameOf(identity, str(o.name)) ?? (kind === 'phone' ? 'Phone' : 'Guest'),
    role: roleOf(o.role),
  };
}

const QUALITY_REASONS = ['reconnecting', 'packet_loss', 'high_latency', 'jitter', 'poor'] as const;

export function participantQualityFromWire(raw: unknown, key?: string): ParticipantQuality | null {
  const o = obj(unwrap(raw, 'quality'));
  const identity = str(o?.identity) ?? str(o?.user_id) ?? key ?? null;
  if (!o || !identity) return null;
  const q = o.quality;
  return {
    identity,
    quality: q === 'good' || q === 'poor' || q === 'lost' ? q : 'unknown',
    reason: (QUALITY_REASONS as readonly unknown[]).includes(o.reason)
      ? (o.reason as ParticipantQuality['reason'])
      : null,
    explanation: str(o.explanation),
    at: str(o.at),
  };
}

export function callMeetingFromWire(raw: unknown): CallMeeting | null {
  const o = obj(unwrap(raw, 'meeting'));
  if (!o) return null;
  const roles: Record<string, StageRole> = {};
  for (const [k, v] of Object.entries(obj(o.roles) ?? {})) {
    const r = roleOf(v);
    if (r) roles[k] = r;
  }
  const quality: Record<string, ParticipantQuality> = {};
  for (const [k, v] of Object.entries(obj(o.quality) ?? {})) {
    const q = participantQualityFromWire(v, k);
    if (q) quality[k] = q;
  }
  const sm = obj(o.scheduled_meeting);
  const wb = obj(o.whiteboard);
  return {
    stage: o.stage === true,
    roles,
    hands: arr(o.hands)
      .map((h): RaisedHand | null => {
        const e = obj(h);
        const userId = str(e?.user_id) ?? str(e?.identity);
        return userId
          ? { userId, name: meetingNameOf(userId, str(e?.name)), raisedAt: str(e?.raised_at) }
          : null;
      })
      .filter((h): h is RaisedHand => !!h),
    captionsUserIds: arr(o.captions_user_ids).filter((x): x is string => typeof x === 'string'),
    attendees: arr(o.attendees)
      .map(attendeeFromWire)
      .filter((a): a is MeetingAttendee => !!a),
    quality,
    breakout: breakoutsFromWire(o.breakout),
    scheduledMeeting:
      sm && str(sm.id)
        ? {
            id: str(sm.id)!,
            title: str(sm.title) ?? 'Meeting',
            startsAt: str(sm.starts_at),
            endsAt: str(sm.ends_at),
            organizerUserId: str(sm.organizer_user_id),
            agentContextAllowed: sm.agent_context_allowed === true,
          }
        : null,
    whiteboard: wb && str(wb.doc_id) ? { docId: str(wb.doc_id)! } : null,
    lobbyWaiting: Math.max(0, int(o.lobby_waiting) ?? 0),
  };
}

/** A call snapshot's `meeting`, parsed (`LiveCall.meeting`), or null on older servers. */
export function callMeetingOf(live: { meeting?: unknown } | null | undefined): CallMeeting | null {
  return live?.meeting ? callMeetingFromWire({ meeting: live.meeting }) : null;
}

// ── captions (CL13) ──────────────────────────────────────────────────────

export interface CaptionsState {
  callId: string;
  /** Who has captions on. */
  userIds: string[];
  /** The live transcript carrying them (`source: "captions"` when captions-only). */
  transcriptId: string | null;
}

export function captionsFromWire(raw: unknown): CaptionsState | null {
  const o = obj(unwrap(raw, 'captions'));
  const callId = str(o?.call_id);
  if (!o || !callId) return null;
  return {
    callId,
    userIds: arr(o.user_ids).filter((x): x is string => typeof x === 'string'),
    transcriptId: str(o.transcript_id),
  };
}

// ── quality reports (CL15) ───────────────────────────────────────────────

/** What a client reports about its own link: `POST /calls/:id/quality` (30/min). */
export interface CallQualityReportBody {
  quality: 'good' | 'poor' | 'lost' | 'unknown';
  /** Percent, 0–100. */
  packet_loss?: number;
  rtt_ms?: number;
  jitter_ms?: number;
  reconnecting?: boolean;
}

// ── rooms and who's in (CL2) ─────────────────────────────────────────────

/** Who is in a drop-in room right now. */
export interface RoomPresenceEntry {
  conversationId: string;
  /** The live call, or null when the room is empty. */
  callId: string | null;
  media: 'audio' | 'video' | null;
  live: boolean;
  participants: LiveCallMember[];
  /** Guests and phones, already named. */
  attendees: MeetingAttendee[];
}

/** One of your rooms (`GET /me/rooms`). */
export interface MyRoom {
  conversationId: string;
  name: string | null;
  /** The conversation's `settings.room` (media, lobby, stage, guests…). */
  settings: { media: 'audio' | 'video'; lobby: boolean; stage: boolean; guests: boolean };
  presence: RoomPresenceEntry;
}

function membersOf(v: unknown): LiveCallMember[] {
  return arr(v)
    .map((p): LiveCallMember | null => {
      const e = obj(p);
      const userId = str(e?.user_id);
      return userId
        ? { user_id: userId, external_id: str(e?.external_id), display_name: str(e?.display_name) }
        : null;
    })
    .filter((p): p is LiveCallMember => !!p);
}

/** `room:participants` (user topic) → who's in. */
export function roomPresenceFromWire(raw: unknown): RoomPresenceEntry | null {
  const o = obj(raw);
  const conversationId = str(o?.conversation_id);
  if (!o || !conversationId) return null;
  const live = o.live !== false && !!str(o.call_id);
  return {
    conversationId,
    callId: live ? str(o.call_id) : null,
    media: o.media === 'video' ? 'video' : o.media === 'audio' ? 'audio' : null,
    live,
    participants: live ? membersOf(o.participants) : [],
    attendees: live
      ? arr(o.attendees)
          .map(attendeeFromWire)
          .filter((a): a is MeetingAttendee => !!a)
      : [],
  };
}

export function myRoomFromWire(raw: unknown): MyRoom | null {
  const o = obj(raw);
  const c = obj(o?.conversation);
  const conversationId = str(c?.id) ?? str(o?.conversation_id);
  if (!o || !conversationId) return null;
  const r = obj(o.room) ?? {};
  const callObj = obj(o.call);
  const presence = callObj
    ? roomPresenceFromWire({
        ...callObj,
        conversation_id: conversationId,
        call_id: callObj.id,
        live: true,
      })
    : null;
  return {
    conversationId,
    name: str(c?.name),
    settings: {
      media: r.media === 'video' ? 'video' : 'audio',
      lobby: r.lobby === true,
      stage: r.stage === true,
      guests: r.guests !== false,
    },
    presence: presence ?? {
      conversationId,
      callId: null,
      media: null,
      live: false,
      participants: [],
      attendees: [],
    },
  };
}

// ── phones (CL8) and guest links (CL9) ───────────────────────────────────

/** A dial-in: numbers to call and the PIN to type. */
export interface DialIn {
  id: string;
  conversationId: string;
  scheduledMeetingId: string | null;
  numbers: string[];
  pin: string;
  expiresAt: string | null;
}

export function dialInFromWire(raw: unknown): DialIn | null {
  const o = obj(unwrap(raw, 'data'));
  const id = str(o?.id);
  if (!o || !id) return null;
  return {
    id,
    conversationId: str(o.conversation_id) ?? '',
    scheduledMeetingId: str(o.scheduled_meeting_id),
    numbers: arr(o.numbers).filter((x): x is string => typeof x === 'string'),
    pin: str(o.pin) ?? '',
    expiresAt: str(o.expires_at),
  };
}

/** A guest link (CL9). `token` — the secret for the URL — only on the create reply. */
export interface GuestLink {
  id: string;
  conversationId: string;
  scheduledMeetingId: string | null;
  label: string | null;
  lobby: boolean;
  publish: 'audio_video' | 'audio' | 'none';
  createdByUserId: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  token: string | null;
}

export function guestLinkFromWire(raw: unknown): GuestLink | null {
  const o = obj(unwrap(raw, 'data'));
  const id = str(o?.id);
  if (!o || !id) return null;
  return {
    id,
    conversationId: str(o.conversation_id) ?? '',
    scheduledMeetingId: str(o.scheduled_meeting_id),
    label: str(o.label),
    lobby: o.lobby !== false,
    publish: publishOf(o.publish),
    createdByUserId: str(o.created_by_user_id),
    expiresAt: str(o.expires_at),
    revokedAt: str(o.revoked_at),
    token: str(o.token),
  };
}

// ── the resource ─────────────────────────────────────────────────────────

/** Listeners for {@link LiveMeetingsResource.subscribe}. */
export interface LiveMeetingsListeners {
  onStage?: (stage: StageState) => void;
  onQuestion?: (question: Question) => void;
  onQuestionDeleted?: (questionId: string) => void;
  /** Open, closing — and closed (`status: 'closed'`: return to the main room). */
  onBreakouts?: (session: BreakoutSession) => void;
  /** The conversation's lobby (also before the call, so not filtered by call). */
  onLobby?: (lobby: LobbyState, change: { type: string; guestName: string | null } | null) => void;
  onMoment?: (moment: MarkedMoment) => void;
  onMomentRemoved?: (momentId: string) => void;
  onAgenda?: (agenda: Agenda) => void;
  /** An agenda item ran over its minutes. */
  onAgendaOvertime?: (evt: { itemId: string; overByMs: number; item: AgendaItem | null }) => void;
  /** The call runs past the scheduled meeting's end. */
  onMeetingOvertime?: (evt: { overBySeconds: number; endsAt: string | null }) => void;
  onMeetingCard?: (card: MeetingCard) => void;
  onRsvp?: (evt: {
    meetingId: string;
    userId: string;
    response: RsvpResponse;
    counts: Record<RsvpResponse, number> | null;
  }) => void;
  /** The server-relayed reactions (`call:reaction`), e.g. from guests without a data channel. */
  onReaction?: (evt: {
    identity: string;
    name: string | null;
    emoji: string;
    at: string | null;
  }) => void;
  onQuality?: (quality: ParticipantQuality) => void;
  /** Guests and phones in the call changed. */
  onAttendees?: (attendees: MeetingAttendee[]) => void;
  onCaptions?: (captions: CaptionsState) => void;
  onWhiteboardOpened?: (evt: { docId: string; openedByUserId: string | null }) => void;
}

/** Listeners for {@link LiveMeetingsResource.subscribeUser}. */
export interface LiveMeetingsUserListeners {
  /** Who's in one of your rooms changed (`live: false` once it ended). */
  onRoomParticipants?: (presence: RoomPresenceEntry) => void;
  /** A meeting you're invited to is starting (`ring`: you're being rung too). */
  onMeetingStarting?: (evt: { meeting: MeetingCard; callId: string | null; ring: boolean }) => void;
  /** The brief before a meeting (CA9). */
  onMeetingBrief?: (evt: {
    meeting: MeetingCard;
    title: string | null;
    body: string | null;
  }) => void;
}

/** `poolse.live` — the live meeting features of a call. */
export class LiveMeetingsResource {
  public readonly stage: StageApi;
  public readonly questions: QuestionsApi;
  public readonly breakouts: BreakoutsApi;
  public readonly lobby: LobbyApi;
  public readonly moments: MomentsApi;
  public readonly agenda: AgendaApi;
  public readonly captions: CaptionsApi;
  public readonly quality: QualityApi;
  /** Scheduled meetings as members see them: get, list, RSVP (CA4, CA11). */
  public readonly meetings: ScheduledMeetingsApi;
  /** Dial-in numbers and calling a phone into the meeting (CL8). */
  public readonly phones: PhonesApi;
  /** Browser guest links (CL9). */
  public readonly guestLinks: GuestLinksApi;

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
    this.captions = new CaptionsApi(rest);
    this.quality = new QualityApi(rest);
    this.meetings = new ScheduledMeetingsApi(rest);
    this.phones = new PhonesApi(rest);
    this.guestLinks = new GuestLinksApi(rest);
  }

  /** `GET /v1/calls/:id/meeting` — the snapshot's `meeting` (stage, hands, attendees, quality…). */
  async meeting(callId: string, signal?: AbortSignal): Promise<CallMeeting> {
    const res = await this.rest.request<unknown>({
      method: 'GET',
      path: MEETINGS_LIVE_PATHS.meeting(callId),
      ...(signal ? { signal } : {}),
    });
    const m = callMeetingFromWire(res);
    if (!m) throw new Error('meeting: unexpected reply');
    return m;
  }

  /**
   * `POST /v1/calls/:id/whiteboard` — a one-hour doc-relay token for the
   * call's board (`whiteboard:<call_id>`; the Workspace saves it with the
   * meeting). Members in the call only; guests can't open it.
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
   * The call's chat (CL6): `GET /v1/calls/:id/messages?limit&before`,
   * newest first — during the call and after. Send into it with
   * `call_id` on a conversation message.
   */
  async messages(
    callId: string,
    opts: { limit?: number; before?: string; signal?: AbortSignal } = {},
  ): Promise<Message[]> {
    const res = await this.rest.request<unknown>({
      method: 'GET',
      path: MEETINGS_LIVE_PATHS.messages(callId),
      query: { limit: opts.limit, before: opts.before },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return arr(obj(res)?.data) as Message[];
  }

  /**
   * Relay a reaction through the server (`POST /v1/calls/:id/reactions`,
   * 20 per 10 s) — for clients without a data channel. `CallReactions`
   * sends peer to peer and needs none of this.
   */
  async react(callId: string, emoji: string): Promise<void> {
    await this.rest.request<unknown>({
      method: 'POST',
      path: MEETINGS_LIVE_PATHS.reactions(callId),
      body: { emoji },
    });
  }

  /** `GET /v1/me/rooms` — your permanent rooms by name, each with who's in. */
  async rooms(signal?: AbortSignal): Promise<MyRoom[]> {
    const res = await this.rest.request<unknown>({
      method: 'GET',
      path: MEETINGS_LIVE_PATHS.myRooms(),
      ...(signal ? { signal } : {}),
    });
    return arr(obj(res)?.data)
      .map(myRoomFromWire)
      .filter((r): r is MyRoom => !!r);
  }

  /**
   * Move the call to this device (CL11): `POST /v1/calls/:id/join` with
   * the same identity. LiveKit disconnects the other device
   * (`DUPLICATE_IDENTITY`) — it sees `onDisconnected('moved')` (web) or
   * `reason: 'moved'` (native) and closes its call screen. Connect the
   * returned session's LiveKit credentials.
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
   * events for `callId` reach the listeners — except the lobby's, which
   * belongs to the conversation. `selfUserId` lets stage events (which
   * carry no `my_role`) work out yours.
   */
  subscribe(
    conversationId: string,
    callId: string,
    listeners: LiveMeetingsListeners,
    opts: { selfUserId?: string | null } = {},
  ): Unsubscribe {
    const conv = this.realtime.conversation(conversationId);
    const E = MEETINGS_LIVE_EVENTS;
    const mine = (p: unknown) => str(obj(p)?.call_id) === callId;
    const offs: Unsubscribe[] = [];
    const on = (event: string, fn: (payload: unknown) => void) => offs.push(conv.on(event, fn));
    const L = listeners;

    if (L.onStage)
      on(E.stage, (p) => {
        const s = mine(p) ? stageFromWire(p, opts.selfUserId) : null;
        if (s) L.onStage!(s);
      });
    if (L.onQuestion) {
      const fn = (p: unknown) => {
        const q = questionFromWire(p);
        if (q && q.callId === callId) L.onQuestion!(q);
      };
      on(E.questionCreated, fn);
      on(E.questionUpdated, fn);
    }
    if (L.onQuestionDeleted)
      on(E.questionDeleted, (p) => {
        const id = str(obj(p)?.question_id) ?? str(obj(obj(p)?.question)?.id);
        if (id && mine(p)) L.onQuestionDeleted!(id);
      });
    if (L.onBreakouts) {
      const fn = (p: unknown) => {
        const b = breakoutsFromWire(p);
        if (b && b.callId === callId) L.onBreakouts!(b);
      };
      on(E.breakouts, fn);
      on(E.breakoutsClosing, fn);
    }
    if (L.onLobby)
      on(E.lobbyUpdated, (p) => {
        const l = lobbyFromWire(p);
        if (!l || (l.conversationId && l.conversationId !== conversationId)) return;
        const c = obj(obj(p)?.change);
        L.onLobby!(
          l,
          c ? { type: str(c.type) ?? 'waiting', guestName: str(obj(c.guest)?.name) } : null,
        );
      });
    if (L.onMoment)
      on(E.moment, (p) => {
        const m = markedMomentFromWire(p);
        if (m && m.callId === callId) L.onMoment!(m);
      });
    if (L.onMomentRemoved)
      on(E.momentRemoved, (p) => {
        const id = str(obj(p)?.moment_id) ?? str(obj(obj(p)?.moment)?.id);
        if (id && mine(p)) L.onMomentRemoved!(id);
      });
    if (L.onAgenda)
      on(E.agenda, (p) => {
        const a = agendaFromWire(p);
        if (a && a.callId === callId) L.onAgenda!(a);
      });
    if (L.onAgendaOvertime)
      on(E.agendaOvertime, (p) => {
        const o = obj(p);
        const itemId = str(o?.item_id);
        if (!itemId || !mine(p)) return;
        const item = agendaFromWire({ call_id: callId, items: [o?.item] })?.items[0] ?? null;
        L.onAgendaOvertime!({ itemId, overByMs: int(o?.over_by_ms) ?? 0, item });
      });
    if (L.onMeetingOvertime)
      on(E.meetingOvertime, (p) => {
        const o = obj(p);
        if (mine(p))
          L.onMeetingOvertime!({
            overBySeconds: int(o?.over_by_seconds) ?? 0,
            endsAt: str(o?.ends_at),
          });
      });
    if (L.onMeetingCard)
      on(E.meetingUpdated, (p) => {
        const c = meetingCardFromWire(p);
        if (c) L.onMeetingCard!(c);
      });
    if (L.onRsvp)
      on(E.meetingRsvp, (p) => {
        const o = obj(p);
        const meetingId = str(o?.scheduled_meeting_id);
        const userId = str(o?.user_id);
        const r = o?.response;
        if (!meetingId || !userId || (r !== 'accepted' && r !== 'declined' && r !== 'tentative'))
          return;
        const c = obj(o?.counts);
        L.onRsvp!({
          meetingId,
          userId,
          response: r,
          counts: c
            ? {
                accepted: int(c.accepted) ?? 0,
                declined: int(c.declined) ?? 0,
                tentative: int(c.tentative) ?? 0,
              }
            : null,
        });
      });
    if (L.onReaction)
      on(E.reaction, (p) => {
        const o = obj(p);
        const identity = str(o?.identity);
        const emoji = str(o?.emoji);
        if (identity && emoji && mine(p))
          L.onReaction!({
            identity,
            name: meetingNameOf(identity, str(o?.name)),
            emoji,
            at: str(o?.at),
          });
      });
    if (L.onQuality)
      on(E.quality, (p) => {
        const q = mine(p) ? participantQualityFromWire(p) : null;
        if (q) L.onQuality!(q);
      });
    if (L.onAttendees)
      on(E.attendees, (p) => {
        if (!mine(p)) return;
        L.onAttendees!(
          arr(obj(p)?.attendees)
            .map(attendeeFromWire)
            .filter((a): a is MeetingAttendee => !!a),
        );
      });
    if (L.onCaptions)
      on(E.captions, (p) => {
        const c = captionsFromWire(p);
        if (c && c.callId === callId) L.onCaptions!(c);
      });
    if (L.onWhiteboardOpened)
      on(E.whiteboardOpened, (p) => {
        const o = obj(p);
        const docId = str(o?.doc_id);
        if (docId && mine(p))
          L.onWhiteboardOpened!({ docId, openedByUserId: str(o?.opened_by_user_id) });
      });
    return () => offs.forEach((off) => off());
  }

  /**
   * Your user topic's meeting events: who's in your rooms (for the
   * sidebar, without the conversations open) and meetings starting.
   */
  subscribeUser(userId: string, listeners: LiveMeetingsUserListeners): Unsubscribe {
    const user = this.realtime.user(userId);
    const U = MEETINGS_USER_EVENTS;
    const offs: Unsubscribe[] = [];
    if (listeners.onRoomParticipants)
      offs.push(
        user.on(U.roomParticipants, (p) => {
          const r = roomPresenceFromWire(p);
          if (r) listeners.onRoomParticipants!(r);
        }),
      );
    if (listeners.onMeetingStarting)
      offs.push(
        user.on(U.meetingStarting, (p) => {
          const o = obj(p);
          const meeting = meetingCardFromWire(o?.meeting);
          if (meeting)
            listeners.onMeetingStarting!({
              meeting,
              callId: str(o?.call_id),
              ring: o?.ring === true,
            });
        }),
      );
    if (listeners.onMeetingBrief)
      offs.push(
        user.on(U.meetingBrief, (p) => {
          const o = obj(p);
          const meeting = meetingCardFromWire(o?.meeting);
          const b = obj(o?.brief);
          if (meeting)
            listeners.onMeetingBrief!({ meeting, title: str(b?.title), body: str(b?.body) });
        }),
      );
    return () => offs.forEach((off) => off());
  }
}

abstract class Api {
  constructor(protected readonly rest: RestClient) {}

  protected async send<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
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

  /** `PATCH /v1/calls/:id/stage {mode}` — a moderator turns stage mode on or off. */
  setMode(callId: string, mode: 'stage' | 'meeting'): Promise<StageState> {
    return this.send('PATCH', MEETINGS_LIVE_PATHS.stage(callId), stageFromWire, { mode });
  }

  /** `POST /v1/calls/:id/hand {raised: true}` — raise your hand (30/min). */
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

  /** `DELETE /v1/questions/:id` — the author or a moderator. */
  async remove(questionId: string): Promise<void> {
    await this.rest.request<void>({
      method: 'DELETE',
      path: MEETINGS_LIVE_PATHS.question(questionId),
    });
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

  /** `PATCH /v1/calls/:id/breakouts {moves}` — move people (room number, or null: back to main). */
  move(callId: string, moves: Record<string, number | null>): Promise<BreakoutSession> {
    return this.send('PATCH', MEETINGS_LIVE_PATHS.breakouts(callId), breakoutsFromWire, { moves });
  }

  /**
   * `POST /v1/calls/:id/breakouts/close {after_seconds}` — bring everyone
   * back, after a warning (0–300 s; default 0, at once). Rooms go
   * `closing` until `returnAt`, then closed.
   */
  close(callId: string, afterSeconds = 0): Promise<BreakoutSession> {
    return this.send('POST', MEETINGS_LIVE_PATHS.breakoutsClose(callId), breakoutsFromWire, {
      after_seconds: Math.max(0, Math.min(300, Math.floor(afterSeconds))),
    });
  }

  /**
   * `POST /v1/breakouts/:roomId/join` — the session bundle with your
   * room's `livekit` (and `breakout: {room_id, name}`). A breakout room
   * is still the main call: connect to it, THEN leave the main room's
   * media (don't hang up — that would leave the call).
   */
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

/**
 * The lobby, from the members' side (CL10). It belongs to the
 * conversation, so guests can wait before the call starts: pass the
 * conversation (and the live call, when there is one). Guests use
 * {@link GuestClient}.
 */
export class LobbyApi extends Api {
  /** `GET /v1/conversations/:id/lobby`. */
  get(target: LobbyTarget, signal?: AbortSignal): Promise<LobbyState> {
    return this.send(
      'GET',
      MEETINGS_LIVE_PATHS.conversationLobby(target.conversationId),
      lobbyFromWire,
      undefined,
      signal,
    );
  }

  /** `POST /v1/conversations/:id/lobby/:guestId/admit` — they join once a call is live. */
  admit(target: LobbyTarget, guestId: string): Promise<LobbyState> {
    return this.send(
      'POST',
      MEETINGS_LIVE_PATHS.conversationLobbyEntry(target.conversationId, guestId, 'admit'),
      lobbyFromWire,
    );
  }

  /** `POST /v1/conversations/:id/lobby/:guestId/deny` — their media is removed. */
  deny(target: LobbyTarget, guestId: string): Promise<LobbyState> {
    return this.send(
      'POST',
      MEETINGS_LIVE_PATHS.conversationLobbyEntry(target.conversationId, guestId, 'deny'),
      lobbyFromWire,
    );
  }

  /**
   * Let everyone waiting in: `POST /v1/calls/:id/lobby/admit_all` while a
   * call is live, else one by one.
   */
  async admitAll(target: LobbyTarget): Promise<LobbyState> {
    if (target.callId) {
      return this.send('POST', MEETINGS_LIVE_PATHS.lobbyAdmitAll(target.callId), lobbyFromWire);
    }
    let lobby = await this.get(target);
    for (const e of lobby.waiting) lobby = await this.admit(target, e.id);
    return lobby;
  }
}

/** Mark a moment (CL14). */
export class MomentsApi extends Api {
  /**
   * `POST /v1/calls/:id/moments {note?}` — "this was important", now. The
   * summary and the recording highlight it. `rate_limited` past a few
   * marks a minute.
   */
  mark(callId: string, opts: { note?: string; at?: Date | string } = {}): Promise<MarkedMoment> {
    const note = opts.note?.trim().slice(0, MOMENT_NOTE_MAX);
    const at = opts.at instanceof Date ? opts.at.toISOString() : opts.at;
    return this.send('POST', MEETINGS_LIVE_PATHS.moments(callId), markedMomentFromWire, {
      ...(note ? { note } : {}),
      ...(at ? { at } : {}),
    });
  }

  /** `DELETE /v1/calls/:id/moments/:momentId` — your own. */
  async remove(callId: string, momentId: string): Promise<void> {
    await this.rest.request<void>({
      method: 'DELETE',
      path: MEETINGS_LIVE_PATHS.moment(callId, momentId),
    });
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

/** Captions (CL13): a live transcript in the call's language for whoever turns them on. */
export class CaptionsApi extends Api {
  /**
   * `PUT /v1/calls/:id/captions {on}`. While anyone wants captions a
   * live transcript runs on `transcript:<call_id>` (`useLiveTranscript`);
   * captions-only, it is stored nowhere. `captions_disabled` (403),
   * `transcription_unavailable` (503), `transcript_stopped` (409).
   */
  set(callId: string, on: boolean): Promise<CaptionsState> {
    return this.send('PUT', MEETINGS_LIVE_PATHS.captions(callId), captionsFromWire, { on });
  }
}

/** Call quality (CL15): each client reports its own link. */
export class QualityApi extends Api {
  /**
   * `POST /v1/calls/:id/quality` (30/min) — the server words it
   * (`explanation`) and tells the others (`call:quality`). Let
   * `CallQualityMonitor` send it (`report` option): it throttles.
   */
  report(callId: string, body: CallQualityReportBody): Promise<ParticipantQuality> {
    return this.send('POST', MEETINGS_LIVE_PATHS.quality(callId), participantQualityFromWire, body);
  }
}

/** Scheduled meetings as a member sees them (CA4, CA11). */
export class ScheduledMeetingsApi extends Api {
  /** `GET /v1/meetings/:id` — with your own `myRsvp`. */
  get(meetingId: string, signal?: AbortSignal): Promise<MeetingCard> {
    return this.send(
      'GET',
      MEETINGS_LIVE_PATHS.scheduledMeeting(meetingId),
      meetingCardFromWire,
      undefined,
      signal,
    );
  }

  /** `GET /v1/conversations/:id/meetings`. */
  list(conversationId: string, signal?: AbortSignal): Promise<MeetingCard[]> {
    return this.send(
      'GET',
      MEETINGS_LIVE_PATHS.conversationMeetings(conversationId),
      (res) =>
        arr(obj(res)?.data)
          .map(meetingCardFromWire)
          .filter((m): m is MeetingCard => !!m),
      undefined,
      signal,
    );
  }

  /**
   * `PUT /v1/meetings/:id/rsvp {response}` (30/min) — the card restates
   * itself for everyone. `cancelled` (409).
   */
  rsvp(meetingId: string, response: RsvpResponse): Promise<MeetingCard> {
    return this.send('PUT', MEETINGS_LIVE_PATHS.rsvp(meetingId), meetingCardFromWire, { response });
  }
}

/** Phones in a meeting (CL8). `phone_not_configured` (503) where SIP isn't set up. */
export class PhonesApi extends Api {
  /** `POST /v1/conversations/:id/dial-ins` — numbers and a 6-digit PIN (default 30 days). */
  createDialIn(
    conversationId: string,
    opts: { expiresInSeconds?: number; scheduledMeetingId?: string } = {},
  ): Promise<DialIn> {
    return this.send('POST', MEETINGS_LIVE_PATHS.dialIns(conversationId), dialInFromWire, {
      ...(opts.expiresInSeconds ? { expires_in_seconds: opts.expiresInSeconds } : {}),
      ...(opts.scheduledMeetingId ? { scheduled_meeting_id: opts.scheduledMeetingId } : {}),
    });
  }

  /** `GET /v1/conversations/:id/dial-ins`. */
  dialIns(conversationId: string, signal?: AbortSignal): Promise<DialIn[]> {
    return this.send(
      'GET',
      MEETINGS_LIVE_PATHS.dialIns(conversationId),
      (res) =>
        arr(obj(res)?.data)
          .map((d) => dialInFromWire({ data: d }))
          .filter((d): d is DialIn => !!d),
      undefined,
      signal,
    );
  }

  /** `DELETE /v1/dial-ins/:id`. */
  async deleteDialIn(id: string): Promise<void> {
    await this.rest.request<void>({ method: 'DELETE', path: MEETINGS_LIVE_PATHS.dialIn(id) });
  }

  /**
   * `POST /v1/calls/:id/phones {number, name?}` — call a phone into the
   * meeting (E.164, 5/min). Shown by `name`, else "Phone ···1234".
   */
  call(callId: string, number: string, name?: string): Promise<MeetingAttendee> {
    return this.send(
      'POST',
      MEETINGS_LIVE_PATHS.phones(callId),
      (res) => attendeeFromWire(obj(res)?.phone),
      { number: number.replace(/[\s()-]/g, ''), ...(name ? { name } : {}) },
    );
  }

  /** `DELETE /v1/calls/:id/phones/:identity` — hang up a phone. */
  async hangUp(callId: string, identity: string): Promise<void> {
    await this.rest.request<void>({
      method: 'DELETE',
      path: MEETINGS_LIVE_PATHS.phone(callId, identity),
    });
  }
}

/** Browser guest links (CL9). */
export class GuestLinksApi extends Api {
  /**
   * `POST /v1/conversations/:id/guest-links` — the reply's `token` is the
   * secret for the URL, returned only now. `guests_off` (403).
   */
  create(
    conversationId: string,
    opts: {
      label?: string;
      lobby?: boolean;
      publish?: GuestLink['publish'];
      expiresInSeconds?: number;
      scheduledMeetingId?: string;
    } = {},
  ): Promise<GuestLink> {
    return this.send('POST', MEETINGS_LIVE_PATHS.guestLinks(conversationId), guestLinkFromWire, {
      ...(opts.label ? { label: opts.label.slice(0, 120) } : {}),
      ...(opts.lobby !== undefined ? { lobby: opts.lobby } : {}),
      ...(opts.publish ? { publish: opts.publish } : {}),
      ...(opts.expiresInSeconds ? { expires_in_seconds: opts.expiresInSeconds } : {}),
      ...(opts.scheduledMeetingId ? { scheduled_meeting_id: opts.scheduledMeetingId } : {}),
    });
  }

  /** `GET /v1/conversations/:id/guest-links` — the working ones. */
  list(conversationId: string, signal?: AbortSignal): Promise<GuestLink[]> {
    return this.send(
      'GET',
      MEETINGS_LIVE_PATHS.guestLinks(conversationId),
      (res) =>
        arr(obj(res)?.data)
          .map((l) => guestLinkFromWire({ data: l }))
          .filter((l): l is GuestLink => !!l),
      undefined,
      signal,
    );
  }

  /** `DELETE /v1/guest-links/:id` — everyone who came through it is out. */
  revoke(id: string): Promise<GuestLink> {
    return this.send('DELETE', MEETINGS_LIVE_PATHS.guestLink(id), guestLinkFromWire);
  }
}
