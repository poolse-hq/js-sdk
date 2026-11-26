// After the call: the summary card (RT6, RT7), asking your meetings
// (RT8), clips (RT9) and the recording player (RT13). Same props in
// @poolse/react-native (which plays media through an adapter).
//
//     <SummaryCard summary={parseCallSummary(msg)!} onOpenMoment={open} />
//     <AskMeetings onOpenMoment={open} />
//     <ClipPlayer attachment={att} />  or  <ClipPlayer clipId={id} />
//     <RecordingPlayer recordingId={id} startMs={moment.recordingMs} />

import type { Attachment, CallSummary, MeetingMoment, Message, SummaryItem } from '@poolse/sdk';
import {
  ASK_QUESTION_MAX,
  PLAYBACK_RATES,
  activeSegmentIndex,
  chapterIndexAt,
  clipOf,
  formatClock,
  formatDue,
  formatTimeRange,
  meetingsErrorMessage,
  momentOf,
  parseCallSummary,
  silencesFromSegments,
  silencesOf,
  skipSilenceTarget,
  speakerName,
  summaryStatusText,
  summaryStyleLabel,
  useAskMeetings,
  useAttachmentUrl,
  useCallSummary,
  useClip,
  useMediaRenewal,
  useMembers,
  useRecordingPlayback,
  useRecordingUrl,
  useUser,
  type PlaybackRate,
} from '@poolse/react';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { AgentBadge } from './AgentBadge.js';
import { useMessageExtras } from './messageExtras.js';
import { PoolseIcon } from './PoolseIcon.js';
import { UserName } from './UserName.js';

// ── Summary card ─────────────────────────────────────────────────────────

export interface SummaryCardProps {
  /** From `parseCallSummary(message)` or `meetings.summary(callId)`. */
  summary: CallSummary;
  /**
   * A point of the call was pressed: open its recording (`recordingId` +
   * `recordingMs`) or transcript (`startMs`). Defaults to the
   * `MessageExtrasProvider`'s; without one, times are plain text.
   */
  onOpenMoment?: (moment: MeetingMoment) => void;
  /** A poolse user id → name, for assignees. Defaults to the provider's, then the conversation's members. */
  nameForUserId?: (userId: string) => string | null | undefined;
  /**
   * Fetch the full summary when this copy is `shortened`, and follow
   * `summary:ready` (regenerated, failed, deleted). Defaults to true.
   */
  live?: boolean;
  className?: string;
}

/**
 * A call's summary: overview, decisions, action items (who and when),
 * open questions, the style's own sections and key moments — every line
 * the model tied to a moment links to it. Empty sections are left out.
 */
export function SummaryCard({
  summary: initial,
  onOpenMoment,
  nameForUserId,
  live = true,
  className,
}: SummaryCardProps) {
  const extras = useMessageExtras();
  const followed = useCallSummary(live ? initial.callId : null, initial);
  const summary = (live ? followed.summary : null) ?? initial;
  const open = onOpenMoment ?? extras.onOpenMoment;
  const nameFor = nameForUserId ?? extras.nameForUserId;
  const needsMembers =
    !extras.externalIdForUserId && summary.actionItems.some((a) => a.assigneeUserId);
  const { members } = useMembers(needsMembers ? (summary.conversationId ?? '') : '');
  const extFor = (userId: string): string | null =>
    extras.externalIdForUserId?.(userId) ??
    members.find((m) => m.user_id === userId)?.external_id ??
    null;

  const style = summaryStyleLabel(summary.style);
  const status = summaryStatusText(summary);
  const empty =
    !summary.overview &&
    summary.decisions.length === 0 &&
    summary.actionItems.length === 0 &&
    summary.openQuestions.length === 0 &&
    summary.moments.length === 0 &&
    summary.sections.length === 0;

  const time = (item: SummaryItem) => (
    <ItemTime summary={summary} item={item} {...(open ? { onOpen: open } : {})} />
  );
  const plain = (list: SummaryItem[]) => (
    <ul className="poolse-summary__list">
      {list.map((d, i) => (
        <li key={i} className="poolse-summary__item">
          <span className="poolse-summary__item-text">{d.text}</span>
          {time(d)}
        </li>
      ))}
    </ul>
  );

  return (
    <section
      className={['poolse-summary', className].filter(Boolean).join(' ')}
      aria-label={style === 'Meeting' ? 'Call summary' : `Call summary, ${style}`}
    >
      <header className="poolse-summary__head">
        <PoolseIcon name="pulse" size={16} label={null} />
        <span className="poolse-summary__title">Call summary</span>
        {style !== 'Meeting' && <span className="poolse-summary__style">{style}</span>}
      </header>
      {status ? (
        <p className="poolse-summary__empty">{status}</p>
      ) : (
        <>
          {summary.overview && <p className="poolse-summary__overview">{summary.overview}</p>}
          {empty && <p className="poolse-summary__empty">Nothing to report from this call.</p>}

          {summary.decisions.length > 0 && (
            <SummarySection title="Decisions">{plain(summary.decisions)}</SummarySection>
          )}

          {summary.actionItems.length > 0 && (
            <SummarySection title="Action items">
              <ul className="poolse-summary__list poolse-summary__list--tasks">
                {summary.actionItems.map((a, i) => {
                  const due = formatDue(a.dueDate, a.dueText);
                  const resolved = a.assigneeUserId ? (nameFor?.(a.assigneeUserId) ?? null) : null;
                  const ext = a.assigneeUserId && !resolved ? extFor(a.assigneeUserId) : null;
                  const said = !resolved && !ext ? a.assigneeName : null;
                  return (
                    <li key={a.id ?? i} className="poolse-summary__task">
                      <span className="poolse-summary__task-box" aria-hidden="true" />
                      <span className="poolse-summary__task-body">
                        <span className="poolse-summary__task-text">{a.text}</span>
                        {(resolved || ext || said || due) && (
                          <span className="poolse-summary__task-meta">
                            {resolved || said ? (
                              <span className="poolse-summary__assignee">{resolved ?? said}</span>
                            ) : ext ? (
                              <UserName externalId={ext} className="poolse-summary__assignee" />
                            ) : null}
                            {(resolved || ext || said) && due ? ' · ' : null}
                            {due}
                          </span>
                        )}
                      </span>
                      {time(a)}
                    </li>
                  );
                })}
              </ul>
            </SummarySection>
          )}

          {summary.openQuestions.length > 0 && (
            <SummarySection title="Open questions">{plain(summary.openQuestions)}</SummarySection>
          )}

          {summary.sections.map((sec, i) => (
            <SummarySection key={`${sec.title}-${i}`} title={sec.title}>
              {plain(sec.items)}
            </SummarySection>
          ))}

          {summary.moments.length > 0 && (
            <SummarySection title="Key moments">
              <ul className="poolse-summary__moments">
                {summary.moments.map((m, i) => {
                  const moment = momentOf(summary, m);
                  const inner = (
                    <>
                      <span className="poolse-summary__time">
                        {m.startMs !== null ? formatClock(m.startMs) : '–'}
                      </span>
                      <span className="poolse-summary__moment-label">
                        {m.title}
                        {m.speakerName ? (
                          <span className="poolse-summary__speaker"> · {m.speakerName}</span>
                        ) : null}
                      </span>
                    </>
                  );
                  return (
                    <li key={i}>
                      {open && m.startMs !== null ? (
                        <button
                          type="button"
                          className="poolse-summary__moment"
                          onClick={(e) => {
                            e.stopPropagation();
                            open(moment);
                          }}
                          aria-label={`Play from ${formatClock(m.startMs)}: ${m.title}`}
                        >
                          {inner}
                        </button>
                      ) : (
                        <span className="poolse-summary__moment poolse-summary__moment--static">
                          {inner}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </SummarySection>
          )}
          {summary.truncated && (
            <p className="poolse-summary__note">
              The meeting was long: this covers its first part.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function ItemTime({
  summary,
  item,
  onOpen,
}: {
  summary: CallSummary;
  item: SummaryItem;
  onOpen?: (moment: MeetingMoment) => void;
}) {
  if (item.startMs === null) return null;
  const label = formatClock(item.startMs);
  return onOpen ? (
    <button
      type="button"
      className="poolse-summary__item-time"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(momentOf(summary, item));
      }}
      aria-label={`Play from ${label}`}
    >
      {label}
    </button>
  ) : (
    <span className="poolse-summary__item-time poolse-summary__item-time--static">{label}</span>
  );
}

function SummarySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="poolse-summary__section">
      <h4 className="poolse-summary__section-title">{title}</h4>
      {children}
    </div>
  );
}

export interface SummaryMessageRowProps {
  msg: Message;
  meId: string | null;
  nameForUserId?: (userId: string) => string | null | undefined;
}

/** A `kind: "call_summary"` message in a list: who posted it, then the card. */
export function SummaryMessageRow({ msg, nameForUserId }: SummaryMessageRowProps) {
  const summary = useMemo(() => parseCallSummary(msg), [msg]);
  const { profile, agent } = useUser(msg.sender_external_id);
  if (!summary) return null;
  const isAgent = !!agent || msg.sender_is_agent === true;
  const name = profile?.displayName ?? agent?.name ?? null;
  return (
    <div className="poolse-card-row" data-message-id={msg.id} role="article" tabIndex={-1}>
      {name && (
        <div className="poolse-card-row__sender">
          <span className="poolse-card-row__name">{name}</span>
          {isAgent && <AgentBadge size="xs" />}
        </div>
      )}
      <SummaryCard summary={summary} {...(nameForUserId ? { nameForUserId } : {})} />
    </div>
  );
}

// ── Ask your meetings ────────────────────────────────────────────────────

export interface AskMeetingsProps {
  /** Ask about one call; omit for all of them. */
  callId?: string | null;
  /** Ask about one conversation's meetings. */
  conversationId?: string | null;
  /** A source in the answer was pressed. Defaults to the provider's `onOpenMoment`. */
  onOpenMoment?: (moment: MeetingMoment) => void;
  placeholder?: string;
  className?: string;
}

/**
 * "What did we agree with Acme about pricing?" — a question box and its
 * answer, with links to the moments it comes from. Only meetings the
 * viewer could see are searched.
 */
export function AskMeetings({
  callId,
  conversationId,
  onOpenMoment,
  placeholder,
  className,
}: AskMeetingsProps) {
  const extras = useMessageExtras();
  const open = onOpenMoment ?? extras.onOpenMoment;
  const { answer, question, loading, error, ask, reset } = useAskMeetings({
    callId: callId ?? null,
    conversationId: conversationId ?? null,
  });
  const [draft, setDraft] = useState('');
  const label = callId ? 'Ask about this meeting' : 'Ask your meetings';

  return (
    <section className={['poolse-ask', className].filter(Boolean).join(' ')} aria-label={label}>
      <form
        className="poolse-ask__form"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) void ask(draft);
        }}
      >
        <PoolseIcon name="search" size={15} label={null} />
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={ASK_QUESTION_MAX}
          placeholder={
            placeholder ?? (callId ? label : 'Ask your meetings, e.g. what did we decide?')
          }
          aria-label={label}
        />
        <button type="submit" className="poolse-ask__btn" disabled={loading || !draft.trim()}>
          {loading ? 'Asking…' : 'Ask'}
        </button>
      </form>
      <div className="poolse-ask__result" aria-live="polite">
        {loading ? (
          <p className="poolse-ask__status">Looking through your meetings…</p>
        ) : error ? (
          <p className="poolse-ask__error" role="alert">
            {meetingsErrorMessage(error)}
          </p>
        ) : answer ? (
          <>
            {question && <p className="poolse-ask__question">{question}</p>}
            <p className="poolse-ask__answer">
              {answer.answer ?? 'Nothing in your meetings answers that.'}
            </p>
            {answer.citations.length > 0 && (
              <ol className="poolse-ask__links" aria-label="Sources">
                {answer.citations.map((c, i) => {
                  const at = c.startMs !== null ? formatClock(c.startMs) : null;
                  const text =
                    [c.speakerName, c.text].filter(Boolean).join(': ') || 'In the meeting';
                  const inner = (
                    <>
                      <span className="poolse-summary__time">{at ?? c.ref ?? i + 1}</span>
                      <span className="poolse-ask__snippet">{text}</span>
                    </>
                  );
                  return (
                    <li key={`${c.callId}-${c.startMs}-${i}`}>
                      {open && (c.startMs !== null || c.recordingMs !== null) ? (
                        <button
                          type="button"
                          className="poolse-summary__moment"
                          onClick={() => open(c)}
                          aria-label={`${at ? `Play from ${at}` : 'Open'}: ${text}`}
                        >
                          {inner}
                        </button>
                      ) : (
                        <span className="poolse-summary__moment poolse-summary__moment--static">
                          {inner}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            <button
              type="button"
              className="poolse-approval__link"
              onClick={() => {
                reset();
                setDraft('');
              }}
            >
              Clear
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
}

// ── Clips ────────────────────────────────────────────────────────────────

export interface ClipPlayerProps {
  /** A clip shared in chat (an attachment) — plays its own file. */
  attachment?: Attachment | null;
  /** A clip by id (`meetings.createClip`) — shows "Cutting…" until `clip:ready`. */
  clipId?: string | null;
  /** Or a range of a recording, without a cut: plays it from `startMs` to `endMs`. */
  clip?: { recordingId: string; startMs: number; endMs: number } | null;
  /** "Open the recording" — at the clip's start (recording time). */
  onOpenRecording?: (recordingId: string, startMs: number) => void;
  /** A slimmer layout, inside a message. */
  compact?: boolean;
  className?: string;
}

/** A short piece of a call's recording. */
export function ClipPlayer({
  attachment,
  clipId,
  clip: rangeClip,
  onOpenRecording,
  compact = false,
  className,
}: ClipPlayerProps) {
  const mode = attachment ? 'file' : clipId ? 'clip' : rangeClip ? 'range' : 'none';
  const fileUrl = useAttachmentUrl(mode === 'file' ? attachment!.id : null);
  const cut = useClip(mode === 'clip' ? clipId! : null);
  const recUrl = useRecordingUrl(mode === 'range' ? rangeClip!.recordingId : null);
  const media = useRef<HTMLMediaElement | null>(null);

  const info =
    mode === 'file'
      ? clipOf(attachment)
      : mode === 'clip' && cut.clip
        ? { recordingId: cut.clip.recordingId, startMs: cut.clip.startMs, endMs: cut.clip.endMs }
        : (rangeClip ?? null);
  const url = mode === 'file' ? fileUrl.url : mode === 'clip' ? cut.url : recUrl.url;
  const error = mode === 'file' ? fileUrl.error : mode === 'clip' ? cut.error : recUrl.error;
  const contentType =
    mode === 'file' ? attachment!.content_type : mode === 'clip' ? cut.clip?.contentType : null;
  const isVideo = !!contentType?.startsWith('video/');
  const ranged = mode === 'range';
  const label = info ? formatTimeRange(info.startMs, info.endMs) : null;
  const title = mode === 'clip' ? cut.clip?.title : null;
  const status = mode === 'clip' ? cut.clip?.status : null;
  // A media error renews the link (they expire), at most three times a
  // minute; after that the clip can't play and says so.
  const renewal = useMediaRenewal(
    () => {
      if (mode === 'file') fileUrl.refresh();
      if (mode === 'range') recUrl.refresh();
      if (mode === 'clip') cut.refresh();
    },
    `${mode}:${attachment?.id ?? clipId ?? rangeClip?.recordingId ?? ''}`,
  );

  const props = {
    ref: (el: HTMLMediaElement | null) => {
      media.current = el;
    },
    src: url ?? undefined,
    controls: true,
    preload: 'metadata' as const,
    className: 'poolse-clip__media',
    onLoadedMetadata: () => {
      if (ranged && media.current && rangeClip)
        media.current.currentTime = rangeClip.startMs / 1000;
    },
    onTimeUpdate: () => {
      if (ranged && media.current && rangeClip) {
        if (media.current.currentTime * 1000 >= rangeClip.endMs) media.current.pause();
      }
    },
    onError: () => void renewal.renew(),
  };

  return (
    <figure
      className={['poolse-clip', compact ? 'poolse-clip--compact' : null, className]
        .filter(Boolean)
        .join(' ')}
      aria-label={label ? `Clip, ${label}` : 'Clip'}
    >
      <figcaption className="poolse-clip__head">
        <PoolseIcon name="video" size={14} label={null} />
        <span className="poolse-clip__title">{title ?? 'Clip'}</span>
        {label && <span className="poolse-clip__range">{label}</span>}
        {info && (
          <span className="poolse-clip__length">{formatClock(info.endMs - info.startMs)}</span>
        )}
      </figcaption>
      {status === 'queued' || status === 'cutting' ? (
        <div className="poolse-clip__loading" aria-busy="true">
          Cutting the clip…
        </div>
      ) : status === 'failed' || status === 'deleted' ? (
        <p className="poolse-clip__error">
          {status === 'deleted' ? 'This clip was deleted.' : 'The clip couldn’t be cut.'}
        </p>
      ) : error ? (
        <p className="poolse-clip__error">{meetingsErrorMessage(error)}</p>
      ) : renewal.exhausted ? (
        <p className="poolse-clip__error" role="alert">
          The clip couldn’t be played.
        </p>
      ) : !url ? (
        <div className="poolse-clip__loading" aria-busy="true">
          Loading…
        </div>
      ) : isVideo ? (
        <video {...props} playsInline />
      ) : (
        <audio {...props} />
      )}
      {info && onOpenRecording && (
        <button
          type="button"
          className="poolse-approval__link"
          onClick={() => onOpenRecording(info.recordingId, info.startMs)}
        >
          Open the recording
        </button>
      )}
    </figure>
  );
}

// ── Recording player ─────────────────────────────────────────────────────

export interface RecordingPlayerProps {
  /** The recording (`useRecordings(conversationId)` items carry `id`). */
  recordingId: string;
  /** The transcript beside it, following playback. Defaults to true. */
  showTranscript?: boolean;
  /** Start here (recording ms — a moment's `recordingMs`); a new value seeks. */
  startMs?: number | null;
  /** Skip silence starts on. Defaults to false. */
  defaultSkipSilence?: boolean;
  className?: string;
}

/** Control the player from outside (e.g. a citation seeking it). */
export interface RecordingPlayerHandle {
  /** Seek to recording time `ms` and play. */
  seek: (ms: number) => void;
  /** Seek to transcript time `ms` (a summary item's `startMs`) and play. */
  seekTranscript: (ms: number) => void;
  play: () => void;
  pause: () => void;
}

/**
 * A finished recording (`GET /v1/recordings/:id/playback`): play at 1×,
 * 1.25×, 1.5× or 2×, skip silence (the recording's silences, else the
 * gaps between transcript lines), jump by chapter, and read the
 * transcript as it scrolls along — press a line to play from there.
 * Expired links (they last five minutes) are renewed by themselves.
 */
export const RecordingPlayer = forwardRef<RecordingPlayerHandle, RecordingPlayerProps>(
  function RecordingPlayer(
    { recordingId, showTranscript = true, startMs, defaultSkipSilence = false, className },
    ref,
  ) {
    const { playback, error, refresh } = useRecordingPlayback(recordingId);
    const url = playback?.url || null;
    const segments = useMemo(() => playback?.transcript?.segments ?? [], [playback]);
    const offset = playback?.transcript?.offsetMs ?? 0;
    const chapters = playback?.chapters ?? [];
    const silences = useMemo(() => {
      const listed = silencesOf(playback?.recording);
      return listed.length > 0 ? listed : silencesFromSegments(segments);
    }, [playback, segments]);

    const media = useRef<HTMLMediaElement | null>(null);
    const [posMs, setPosMs] = useState(0);
    const [rate, setRate] = useState<PlaybackRate>(1);
    const [skip, setSkip] = useState(defaultSkipSilence);
    // Where to be once the (new) source has loaded: a seek before
    // metadata, or the spot an expired link broke off at.
    const resume = useRef<{ ms: number; play: boolean } | null>(null);
    const renewal = useMediaRenewal(refresh, recordingId);

    const seekMedia = (mediaMs: number, play: boolean) => {
      const el = media.current;
      const ms = Math.max(0, mediaMs);
      if (!el || el.readyState < 1) {
        resume.current = { ms, play };
        return;
      }
      el.currentTime = ms / 1000;
      setPosMs(ms);
      if (play) void el.play().catch(() => undefined);
    };

    useImperativeHandle(ref, () => ({
      seek: (ms) => seekMedia(ms, true),
      seekTranscript: (ms) => seekMedia(ms + offset, true),
      play: () => void media.current?.play().catch(() => undefined),
      pause: () => media.current?.pause(),
    }));

    useEffect(() => {
      if (typeof startMs === 'number') seekMedia(startMs, false);
      // Only a new start point seeks.
    }, [startMs]);

    useEffect(() => {
      if (media.current) media.current.playbackRate = rate;
    }, [rate, url]);

    // The transcript line under the playhead, kept in view unless the
    // viewer scrolled the transcript themselves in the last few seconds.
    const active = activeSegmentIndex(segments, posMs);
    const list = useRef<HTMLOListElement>(null);
    const userScrolledAt = useRef(0);
    const autoScrolling = useRef(false);
    useEffect(() => {
      if (active < 0 || Date.now() - userScrolledAt.current < 4000) return;
      const el = list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
      if (!el || !list.current) return;
      autoScrolling.current = true;
      const top = el.offsetTop - list.current.clientHeight / 3;
      list.current.scrollTo?.({ top, behavior: 'smooth' });
      setTimeout(() => (autoScrolling.current = false), 400);
    }, [active]);

    const chapterIdx = chapterIndexAt(chapters, posMs);
    const isAudio =
      playback?.recording?.mode === 'audio' || !!playback?.contentType?.startsWith('audio/');

    const mediaProps = {
      ref: (el: HTMLMediaElement | null) => {
        media.current = el;
      },
      src: url ?? undefined,
      controls: true,
      preload: 'metadata' as const,
      className: 'poolse-player__media',
      onLoadedMetadata: () => {
        const el = media.current;
        if (!el) return;
        el.playbackRate = rate;
        const r = resume.current;
        resume.current = null;
        if (r) {
          el.currentTime = r.ms / 1000;
          setPosMs(r.ms);
          if (r.play) void el.play().catch(() => undefined);
        }
      },
      onTimeUpdate: () => {
        const el = media.current;
        if (!el) return;
        const ms = el.currentTime * 1000;
        if (skip && !el.paused) {
          const to = skipSilenceTarget(silences, ms);
          if (to !== null) {
            el.currentTime = to / 1000;
            setPosMs(to);
            return;
          }
        }
        setPosMs(ms);
      },
      onError: () => {
        // Most likely the five-minute link ran out: renew it (at most
        // three times a minute) and carry on from the same spot.
        const el = media.current;
        const at = { ms: el ? el.currentTime * 1000 : posMs, play: el ? !el.paused : false };
        if (renewal.renew()) resume.current = at;
      },
    };

    return (
      <section
        className={['poolse-player', className].filter(Boolean).join(' ')}
        aria-label="Recording"
      >
        <div className="poolse-player__stage">
          {error && !url ? (
            <p className="poolse-player__note" role="alert">
              {meetingsErrorMessage(error)}
            </p>
          ) : renewal.exhausted ? (
            <p className="poolse-player__note" role="alert">
              The recording couldn’t be played. Try again later.
            </p>
          ) : !url ? (
            <p className="poolse-player__note" aria-busy="true">
              Loading the recording…
            </p>
          ) : isAudio ? (
            <audio {...mediaProps} />
          ) : (
            <video {...mediaProps} playsInline />
          )}
        </div>

        <div className="poolse-player__bar">
          <div className="poolse-player__rates" role="group" aria-label="Playback speed">
            {PLAYBACK_RATES.map((r) => (
              <button
                key={r}
                type="button"
                className="poolse-player__rate"
                aria-pressed={rate === r}
                onClick={() => setRate(r)}
              >
                {r}×
              </button>
            ))}
          </div>
          {silences.length > 0 && (
            <label className="poolse-player__skip">
              <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
              Skip silence
            </label>
          )}
        </div>

        {chapters.length > 0 && (
          <nav className="poolse-player__chapters" aria-label="Chapters">
            <ol>
              {chapters.map((c, i) => (
                <li key={`${c.startMs}-${i}`}>
                  <button
                    type="button"
                    className="poolse-player__chapter"
                    aria-current={i === chapterIdx ? 'true' : undefined}
                    onClick={() => seekMedia(c.startMs, true)}
                  >
                    <span className="poolse-summary__time">{formatClock(c.startMs)}</span>
                    <span className="poolse-player__chapter-title">{c.title}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        )}

        {showTranscript && segments.length > 0 && (
          <ol
            ref={list}
            className="poolse-player__transcript"
            aria-label="Transcript"
            onScroll={() => {
              if (!autoScrolling.current) userScrolledAt.current = Date.now();
            }}
          >
            {segments.map((s, i) => {
              const newSpeaker = i === 0 || segments[i - 1]!.speaker !== s.speaker;
              return (
                <li
                  key={`${s.start_ms}-${i}`}
                  data-index={i}
                  className={i === active ? 'poolse-player__line is-active' : 'poolse-player__line'}
                  aria-current={i === active ? 'true' : undefined}
                >
                  <button type="button" onClick={() => seekMedia(s.start_ms, true)}>
                    {newSpeaker && <span className="poolse-player__speaker">{speakerName(s)}</span>}
                    <span className="poolse-player__time">{formatClock(s.start_ms)}</span>
                    <span className="poolse-player__text">{s.text}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    );
  },
);
