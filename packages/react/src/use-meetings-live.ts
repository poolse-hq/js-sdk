// Hooks for the live meeting features of a call (`poolse.live`, the
// server's docs/MEETINGS.md): each reads once, then follows the
// conversation's events, and re-reads after a reconnect (events sent
// while the socket was down are gone).

import type {
  Agenda,
  AgendaItem,
  AnnotationState,
  BreakoutPlan,
  BreakoutRoom,
  BreakoutSession,
  CallMeeting,
  CallQualityReport,
  CallReaction,
  CallRoom,
  LiveMeetingsListeners,
  MeetingAttendee,
  MyRoom,
  ParticipantQuality,
  RoomPresenceEntry,
  LobbyState,
  MarkedMoment,
  OpenWhiteboard,
  Poolse,
  Question,
  QuestionStatus,
  RoomSession,
  StageRole,
  StageState,
  WhiteboardAccess,
  WhiteboardItem,
  WhiteboardModel,
  YjsModule,
} from '@poolse/sdk';
import {
  CallQualityMonitor,
  CallReactions,
  ScreenAnnotations,
  agendaOverrunMs,
  meetingNameOf,
  openWhiteboard,
  sortQuestions,
  stageRoleOf,
} from '@poolse/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useMe } from './use-me.js';
import { usePoolse } from './provider.js';

const asError = (err: unknown) => (err instanceof Error ? err : new Error(String(err)));

/** Run `fn` after every reconnect of the client's socket (not the first connect). */
function onReconnect(chat: Poolse, fn: () => void): () => void {
  let was = chat.realtime.getStatus() === 'connected';
  let before = was;
  return chat.realtime.onStatus((status) => {
    if (status === 'connected' && !was && before) fn();
    was = status === 'connected';
    before ||= was;
  });
}

/**
 * The shared shape of every hook below: a value read from REST, kept
 * live by `poolse.live.subscribe`, with a mutation runner that takes the
 * server's answer as the new value.
 */
function useLiveValue<T>(
  conversationId: string | null,
  callId: string | null,
  load: (chat: Poolse, callId: string) => Promise<T>,
  listen: (set: (fn: (prev: T | null) => T | null) => void) => LiveMeetingsListeners,
  subscribeOpts: { selfUserId?: string | null } = {},
) {
  const chat = usePoolse();
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [pending, setPending] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  const listenRef = useRef(listen);
  listenRef.current = listen;
  const seq = useRef(0);
  const selfUserId = subscribeOpts.selfUserId ?? null;

  const refresh = useCallback(() => {
    if (!callId) return;
    const mine = ++seq.current;
    loadRef
      .current(chat, callId)
      .then((v) => {
        if (mine === seq.current) setValue(v);
      })
      .catch((err) => {
        if (mine === seq.current) setError(asError(err));
      });
  }, [chat, callId]);

  useEffect(() => {
    setValue(null);
    setError(null);
    if (!callId || !conversationId) return;
    refresh();
    const off = chat.live.subscribe(
      conversationId,
      callId,
      listenRef.current((fn) => {
        seq.current++; // newer than a read in flight
        setValue((prev) => fn(prev));
      }),
      selfUserId ? { selfUserId } : {},
    );
    const offStatus = onReconnect(chat, refresh);
    return () => {
      off();
      offStatus();
    };
  }, [chat, conversationId, callId, refresh, selfUserId]);

  const run = useCallback(
    async <R>(fn: () => Promise<R>, apply?: (r: R) => void): Promise<R | null> => {
      setPending(true);
      setError(null);
      try {
        const r = await fn();
        if (apply) {
          seq.current++;
          apply(r);
        }
        return r;
      } catch (err) {
        setError(asError(err));
        return null;
      } finally {
        setPending(false);
      }
    },
    [],
  );

  return { chat, value, setValue, error, pending, refresh, run };
}

// ── stage (CL3) ──────────────────────────────────────────────────────────

export interface UseStage {
  stage: StageState | null;
  /** Your role (`speaker` until the stage has loaded). */
  myRole: StageRole;
  isModerator: boolean;
  /** Your hand is up. */
  handRaised: boolean;
  roleOf: (userId: string) => StageRole;
  raiseHand: () => Promise<boolean>;
  /** Lower your hand, or (moderator) someone else's. */
  lowerHand: (userId?: string) => Promise<boolean>;
  /** Moderator: bring up (`speaker`), send back (`audience`), hand over (`moderator`). */
  setRole: (userId: string, role: StageRole) => Promise<boolean>;
  /** Moderator: turn stage mode on (`stage`) or off (`meeting`). */
  setMode: (mode: 'stage' | 'meeting') => Promise<boolean>;
  error: Error | null;
  pending: boolean;
}

/** Roles and raised hands in a call (CL3). */
export function useStage(
  conversationId: string | null,
  callId: string | null,
  selfUserId?: string | null,
): UseStage {
  const { chat, value, setValue, error, pending, run } = useLiveValue<StageState>(
    conversationId,
    callId,
    (c, id) => c.live.stage.get(id),
    (set) => ({ onStage: (s) => set(() => s) }),
    { selfUserId: selfUserId ?? null },
  );
  const ok = (r: unknown) => r !== null;
  const raiseHand = useCallback(
    async () => (callId ? ok(await run(() => chat.live.stage.raiseHand(callId), setValue)) : false),
    [chat, callId, run, setValue],
  );
  const lowerHand = useCallback(
    async (userId?: string) =>
      callId ? ok(await run(() => chat.live.stage.lowerHand(callId, userId), setValue)) : false,
    [chat, callId, run, setValue],
  );
  const setRole = useCallback(
    async (userId: string, role: StageRole) =>
      callId ? ok(await run(() => chat.live.stage.setRole(callId, userId, role), setValue)) : false,
    [chat, callId, run, setValue],
  );
  const setMode = useCallback(
    async (mode: 'stage' | 'meeting') =>
      callId ? ok(await run(() => chat.live.stage.setMode(callId, mode), setValue)) : false,
    [chat, callId, run, setValue],
  );
  const roleOf = useCallback((userId: string) => stageRoleOf(value, userId), [value]);
  const myRole = value?.myRole ?? 'speaker';
  return {
    stage: value,
    myRole,
    isModerator: myRole === 'moderator',
    handRaised: !!selfUserId && !!value?.hands.some((h) => h.userId === selfUserId),
    roleOf,
    raiseHand,
    lowerHand,
    setRole,
    setMode,
    error,
    pending,
  };
}

// ── Q&A (CL3) ────────────────────────────────────────────────────────────

export interface UseQuestions {
  /** Open by votes, then answered; dismissed ones left out. */
  questions: Question[];
  openCount: number;
  ask: (text: string, opts?: { anonymous?: boolean }) => Promise<boolean>;
  /** Vote, or take your vote back. */
  toggleVote: (questionId: string) => Promise<void>;
  setStatus: (questionId: string, status: QuestionStatus) => Promise<void>;
  error: Error | null;
  pending: boolean;
}

/** A call's Q&A with upvotes (CL3). Your own votes are kept across events, which don't carry them. */
export function useQuestions(conversationId: string | null, callId: string | null): UseQuestions {
  const mineVoted = useRef(new Set<string>());
  const merge = (list: Question[], q: Question): Question[] => {
    if (q.votedByMe) mineVoted.current.add(q.id);
    const withMine = { ...q, votedByMe: q.votedByMe || mineVoted.current.has(q.id) };
    const i = list.findIndex((x) => x.id === q.id);
    if (i < 0) return [...list, withMine];
    const next = list.slice();
    next[i] = withMine;
    return next;
  };
  const { chat, value, setValue, error, pending, run } = useLiveValue<Question[]>(
    conversationId,
    callId,
    async (c, id) => {
      const list = await c.live.questions.list(id);
      list.forEach((q) => q.votedByMe && mineVoted.current.add(q.id));
      return list;
    },
    (set) => ({
      onQuestion: (q) => set((prev) => merge(prev ?? [], q)),
      onQuestionDeleted: (id) => set((prev) => (prev ?? []).filter((q) => q.id !== id)),
    }),
  );
  const apply = useCallback(
    (q: Question) => setValue((prev) => merge(prev ?? [], q)),
    // merge only reads the ref.
    [setValue],
  );
  const ask = useCallback(
    async (text: string, opts?: { anonymous?: boolean }) => {
      if (!callId || !text.trim()) return false;
      return (await run(() => chat.live.questions.ask(callId, text, opts ?? {}), apply)) !== null;
    },
    [chat, callId, run, apply],
  );
  const toggleVote = useCallback(
    async (questionId: string) => {
      const voted = mineVoted.current.has(questionId);
      if (voted) mineVoted.current.delete(questionId);
      else mineVoted.current.add(questionId);
      const r = await run(
        () =>
          voted ? chat.live.questions.unvote(questionId) : chat.live.questions.vote(questionId),
        (q) => apply({ ...q, votedByMe: !voted }),
      );
      if (r === null) {
        if (voted) mineVoted.current.add(questionId);
        else mineVoted.current.delete(questionId);
      }
    },
    [chat, run, apply],
  );
  const setStatus = useCallback(
    async (questionId: string, status: QuestionStatus) => {
      await run(() => chat.live.questions.setStatus(questionId, status), apply);
    },
    [chat, run, apply],
  );
  const questions = useMemo(() => sortQuestions(value ?? []), [value]);
  return {
    questions,
    openCount: questions.filter((q) => q.status === 'open').length,
    ask,
    toggleVote,
    setStatus,
    error,
    pending,
  };
}

// ── breakouts (CL5) ──────────────────────────────────────────────────────

export interface UseBreakouts {
  session: BreakoutSession | null;
  /** Your assigned room, or null. */
  myRoom: BreakoutRoom | null;
  /** Seconds until the rooms end (or, while closing, until everyone is back); null without a timer. */
  secondsLeft: number | null;
  open: (plan: BreakoutPlan) => Promise<boolean>;
  close: (afterSeconds?: number) => Promise<boolean>;
  /** Join your room: the session to connect with. */
  join: (roomId: string) => Promise<RoomSession | null>;
  returnToMain: () => Promise<RoomSession | null>;
  error: Error | null;
  pending: boolean;
}

export interface UseBreakoutsOptions {
  /**
   * Follow the split by yourself (MEETINGS.md §5): when you get a room,
   * join it and hand its session to `onJoinRoom` (connect to it, then
   * leave the main room's media — don't hang up); when the split closes,
   * return and hand the main room's session to `onReturn`.
   */
  auto?: boolean;
  onJoinRoom?: (session: RoomSession, room: BreakoutRoom) => void;
  onReturn?: (session: RoomSession) => void;
}

/** Breakout rooms of a call (CL5), with a ticking countdown. */
export function useBreakouts(
  conversationId: string | null,
  callId: string | null,
  opts: UseBreakoutsOptions = {},
): UseBreakouts {
  const { chat, value, setValue, error, pending, run } = useLiveValue<BreakoutSession | null>(
    conversationId,
    callId,
    (c, id) => c.live.breakouts.get(id),
    (set) => ({ onBreakouts: (b) => set(() => (b.status === 'closed' ? null : b)) }),
  );
  const session = value ?? null;
  const [now, setNow] = useState(() => Date.now());
  const deadline = session?.status === 'closing' ? session.returnAt : session?.endsAt;
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [deadline]);
  const at = deadline ? Date.parse(deadline) : NaN;
  const secondsLeft = Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : null;

  const open = useCallback(
    async (plan: BreakoutPlan) =>
      callId ? (await run(() => chat.live.breakouts.open(callId, plan), setValue)) !== null : false,
    [chat, callId, run, setValue],
  );
  const close = useCallback(
    async (afterSeconds?: number) =>
      callId
        ? (await run(() => chat.live.breakouts.close(callId, afterSeconds), setValue)) !== null
        : false,
    [chat, callId, run, setValue],
  );
  const join = useCallback(
    (roomId: string) => run(() => chat.live.breakouts.join(roomId)),
    [chat, run],
  );
  const returnToMain = useCallback(
    () => (callId ? run(() => chat.live.breakouts.returnToMain(callId)) : Promise.resolve(null)),
    [chat, callId, run],
  );
  // Following the split: join the assigned room, come back on close.
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const inRoom = useRef<string | null>(null);
  const myRoomId = session?.status === 'open' ? session.myRoomId : null;
  useEffect(() => {
    if (!optsRef.current.auto || !callId) return;
    if (myRoomId && inRoom.current !== myRoomId) {
      const room = session?.rooms.find((r) => r.id === myRoomId);
      inRoom.current = myRoomId;
      void chat.live.breakouts
        .join(myRoomId)
        .then((s) => room && optsRef.current.onJoinRoom?.(s, room))
        .catch(() => {
          inRoom.current = null;
        });
    } else if (!session && inRoom.current) {
      inRoom.current = null;
      void chat.live.breakouts
        .returnToMain(callId)
        .then((s) => optsRef.current.onReturn?.(s))
        .catch(() => {});
    }
  }, [chat, callId, myRoomId, session]);

  return {
    session,
    myRoom: session?.rooms.find((r) => r.id === session.myRoomId) ?? null,
    secondsLeft,
    open,
    close,
    join,
    returnToMain,
    error,
    pending,
  };
}

// ── lobby (CL10) ─────────────────────────────────────────────────────────

export interface UseLobby {
  lobby: LobbyState | null;
  waitingCount: number;
  admit: (guestId: string) => Promise<boolean>;
  deny: (guestId: string) => Promise<boolean>;
  admitAll: () => Promise<boolean>;
  error: Error | null;
  pending: boolean;
}

/**
 * Who is waiting to be let in (CL10), for members. The lobby is the
 * conversation's: guests can wait before the call starts (`callId`
 * null), and an admitted guest joins once one is live.
 */
export function useLobby(conversationId: string | null, callId: string | null = null): UseLobby {
  const chat = usePoolse();
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [pending, setPending] = useState(false);
  const seq = useRef(0);
  const target = useMemo(
    () => (conversationId ? { conversationId, callId } : null),
    [conversationId, callId],
  );

  const refresh = useCallback(() => {
    if (!target) return;
    const mine = ++seq.current;
    chat.live.lobby
      .get(target)
      .then((l) => {
        if (mine === seq.current) setLobby(l);
      })
      .catch((err) => {
        if (mine === seq.current) setError(asError(err));
      });
  }, [chat, target]);

  useEffect(() => {
    setLobby(null);
    setError(null);
    if (!target) return;
    refresh();
    // Lobby events belong to the conversation: the call id doesn't filter them.
    const off = chat.live.subscribe(target.conversationId, target.callId ?? '', {
      onLobby: (l) => {
        seq.current++;
        setLobby(l);
      },
    });
    const offStatus = onReconnect(chat, refresh);
    return () => {
      off();
      offStatus();
    };
  }, [chat, target, refresh]);

  const act = useCallback(async (fn: () => Promise<LobbyState>) => {
    setPending(true);
    setError(null);
    try {
      const l = await fn();
      seq.current++;
      setLobby(l);
      return true;
    } catch (err) {
      setError(asError(err));
      return false;
    } finally {
      setPending(false);
    }
  }, []);
  const admit = useCallback(
    (id: string) =>
      target ? act(() => chat.live.lobby.admit(target, id)) : Promise.resolve(false),
    [chat, target, act],
  );
  const deny = useCallback(
    (id: string) => (target ? act(() => chat.live.lobby.deny(target, id)) : Promise.resolve(false)),
    [chat, target, act],
  );
  const admitAll = useCallback(
    () => (target ? act(() => chat.live.lobby.admitAll(target)) : Promise.resolve(false)),
    [chat, target, act],
  );
  return { lobby, waitingCount: lobby?.waiting.length ?? 0, admit, deny, admitAll, error, pending };
}

// ── moments (CL14) ───────────────────────────────────────────────────────

export interface UseMoments {
  moments: MarkedMoment[];
  mark: (note?: string) => Promise<MarkedMoment | null>;
  /** The moment you marked last, for a "Marked" confirmation. */
  lastMarked: MarkedMoment | null;
  error: Error | null;
  pending: boolean;
}

/** Mark a moment in a call (CL14). */
export function useMoments(conversationId: string | null, callId: string | null): UseMoments {
  const add = (list: MarkedMoment[] | null, m: MarkedMoment) =>
    (list ?? []).some((x) => x.id === m.id) ? (list ?? []) : [...(list ?? []), m];
  const { chat, value, setValue, error, pending, run } = useLiveValue<MarkedMoment[]>(
    conversationId,
    callId,
    (c, id) => c.live.moments.list(id),
    (set) => ({ onMoment: (m) => set((prev) => add(prev, m)) }),
  );
  const [lastMarked, setLast] = useState<MarkedMoment | null>(null);
  const mark = useCallback(
    async (note?: string) => {
      if (!callId) return null;
      const m = await run(
        () => chat.live.moments.mark(callId, note ? { note } : {}),
        (r) => setValue((prev) => add(prev, r)),
      );
      if (m) setLast(m);
      return m;
    },
    [chat, callId, run, setValue],
  );
  return { moments: value ?? [], mark, lastMarked, error, pending };
}

// ── agenda (CA5) ─────────────────────────────────────────────────────────

export interface UseAgenda {
  agenda: Agenda | null;
  current: AgendaItem | null;
  /** How far the current item is over its minutes (ms), ticking. */
  overrunMs: number;
  /** The server's last over-time nudge, cleared when the item changes. */
  overtime: { itemId: string; overByMs: number } | null;
  start: (itemId: string) => Promise<boolean>;
  done: (itemId: string) => Promise<boolean>;
  reopen: (itemId: string) => Promise<boolean>;
  error: Error | null;
  pending: boolean;
}

/** The agenda on a call (CA5): items checked off as they're covered, with an over-time nudge. */
export function useAgenda(conversationId: string | null, callId: string | null): UseAgenda {
  const [overtime, setOvertime] = useState<{ itemId: string; overByMs: number } | null>(null);
  const { chat, value, setValue, error, pending, run } = useLiveValue<Agenda | null>(
    conversationId,
    callId,
    (c, id) => c.live.agenda.get(id),
    (set) => ({
      onAgenda: (a) => set(() => a),
      onAgendaOvertime: (o) => setOvertime({ itemId: o.itemId, overByMs: o.overByMs }),
    }),
  );
  const agenda = value ?? null;
  const current = agenda?.items.find((i) => i.id === agenda.currentItemId) ?? null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!current?.minutes || current.status !== 'active') return;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [current?.id, current?.minutes, current?.status]);
  useEffect(() => {
    setOvertime((o) => (o && o.itemId !== current?.id ? null : o));
  }, [current?.id]);
  const act = useCallback(
    async (fn: () => Promise<Agenda>) => (await run(fn, setValue)) !== null,
    [run, setValue],
  );
  return {
    agenda,
    current,
    overrunMs: current ? agendaOverrunMs(current, now) : 0,
    overtime,
    start: useCallback(
      (id: string) =>
        callId ? act(() => chat.live.agenda.start(callId, id)) : Promise.resolve(false),
      [chat, callId, act],
    ),
    done: useCallback(
      (id: string) =>
        callId ? act(() => chat.live.agenda.done(callId, id)) : Promise.resolve(false),
      [chat, callId, act],
    ),
    reopen: useCallback(
      (id: string) =>
        callId ? act(() => chat.live.agenda.reopen(callId, id)) : Promise.resolve(false),
      [chat, callId, act],
    ),
    error,
    pending,
  };
}

// ── data channel: reactions (CL6) and annotations (CL4) ──────────────────

export interface UseCallReactions {
  /** Reactions on screen now, oldest first; each stays `visibleMs`. */
  reactions: CallReaction[];
  send: (emoji: string) => Promise<boolean>;
}

/** Reactions floating over a call (CL6). `room` is `useCallRoom(…).room`. */
export function useCallReactions(
  room: CallRoom | null,
  opts: { visibleMs?: number; max?: number } = {},
): UseCallReactions {
  const visibleMs = opts.visibleMs ?? 4000;
  const max = opts.max ?? 30;
  const [reactions, setReactions] = useState<CallReaction[]>([]);
  const ref = useRef<CallReactions | null>(null);
  useEffect(() => {
    setReactions([]);
    if (!room) return;
    const r = new CallReactions(room);
    ref.current = r;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const off = r.subscribe((reaction) => {
      setReactions((list) => [...list, reaction].slice(-max));
      const t = setTimeout(() => {
        timers.delete(t);
        setReactions((list) => list.filter((x) => x.id !== reaction.id));
      }, visibleMs);
      timers.add(t);
    });
    return () => {
      off();
      timers.forEach(clearTimeout);
      r.destroy();
      ref.current = null;
    };
  }, [room, visibleMs, max]);
  const send = useCallback(
    (emoji: string) => ref.current?.send(emoji) ?? Promise.resolve(false),
    [],
  );
  return { reactions, send };
}

export interface UseScreenAnnotations {
  state: AnnotationState | null;
  /** The live layer, to draw on (`begin` / `extend` / `end` / `pointer` / `clear`). */
  annotations: ScreenAnnotations | null;
}

/** The pointer and drawing layer over `sharerUserId`'s shared screen (CL4). */
export function useScreenAnnotations(
  room: CallRoom | null,
  sharerUserId: string | null,
  opts: { fadeMs?: number } = {},
): UseScreenAnnotations {
  const [state, setState] = useState<AnnotationState | null>(null);
  const [annotations, setAnnotations] = useState<ScreenAnnotations | null>(null);
  const fadeMs = opts.fadeMs;
  useEffect(() => {
    setState(null);
    setAnnotations(null);
    if (!room || !sharerUserId) return;
    const layer = new ScreenAnnotations(room, sharerUserId, fadeMs ? { fadeMs } : {});
    setAnnotations(layer);
    const off = layer.subscribe(setState);
    return () => {
      off();
      layer.destroy();
    };
  }, [room, sharerUserId, fadeMs]);
  return { state, annotations };
}

// ── call quality (CL15) ──────────────────────────────────────────────────

/**
 * Your own link in plain words, polled while mounted (CL15). null before
 * the first reading. With `callId` each change is also reported to the
 * server (`POST /calls/:id/quality`, throttled), which tells the others.
 */
export function useCallQuality(
  room: CallRoom | null,
  opts: { intervalMs?: number; callId?: string | null } = {},
): CallQualityReport | null {
  const chat = usePoolse();
  const [report, setReport] = useState<CallQualityReport | null>(null);
  const intervalMs = opts.intervalMs;
  const callId = opts.callId ?? null;
  useEffect(() => {
    setReport(null);
    if (!room) return;
    const monitor = new CallQualityMonitor(room, {
      ...(intervalMs ? { intervalMs } : {}),
      ...(callId ? { report: (body) => chat.live.quality.report(callId, body) } : {}),
    });
    const off = monitor.subscribe(setReport);
    return () => {
      off();
      monitor.stop();
    };
  }, [chat, room, intervalMs, callId]);
  return report;
}

// ── the call's meeting snapshot, captions (CL13) ─────────────────────────

export interface UseCallMeeting {
  meeting: CallMeeting | null;
  /** Guests and phones in the call, named. */
  attendees: MeetingAttendee[];
  /** Everyone's reported link, by identity. */
  quality: Record<string, ParticipantQuality>;
  /**
   * A name for any identity in the call: a guest's or phone's from the
   * roster, a member's from `nameFor`, else null — never the id.
   */
  nameOf: (
    identity: string,
    nameFor?: (userId: string) => string | null | undefined,
  ) => string | null;
  refresh: () => void;
}

/** The call snapshot's `meeting` (GET /calls/:id/meeting), kept live by its events. */
export function useCallMeeting(
  conversationId: string | null,
  callId: string | null,
): UseCallMeeting {
  const { value, refresh } = useLiveValue<CallMeeting>(
    conversationId,
    callId,
    (c, id) => c.live.meeting(id),
    (set) => ({
      onAttendees: (attendees) => set((m) => (m ? { ...m, attendees } : m)),
      onQuality: (q) => set((m) => (m ? { ...m, quality: { ...m.quality, [q.identity]: q } } : m)),
      onCaptions: (c) => set((m) => (m ? { ...m, captionsUserIds: c.userIds } : m)),
      onBreakouts: (b) =>
        set((m) => (m ? { ...m, breakout: b.status === 'closed' ? null : b } : m)),
      onLobby: (l) => set((m) => (m ? { ...m, lobbyWaiting: l.waiting.length } : m)),
      onStage: (s) =>
        set((m) => (m ? { ...m, stage: s.mode === 'stage', roles: s.roles, hands: s.hands } : m)),
    }),
  );
  const attendees = useMemo(() => value?.attendees ?? [], [value]);
  const nameOf = useCallback(
    (identity: string, nameFor?: (userId: string) => string | null | undefined) => {
      const a = attendees.find((x) => x.identity === identity);
      if (a) return a.name;
      return meetingNameOf(identity, nameFor?.(identity) ?? null);
    },
    [attendees],
  );
  return { meeting: value, attendees, quality: value?.quality ?? {}, nameOf, refresh };
}

export interface UseCaptions {
  /** Your captions are on. */
  on: boolean;
  /** Who has captions on. */
  userIds: string[];
  setOn: (on: boolean) => Promise<boolean>;
  toggle: () => Promise<boolean>;
  error: Error | null;
  pending: boolean;
}

/**
 * Your captions toggle (CL13): `PUT /calls/:id/captions`. While anyone
 * has them on a live transcript runs — show it with `useLiveTranscript`
 * and `CaptionsOverlay`. Errors: `captions_disabled`,
 * `transcription_unavailable`, `transcript_stopped`.
 */
export function useCaptions(
  conversationId: string | null,
  callId: string | null,
  selfUserId: string | null | undefined,
): UseCaptions {
  const { chat, value, setValue, error, pending, run } = useLiveValue<string[]>(
    conversationId,
    callId,
    async (c, id) => (await c.live.meeting(id)).captionsUserIds,
    (set) => ({ onCaptions: (cap) => set(() => cap.userIds) }),
  );
  const userIds = useMemo(() => value ?? [], [value]);
  const on = !!selfUserId && userIds.includes(selfUserId);
  const setOn = useCallback(
    async (next: boolean) => {
      if (!callId) return false;
      const r = await run(
        () => chat.live.captions.set(callId, next),
        (cap) => setValue(() => cap.userIds),
      );
      return r !== null;
    },
    [chat, callId, run, setValue],
  );
  const toggle = useCallback(() => setOn(!on), [setOn, on]);
  return { on, userIds, setOn, toggle, error, pending };
}

// ── whiteboard (CL12) ────────────────────────────────────────────────────

export interface UseWhiteboard {
  items: WhiteboardItem[];
  /** The board to draw on; null while opening. */
  model: WhiteboardModel | null;
  readOnly: boolean;
  error: Error | null;
}

/**
 * A call's whiteboard (CL12) over the doc relay. `Y` is `yjs`, imported
 * by your app (`import * as Y from 'yjs'`); `access` defaults to
 * `poolse.live.whiteboard(callId)`.
 */
export function useWhiteboard(
  callId: string | null,
  Y: YjsModule | null,
  opts: { selfUserId?: string | null; access?: (callId: string) => Promise<WhiteboardAccess> } = {},
): UseWhiteboard {
  const chat = usePoolse();
  const [items, setItems] = useState<WhiteboardItem[]>([]);
  const [board, setBoard] = useState<OpenWhiteboard | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const selfUserId = opts.selfUserId ?? null;
  useEffect(() => {
    setItems([]);
    setBoard(null);
    setError(null);
    if (!callId || !Y) return;
    let cancelled = false;
    let open: OpenWhiteboard | null = null;
    let off: (() => void) | null = null;
    const access = () => optsRef.current.access?.(callId) ?? chat.live.whiteboard(callId);
    access()
      .then((a) => {
        if (cancelled) return;
        open = openWhiteboard(chat, Y, a, { selfUserId, refreshAccess: access });
        off = open.model.subscribe(setItems);
        setBoard(open);
      })
      .catch((err) => {
        if (!cancelled) setError(asError(err));
      });
    return () => {
      cancelled = true;
      off?.();
      open?.close();
    };
  }, [chat, callId, Y, selfUserId]);
  return { items, model: board?.model ?? null, readOnly: board ? board.readOnly() : true, error };
}

// ── room presence (CL2) ──────────────────────────────────────────────────

export interface UseRoomPresence {
  /** Your rooms by name (`GET /me/rooms`), each with who's in. */
  rooms: MyRoom[];
  /** Conversation id → who's in (drop-in calls anywhere you're a member, rooms or huddles). */
  presence: Record<string, RoomPresenceEntry>;
  refresh: () => void;
}

/**
 * Who is in each room right now, for a sidebar (CL2): reads
 * `GET /me/rooms`, then follows `room:participants` on your user topic
 * (every drop-in call of every conversation you're in — no conversation
 * needs to be open). Re-reads after a reconnect.
 */
export function useRoomPresence(): UseRoomPresence {
  const chat = usePoolse();
  const { me } = useMe();
  const meId = me?.id ?? null;
  const [rooms, setRooms] = useState<MyRoom[]>([]);
  const [presence, setPresence] = useState<Record<string, RoomPresenceEntry>>({});
  const refresh = useCallback(() => {
    chat.live
      .rooms()
      .then((list) => {
        setRooms(list);
        setPresence((p) => {
          const next = { ...p };
          for (const r of list) next[r.conversationId] = r.presence;
          return next;
        });
      })
      .catch(() => {});
  }, [chat]);
  useEffect(() => {
    if (!meId) return;
    refresh();
    const off = chat.live.subscribeUser(meId, {
      onRoomParticipants: (r) => {
        setPresence((p) => ({ ...p, [r.conversationId]: r }));
        setRooms((list) =>
          list.map((room) =>
            room.conversationId === r.conversationId ? { ...room, presence: r } : room,
          ),
        );
      },
    });
    const offStatus = onReconnect(chat, refresh);
    return () => {
      off();
      offStatus();
    };
  }, [chat, meId, refresh]);
  return { rooms, presence, refresh };
}
