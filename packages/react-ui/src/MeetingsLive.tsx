// During the call: the stage and raised hands (CL3), Q&A (CL3), breakout
// rooms (CL5), the in-call chat and reactions (CL6), the background and
// noise menu (CL7), the lobby (CL10), "move the call here" (CL11),
// captions (CL13), mark a moment (CL14), connection quality (CL15), who
// is in a room (CL2) and the agenda (CA5). Each piece takes the matching
// @poolse/react hook's result, so the host decides where it goes:
//
//     const media = useCallRoom(conversationId, { livekit, trackProcessors });
//     const stage = useStage(conversationId, callId, me.id);
//     <StagePanel stage={stage} participants={media.participants} />
//     <ReactionsOverlay reactions={useCallReactions(media.room).reactions} />
//     <NetworkBanner report={useCallQuality(media.room)} />
//
// Names: every list resolves a poolse user id through `nameFor` (or the
// call's participants), never shows the id itself, and falls back to
// "Someone".

import type {
  UseAgenda,
  UseBreakouts,
  UseCallReactions,
  UseLiveTranscript,
  UseLobby,
  UseMoments,
  UseQuestions,
  UseStage,
} from '@poolse/react';
import { formatClock } from '@poolse/react';
import type {
  CallBackground,
  CallConnectionQuality,
  CallNetworkIssue,
  CallParticipant,
  CallQualityReport,
  CallReaction,
  GuestLobbyStatus,
  LiveCall,
  Question,
  StageRole,
} from '@poolse/sdk';
import {
  DEFAULT_CALL_REACTIONS,
  QUESTION_MAX,
  connectionQualityLabel,
  planBreakouts,
} from '@poolse/sdk';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { Avatar } from './Avatar.js';
import { CallControlButton } from './CallControls.js';
import { ConversationView } from './ConversationView.js';
import { PoolseIcon } from './PoolseIcon.js';

/** Resolves a poolse user id to a name. */
export type NameFor = (userId: string) => string | null | undefined;

function useNames(nameFor?: NameFor, participants?: readonly CallParticipant[]) {
  return useMemo(() => {
    const fromCall = new Map((participants ?? []).map((p) => [p.userId, p.name ?? null]));
    return (userId: string): string => nameFor?.(userId) || fromCall.get(userId) || 'Someone';
  }, [nameFor, participants]);
}

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

// ── stage (CL3) ──────────────────────────────────────────────────────────

export interface StagePanelProps {
  stage: UseStage;
  /** Who is in the call now (`useCallRoom().participants`) — everyone listed is here. */
  participants: readonly CallParticipant[];
  nameFor?: NameFor;
  className?: string;
}

/**
 * Speakers and audience, raised hands oldest first, your own hand
 * button; moderators bring people up, send them back and lower hands.
 * In a `meeting`-mode call (no audience) it shows only raised hands.
 */
export function StagePanel({ stage, participants, nameFor, className }: StagePanelProps) {
  const name = useNames(nameFor, participants);
  const s = stage.stage;
  const groups = useMemo(() => {
    const out: Record<StageRole, CallParticipant[]> = { moderator: [], speaker: [], audience: [] };
    for (const p of participants) out[stage.roleOf(p.userId)].push(p);
    return out;
  }, [participants, stage]);
  const hands = s?.hands ?? [];
  const isStage = s?.mode === 'stage';
  const mod = stage.isModerator;

  const person = (p: CallParticipant, actions: ReactNode) => (
    <li key={p.userId} className="poolse-stage__person">
      <Avatar name={name(p.userId)} size="sm" />
      <span className="poolse-stage__name" title={name(p.userId)}>
        {name(p.userId)}
        {p.isSelf ? <span className="poolse-stage__you"> (you)</span> : null}
      </span>
      {hands.some((h) => h.userId === p.userId) ? (
        <span className="poolse-stage__hand" role="img" aria-label="Hand raised">
          ✋
        </span>
      ) : null}
      {mod && !p.isSelf ? <span className="poolse-stage__actions">{actions}</span> : null}
    </li>
  );

  return (
    <section className={cx('poolse-panel', 'poolse-stage', className)} aria-label="Stage">
      <div className="poolse-panel__head">
        <h3 className="poolse-panel__title">{isStage ? 'Stage' : 'People'}</h3>
        {stage.myRole === 'audience' || !isStage ? (
          <button
            type="button"
            className={cx('poolse-btn', stage.handRaised && 'poolse-btn--active')}
            aria-pressed={stage.handRaised}
            disabled={stage.pending}
            onClick={() => void (stage.handRaised ? stage.lowerHand() : stage.raiseHand())}
          >
            ✋ {stage.handRaised ? 'Lower hand' : 'Raise hand'}
          </button>
        ) : null}
      </div>

      {hands.length > 0 ? (
        <div className="poolse-stage__group">
          <h4 className="poolse-stage__label">Raised hands · {hands.length}</h4>
          <ol className="poolse-stage__list">
            {hands.map((h) => (
              <li key={h.userId} className="poolse-stage__person">
                <span className="poolse-stage__name" title={name(h.userId)}>
                  {name(h.userId)}
                </span>
                {mod ? (
                  <span className="poolse-stage__actions">
                    {isStage && stage.roleOf(h.userId) === 'audience' ? (
                      <button
                        type="button"
                        className="poolse-btn poolse-btn--brand"
                        onClick={() => void stage.setRole(h.userId, 'speaker')}
                      >
                        Bring up
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="poolse-btn"
                      onClick={() => void stage.lowerHand(h.userId)}
                    >
                      Lower
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {isStage ? (
        <>
          <div className="poolse-stage__group">
            <h4 className="poolse-stage__label">
              On stage · {groups.moderator.length + groups.speaker.length}
            </h4>
            <ul className="poolse-stage__list">
              {[...groups.moderator, ...groups.speaker].map((p) =>
                person(
                  p,
                  stage.roleOf(p.userId) === 'speaker' ? (
                    <button
                      type="button"
                      className="poolse-btn"
                      onClick={() => void stage.setRole(p.userId, 'audience')}
                    >
                      Move to audience
                    </button>
                  ) : null,
                ),
              )}
            </ul>
          </div>
          <div className="poolse-stage__group">
            <h4 className="poolse-stage__label">Audience · {groups.audience.length}</h4>
            <ul className="poolse-stage__list">
              {groups.audience.map((p) =>
                person(
                  p,
                  <button
                    type="button"
                    className="poolse-btn"
                    onClick={() => void stage.setRole(p.userId, 'speaker')}
                  >
                    Bring up
                  </button>,
                ),
              )}
            </ul>
          </div>
        </>
      ) : null}
      {stage.error ? (
        <p className="poolse-panel__error" role="alert">
          {stage.error.message}
        </p>
      ) : null}
    </section>
  );
}

// ── Q&A (CL3) ────────────────────────────────────────────────────────────

export interface QuestionsPanelProps {
  questions: UseQuestions;
  /** Moderators mark questions answered or dismiss them. */
  canModerate?: boolean;
  /** Offer asking anonymously. Defaults to true. */
  allowAnonymous?: boolean;
  nameFor?: NameFor;
  className?: string;
}

/** Ask, upvote and (moderators) answer questions, most voted first. */
export function QuestionsPanel({
  questions,
  canModerate = false,
  allowAnonymous = true,
  nameFor,
  className,
}: QuestionsPanelProps) {
  const name = useNames(nameFor);
  const [text, setText] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const submit = async () => {
    if (await questions.ask(text, { anonymous })) setText('');
  };
  const author = (q: Question) =>
    q.author ? q.author.displayName || name(q.author.userId) : 'Anonymous';

  return (
    <section className={cx('poolse-panel', 'poolse-qa', className)} aria-label="Questions">
      <div className="poolse-panel__head">
        <h3 className="poolse-panel__title">Q&amp;A</h3>
        <span className="poolse-panel__meta">{questions.openCount} open</span>
      </div>
      <form
        className="poolse-qa__ask"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          className="poolse-qa__input"
          value={text}
          maxLength={QUESTION_MAX}
          rows={2}
          placeholder="Ask a question"
          aria-label="Your question"
          onChange={(e) => setText(e.target.value)}
        />
        <div className="poolse-qa__row">
          {allowAnonymous ? (
            <label className="poolse-qa__anon">
              <input
                type="checkbox"
                checked={anonymous}
                onChange={(e) => setAnonymous(e.target.checked)}
              />{' '}
              Ask anonymously
            </label>
          ) : null}
          <button
            type="submit"
            className="poolse-btn poolse-btn--brand"
            disabled={!text.trim() || questions.pending}
          >
            Ask
          </button>
        </div>
      </form>
      {questions.questions.length === 0 ? (
        <p className="poolse-panel__empty">No questions yet. Ask the first one.</p>
      ) : (
        <ul className="poolse-qa__list">
          {questions.questions.map((q) => (
            <li
              key={q.id}
              className={cx('poolse-qa__item', q.status === 'answered' && 'poolse-qa__item--done')}
            >
              <button
                type="button"
                className={cx('poolse-qa__vote', q.votedByMe && 'poolse-qa__vote--on')}
                aria-pressed={q.votedByMe}
                aria-label={`${q.votedByMe ? 'Remove your vote' : 'Vote'} · ${q.votes} ${q.votes === 1 ? 'vote' : 'votes'}`}
                disabled={q.status !== 'open'}
                onClick={() => void questions.toggleVote(q.id)}
              >
                <PoolseIcon name="chevron-up" size={14} label={null} />
                <span>{q.votes}</span>
              </button>
              <div className="poolse-qa__body">
                <p className="poolse-qa__text">{q.text}</p>
                <p className="poolse-qa__by">
                  {author(q)}
                  {q.status === 'answered' ? ' · Answered' : ''}
                </p>
              </div>
              {canModerate && q.status === 'open' ? (
                <span className="poolse-qa__mod">
                  <button
                    type="button"
                    className="poolse-btn"
                    onClick={() => void questions.setStatus(q.id, 'answered')}
                  >
                    Answered
                  </button>
                  <button
                    type="button"
                    className="poolse-btn poolse-btn--quiet"
                    onClick={() => void questions.setStatus(q.id, 'dismissed')}
                  >
                    Dismiss
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {questions.error ? (
        <p className="poolse-panel__error" role="alert">
          {questions.error.message}
        </p>
      ) : null}
    </section>
  );
}

// ── breakouts (CL5) ──────────────────────────────────────────────────────

export interface BreakoutBannerProps {
  breakouts: UseBreakouts;
  /** Connect to your room's session (`breakouts.join` resolved). */
  onJoinRoom?: (roomId: string) => void;
  /** Back to the main call. */
  onReturn?: () => void;
  /** You are in your breakout room right now (hides Join, shows Return). */
  inRoom?: boolean;
  className?: string;
}

/**
 * "You're in Room 2 · 4:59 left · Join room" while breakouts run;
 * "Returning to the main call in 0:45" while they close. Nothing when
 * none are open or you are not assigned.
 */
export function BreakoutBanner({
  breakouts,
  onJoinRoom,
  onReturn,
  inRoom = false,
  className,
}: BreakoutBannerProps) {
  const { session, myRoom, secondsLeft } = breakouts;
  if (!session || (!myRoom && session.status !== 'closing')) return null;
  const left = secondsLeft === null ? null : formatClock(secondsLeft * 1000);
  const closing = session.status === 'closing';
  return (
    <div className={cx('poolse-roombar', 'poolse-breakout', className)} role="status">
      <span className="poolse-roombar__text">
        {closing ? (
          <strong>Returning to the main call{left ? ` in ${left}` : ''}</strong>
        ) : (
          <>
            <strong className="poolse-breakout__room" title={myRoom!.name}>
              {inRoom ? myRoom!.name : `You're in ${myRoom!.name}`}
            </strong>
            {left ? <span> · {left} left</span> : null}
          </>
        )}
      </span>
      <span className="poolse-roombar__actions">
        {!inRoom && myRoom && !closing ? (
          <button
            type="button"
            className="poolse-roombar__btn poolse-roombar__btn--primary"
            onClick={() => onJoinRoom?.(myRoom.id)}
          >
            Join room
          </button>
        ) : null}
        {inRoom ? (
          <button type="button" className="poolse-roombar__btn" onClick={() => onReturn?.()}>
            Return to main call
          </button>
        ) : null}
      </span>
    </div>
  );
}

export interface BreakoutHostPanelProps {
  breakouts: UseBreakouts;
  /** Who can be split (everyone in the call but you, usually). */
  userIds: readonly string[];
  nameFor?: NameFor;
  className?: string;
}

/**
 * The host's breakout controls: how many rooms and for how long, a
 * preview of who goes where, Open; then the room list with who is in
 * each, and "Bring everyone back".
 */
export function BreakoutHostPanel({
  breakouts,
  userIds,
  nameFor,
  className,
}: BreakoutHostPanelProps) {
  const name = useNames(nameFor);
  const [count, setCount] = useState(2);
  const [minutes, setMinutes] = useState(10);
  const plan = useMemo(() => planBreakouts(userIds, count), [userIds, count]);
  const s = breakouts.session;
  return (
    <section
      className={cx('poolse-panel', 'poolse-breakouts', className)}
      aria-label="Breakout rooms"
    >
      <div className="poolse-panel__head">
        <h3 className="poolse-panel__title">Breakout rooms</h3>
        {s && breakouts.secondsLeft !== null ? (
          <span className="poolse-panel__meta">
            {formatClock(breakouts.secondsLeft * 1000)} left
          </span>
        ) : null}
      </div>
      {!s ? (
        <>
          <div className="poolse-breakouts__form">
            <label>
              Rooms{' '}
              <input
                type="number"
                min={1}
                max={Math.max(1, userIds.length)}
                value={count}
                onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
              />
            </label>
            <label>
              Minutes{' '}
              <input
                type="number"
                min={1}
                max={240}
                value={minutes}
                onChange={(e) => setMinutes(Math.max(1, Number(e.target.value) || 1))}
              />
            </label>
          </div>
          <ul className="poolse-breakouts__rooms">
            {plan.map((r) => (
              <li key={r.name}>
                <strong>{r.name}</strong>
                <span className="poolse-breakouts__people">
                  {r.userIds.length ? r.userIds.map(name).join(', ') : 'Nobody yet'}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="poolse-btn poolse-btn--brand"
            disabled={userIds.length === 0 || breakouts.pending}
            onClick={() => void breakouts.open({ rooms: plan, durationMinutes: minutes })}
          >
            Open {plan.length === 1 ? 'room' : `${plan.length} rooms`}
          </button>
        </>
      ) : (
        <>
          <ul className="poolse-breakouts__rooms">
            {s.rooms.map((r) => (
              <li key={r.id}>
                <strong title={r.name}>{r.name}</strong>
                <span className="poolse-breakouts__people">
                  {r.participants.length} of {r.userIds.length} joined
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="poolse-btn poolse-btn--brand"
            disabled={s.status === 'closing' || breakouts.pending}
            onClick={() => void breakouts.close()}
          >
            {s.status === 'closing' ? 'Bringing everyone back…' : 'Bring everyone back'}
          </button>
        </>
      )}
      {breakouts.error ? (
        <p className="poolse-panel__error" role="alert">
          {breakouts.error.message}
        </p>
      ) : null}
    </section>
  );
}

// ── lobby (CL10) ─────────────────────────────────────────────────────────

export interface LobbyWaitingProps {
  /** From `waitInLobby`'s `onStatus`. */
  status: GuestLobbyStatus['status'];
  /** The name the guest typed. */
  name?: string | null;
  meetingTitle?: string | null;
  onLeave?: () => void;
  /** Camera preview or anything else to show while waiting. */
  children?: ReactNode;
  className?: string;
}

/** The guest's waiting screen: "Waiting for the host to let you in". */
export function LobbyWaiting({
  status,
  name,
  meetingTitle,
  onLeave,
  children,
  className,
}: LobbyWaitingProps) {
  const text =
    status === 'denied'
      ? { title: 'You weren’t let in', detail: 'The host declined your request to join.' }
      : status === 'ended'
        ? { title: 'This meeting has ended', detail: 'You can close this page.' }
        : status === 'admitted'
          ? { title: 'You’re in', detail: 'Joining the call…' }
          : {
              title: 'Waiting for the host to let you in',
              detail: 'Stay on this page. You’ll join as soon as someone admits you.',
            };
  return (
    <section className={cx('poolse-lobby', className)} aria-live="polite">
      {meetingTitle ? (
        <p className="poolse-lobby__meeting" title={meetingTitle}>
          {meetingTitle}
        </p>
      ) : null}
      <h2 className="poolse-lobby__title">{text.title}</h2>
      <p className="poolse-lobby__detail">{text.detail}</p>
      {status === 'waiting' ? <span className="poolse-lobby__spinner" aria-hidden="true" /> : null}
      {children}
      {name ? (
        <p className="poolse-lobby__name" title={name}>
          Joining as <strong>{name}</strong>
        </p>
      ) : null}
      {onLeave && status === 'waiting' ? (
        <button type="button" className="poolse-btn" onClick={onLeave}>
          Leave
        </button>
      ) : null}
    </section>
  );
}

export interface LobbyAdmitListProps {
  lobby: UseLobby;
  className?: string;
}

/** Members' view of the lobby: who is waiting, with Admit and Deny. Nothing when nobody waits. */
export function LobbyAdmitList({ lobby, className }: LobbyAdmitListProps) {
  const waiting = lobby.lobby?.waiting ?? [];
  if (waiting.length === 0) return null;
  return (
    <section
      className={cx('poolse-panel', 'poolse-lobby-admit', className)}
      aria-label="Waiting to join"
    >
      <div className="poolse-panel__head">
        <h3 className="poolse-panel__title">Waiting to join · {waiting.length}</h3>
        {waiting.length > 1 ? (
          <button
            type="button"
            className="poolse-btn"
            disabled={lobby.pending}
            onClick={() => void lobby.admitAll()}
          >
            Admit all
          </button>
        ) : null}
      </div>
      <ul className="poolse-stage__list">
        {waiting.map((e) => (
          <li key={e.id} className="poolse-stage__person">
            <Avatar name={e.name} size="sm" />
            <span className="poolse-stage__name" title={e.name}>
              {e.name}
              {e.guest ? <span className="poolse-guest-badge">Guest</span> : null}
            </span>
            <span className="poolse-stage__actions">
              <button
                type="button"
                className="poolse-btn poolse-btn--brand"
                disabled={lobby.pending}
                onClick={() => void lobby.admit(e.id)}
              >
                Admit
              </button>
              <button
                type="button"
                className="poolse-btn poolse-btn--quiet"
                disabled={lobby.pending}
                onClick={() => void lobby.deny(e.id)}
              >
                Deny
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── captions (CL13) ──────────────────────────────────────────────────────

export interface CaptionsOverlayProps {
  /** `useLiveTranscript(callId)` — captions are the live transcript. */
  transcript: Pick<UseLiveTranscript, 'segments' | 'live'>;
  /** How many lines to show. Defaults to 2. */
  lines?: number;
  className?: string;
}

/** The last few lines of the live transcript over the call, speaker first. */
export function CaptionsOverlay({ transcript, lines = 2, className }: CaptionsOverlayProps) {
  const shown = transcript.segments.slice(-lines);
  if (!transcript.live && shown.length === 0) return null;
  return (
    <div className={cx('poolse-captions', className)} aria-live="polite" aria-label="Captions">
      {shown.length === 0 ? (
        <p className="poolse-captions__line poolse-captions__line--wait">Captions are on</p>
      ) : (
        shown.map((s, i) => (
          <p
            key={`${s.speaker}-${s.start_ms}-${i}`}
            className={cx('poolse-captions__line', !s.final && 'poolse-captions__line--interim')}
          >
            {s.speaker_name ? <strong>{s.speaker_name}: </strong> : null}
            {s.text}
          </p>
        ))
      )}
    </div>
  );
}

// ── mark a moment (CL14) ─────────────────────────────────────────────────

export interface MarkMomentButtonProps {
  moments: UseMoments;
}

/**
 * "Mark": tap when something important is said; that moment is
 * highlighted in the recording and the summary. Shows "Marked" for a
 * moment after. A round call control, to sit with the others.
 */
export function MarkMomentButton({ moments }: MarkMomentButtonProps) {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(false), 1800);
    return () => clearTimeout(t);
  }, [flash]);
  return (
    <CallControlButton
      icon={flash ? 'check' : 'pin'}
      label={flash ? 'Marked' : 'Mark moment'}
      highlight={flash}
      disabled={moments.pending}
      onClick={() => {
        void moments.mark().then((m) => m && setFlash(true));
      }}
    />
  );
}

// ── quality (CL15) ───────────────────────────────────────────────────────

export interface ConnectionIndicatorProps {
  quality: CallConnectionQuality | 'good' | 'poor' | 'lost' | 'unknown' | undefined;
  className?: string;
}

const BARS: Record<string, number> = { excellent: 3, good: 2, poor: 1, lost: 0, unknown: 0 };

/** Three signal bars for one person's link; a label for screen readers and the tooltip. */
export function ConnectionIndicator({ quality, className }: ConnectionIndicatorProps) {
  const q = quality ?? 'unknown';
  const n = BARS[q] ?? 0;
  const label = connectionQualityLabel(q as CallConnectionQuality);
  return (
    <span
      className={cx('poolse-signal', `poolse-signal--${q}`, className)}
      role="img"
      aria-label={label}
      title={label}
    >
      {[1, 2, 3].map((i) => (
        <span key={i} className={cx('poolse-signal__bar', i <= n && 'poolse-signal__bar--on')} />
      ))}
    </span>
  );
}

export interface NetworkBannerProps {
  /** `useCallQuality(room)`, or issues of your own (`diagnoseCallNetwork`). */
  report?: CallQualityReport | null;
  issues?: readonly CallNetworkIssue[];
  /** Let the person hide the current warning (it comes back when it changes). */
  dismissible?: boolean;
  className?: string;
}

/** "Your network is dropping packets — others may hear you break up." Nothing while all is well. */
export function NetworkBanner({
  report,
  issues,
  dismissible = true,
  className,
}: NetworkBannerProps) {
  const top = (issues ?? report?.issues ?? [])[0] ?? null;
  const [hidden, setHidden] = useState<string | null>(null);
  if (!top || hidden === top.kind) return null;
  return (
    <div
      className={cx('poolse-netbanner', `poolse-netbanner--${top.severity}`, className)}
      role={top.severity === 'error' ? 'alert' : 'status'}
    >
      <PoolseIcon name="info" size={16} label={null} />
      <span className="poolse-netbanner__text">
        <strong>{top.title}</strong> <span>{top.detail}</span>
      </span>
      {dismissible && top.severity === 'warning' ? (
        <button
          type="button"
          className="poolse-netbanner__close"
          aria-label="Dismiss"
          onClick={() => setHidden(top.kind)}
        >
          <PoolseIcon name="close" size={14} label={null} />
        </button>
      ) : null}
    </div>
  );
}

// ── room presence (CL2) ──────────────────────────────────────────────────

export interface RoomPresenceProps {
  /** `useRoomPresence(ids)[conversationId]` or `useLiveCall(id).call`. */
  call: LiveCall | null | undefined;
  /** Avatars before "+N". Defaults to 3. */
  max?: number;
  className?: string;
}

/** Who's in a room, for a sidebar row: a few faces and the count. Nothing when empty. */
export function RoomPresence({ call, max = 3, className }: RoomPresenceProps) {
  const people = call?.state === 'live' ? call.participants : [];
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const label = `${people.length} in the room: ${people
    .map((p) => p.display_name || 'Someone')
    .join(', ')}`;
  return (
    <span
      className={cx('poolse-roompresence', className)}
      role="img"
      aria-label={label}
      title={label}
    >
      <span className="poolse-roompresence__faces" aria-hidden="true">
        {shown.map((p) => (
          <Avatar key={p.user_id} name={p.display_name || 'Someone'} size="xs" />
        ))}
        {people.length > max ? (
          <span className="poolse-roompresence__more">+{people.length - max}</span>
        ) : null}
      </span>
    </span>
  );
}

// ── agenda (CA5) ─────────────────────────────────────────────────────────

export interface AgendaPanelProps {
  agenda: UseAgenda;
  /** May check items off (the organizer, or everyone). Defaults to true. */
  canEdit?: boolean;
  nameFor?: NameFor;
  className?: string;
}

/** The meeting's agenda during the call: the current item highlighted, check items off, an over-time nudge. */
export function AgendaPanel({ agenda, canEdit = true, nameFor, className }: AgendaPanelProps) {
  const name = useNames(nameFor);
  const a = agenda.agenda;
  if (!a || a.items.length === 0) return null;
  const over = Math.max(agenda.overrunMs, agenda.overtime?.overByMs ?? 0);
  const overMin = Math.ceil(over / 60_000);
  return (
    <section className={cx('poolse-panel', 'poolse-agenda', className)} aria-label="Agenda">
      <div className="poolse-panel__head">
        <h3 className="poolse-panel__title">Agenda</h3>
        <span className="poolse-panel__meta">
          {a.items.filter((i) => i.status === 'done').length} of {a.items.length} done
        </span>
      </div>
      {agenda.current && over > 0 ? (
        <p className="poolse-agenda__nudge" role="status">
          {agenda.current.title} is {overMin} min over
        </p>
      ) : null}
      <ol className="poolse-agenda__list">
        {a.items.map((item) => (
          <li
            key={item.id}
            className={cx(
              'poolse-agenda__item',
              item.id === a.currentItemId && 'poolse-agenda__item--current',
              item.status === 'done' && 'poolse-agenda__item--done',
            )}
            aria-current={item.id === a.currentItemId ? 'step' : undefined}
          >
            <input
              type="checkbox"
              className="poolse-agenda__check"
              checked={item.status === 'done'}
              disabled={!canEdit || agenda.pending}
              aria-label={`${item.title}: ${item.status === 'done' ? 'done' : 'not done'}`}
              onChange={() =>
                void (item.status === 'done' ? agenda.reopen(item.id) : agenda.done(item.id))
              }
            />
            <span className="poolse-agenda__body">
              <span className="poolse-agenda__title" title={item.title}>
                {item.title}
              </span>
              <span className="poolse-agenda__meta">
                {[
                  item.owner ? item.owner.displayName || name(item.owner.userId) : null,
                  item.minutes ? `${item.minutes} min` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            {canEdit && item.status === 'pending' && item.id !== a.currentItemId ? (
              <button
                type="button"
                className="poolse-btn poolse-btn--quiet"
                onClick={() => void agenda.start(item.id)}
              >
                Start
              </button>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ── reactions and chat (CL6) ─────────────────────────────────────────────

export interface ReactionsOverlayProps {
  reactions: readonly CallReaction[];
  nameFor?: NameFor;
  className?: string;
}

/** Emoji floating up over the call, with who sent them. Decorative: hidden from screen readers. */
export function ReactionsOverlay({ reactions, nameFor, className }: ReactionsOverlayProps) {
  const name = useNames(nameFor);
  return (
    <div className={cx('poolse-reactfloat', className)} aria-hidden="true">
      {reactions.map((r, i) => (
        <span
          key={r.id}
          className="poolse-reactfloat__item"
          style={{ left: `${10 + ((i * 37) % 70)}%` }}
        >
          <span className="poolse-reactfloat__emoji">{r.emoji}</span>
          <span className="poolse-reactfloat__who">
            {r.isSelf ? 'You' : r.name || (r.userId ? name(r.userId) : 'Someone')}
          </span>
        </span>
      ))}
    </div>
  );
}

export interface ReactionBarProps {
  send: UseCallReactions['send'];
  emoji?: readonly string[];
  className?: string;
}

/** A row of reaction buttons for the call controls. */
export function ReactionBar({ send, emoji = DEFAULT_CALL_REACTIONS, className }: ReactionBarProps) {
  return (
    <div className={cx('poolse-reactbar', className)} role="group" aria-label="Send a reaction">
      {emoji.map((e) => (
        <button
          key={e}
          type="button"
          className="poolse-reactbar__btn"
          aria-label={`React ${e}`}
          onClick={() => void send(e)}
        >
          {e}
        </button>
      ))}
    </div>
  );
}

export interface InCallChatPanelProps {
  /** The call's conversation: its chat stays with the meeting afterwards. */
  conversationId: string;
  onClose?: () => void;
  className?: string;
}

/** The call's chat beside the video: the conversation itself, in a narrow panel. */
export function InCallChatPanel({ conversationId, onClose, className }: InCallChatPanelProps) {
  return (
    <section className={cx('poolse-panel', 'poolse-callchat', className)} aria-label="Chat">
      <div className="poolse-panel__head">
        <h3 className="poolse-panel__title">Chat</h3>
        {onClose ? (
          <button
            type="button"
            className="poolse-btn poolse-btn--quiet"
            aria-label="Close chat"
            onClick={onClose}
          >
            <PoolseIcon name="close" size={14} label={null} />
          </button>
        ) : null}
      </div>
      <div className="poolse-callchat__body">
        <ConversationView
          conversationId={conversationId}
          emptyState={
            <p className="poolse-panel__empty">
              Messages sent during the call stay here afterwards.
            </p>
          }
        />
      </div>
    </section>
  );
}

// ── background and noise (CL7) ───────────────────────────────────────────

export interface BackgroundMenuProps {
  /** `useCallRoom(…)`: `background`, `setBackground`, `backgroundSupported`, noise suppression. */
  media: {
    background: CallBackground;
    setBackground: (effect: CallBackground) => Promise<boolean>;
    backgroundSupported: boolean;
    noiseSuppression: boolean;
    setNoiseSuppression: (enabled: boolean) => Promise<void>;
  };
  /** Pictures to offer as backgrounds (URLs the page can load). */
  images?: ReadonlyArray<{ url: string; label: string }>;
  className?: string;
}

/** Camera background (none, blur, a picture) and the noise suppression switch. */
export function BackgroundMenu({ media, images = [], className }: BackgroundMenuProps) {
  const b = media.background;
  const option = (label: string, effect: CallBackground, active: boolean, key: string) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={active}
      className={cx('poolse-bgmenu__opt', active && 'poolse-bgmenu__opt--on')}
      onClick={() => void media.setBackground(effect)}
    >
      {effect.type === 'image' ? (
        <img src={effect.url} alt="" className="poolse-bgmenu__thumb" />
      ) : null}
      <span>{label}</span>
    </button>
  );
  return (
    <div className={cx('poolse-bgmenu', className)}>
      {media.backgroundSupported ? (
        <div role="radiogroup" aria-label="Background" className="poolse-bgmenu__opts">
          {option('None', { type: 'none' }, b.type === 'none', 'none')}
          {option('Blur', { type: 'blur' }, b.type === 'blur', 'blur')}
          {images.map((img) =>
            option(
              img.label,
              { type: 'image', url: img.url },
              b.type === 'image' && b.url === img.url,
              img.url,
            ),
          )}
        </div>
      ) : (
        <p className="poolse-panel__empty">Background effects aren’t available in this browser.</p>
      )}
      <label className="poolse-bgmenu__toggle">
        <input
          type="checkbox"
          checked={media.noiseSuppression}
          onChange={(e) => void media.setNoiseSuppression(e.target.checked)}
        />{' '}
        Noise suppression
      </label>
    </div>
  );
}

// ── move the call here (CL11) ────────────────────────────────────────────

export interface MoveCallHereBarProps {
  /** `inCallElsewhere(live, me.id, connectedHere)`. */
  visible: boolean;
  onMove: () => void;
  pending?: boolean;
  className?: string;
}

/** "You're in this call on another device · Move here". */
export function MoveCallHereBar({ visible, onMove, pending, className }: MoveCallHereBarProps) {
  if (!visible) return null;
  return (
    <div className={cx('poolse-roombar', 'poolse-roombar--live', className)} role="status">
      <span className="poolse-roombar__text">
        <strong>You’re in this call on another device</strong>
      </span>
      <span className="poolse-roombar__actions">
        <button
          type="button"
          className="poolse-roombar__btn poolse-roombar__btn--primary"
          disabled={pending}
          onClick={onMove}
        >
          Move call here
        </button>
      </span>
    </div>
  );
}
