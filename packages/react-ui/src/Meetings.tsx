// After the call: the summary card (RT6, RT7), asking your meetings
// (RT8), clips (RT9) and the recording player (RT13). Same props in
// @poolse/react-native (which plays media through an adapter).
//
//     <SummaryCard summary={parseCallSummary(msg)!} onOpenMoment={seek} />
//     <AskMeetings onOpenMoment={openCall} />
//     <ClipPlayer attachment={att} />
//     <RecordingPlayer recording={rec} />

import type { Attachment, CallSummary, Message, Recording } from '@poolse/sdk';
import {
  ASK_QUESTION_MAX,
  PLAYBACK_RATES,
  activeSegmentIndex,
  chapterIndexAt,
  chaptersOf,
  clipOf,
  formatClock,
  formatDue,
  formatTimeRange,
  meetingsErrorMessage,
  parseCallSummary,
  silencesOf,
  skipSilenceTarget,
  speakerName,
  summaryStyleLabel,
  transcriptOffsetMs,
  useAskMeetings,
  useAttachmentUrl,
  useMembers,
  useRecordingUrl,
  useTranscript,
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
  summary: CallSummary;
  /**
   * A moment was pressed: open the call's recording or transcript there
   * (ms since the transcript started). Defaults to the
   * `MessageExtrasProvider`'s `onOpenMoment`; without one, moments are
   * plain text.
   */
  onOpenMoment?: (callId: string, startMs: number) => void;
  /** A poolse user id → name, for assignees. Defaults to the provider's, then the conversation's members. */
  nameForUserId?: (userId: string) => string | null | undefined;
  className?: string;
}

/**
 * A call's summary: decisions, action items (with who and when), open
 * questions and key moments, each moment a link to its point in the
 * recording. Empty sections are left out.
 */
export function SummaryCard({ summary, onOpenMoment, nameForUserId, className }: SummaryCardProps) {
  const extras = useMessageExtras();
  const open = onOpenMoment ?? extras.onOpenMoment;
  const nameFor = nameForUserId ?? extras.nameForUserId;
  // Without a mapping from the provider, look assignees up among the members.
  const needsMembers =
    !extras.externalIdForUserId && summary.actionItems.some((a) => a.assigneeUserId);
  const { members } = useMembers(needsMembers ? (summary.conversationId ?? '') : '');
  const extFor = (userId: string): string | null =>
    extras.externalIdForUserId?.(userId) ??
    members.find((m) => m.user_id === userId)?.external_id ??
    null;

  const style = summaryStyleLabel(summary.style);
  const empty =
    !summary.overview &&
    summary.decisions.length === 0 &&
    summary.actionItems.length === 0 &&
    summary.openQuestions.length === 0 &&
    summary.moments.length === 0;

  return (
    <section
      className={['poolse-summary', className].filter(Boolean).join(' ')}
      aria-label={style === 'Call summary' ? 'Call summary' : `Call summary, ${style}`}
    >
      <header className="poolse-summary__head">
        <PoolseIcon name="pulse" size={16} label={null} />
        <span className="poolse-summary__title">Call summary</span>
        {style !== 'Call summary' && <span className="poolse-summary__style">{style}</span>}
      </header>
      {summary.overview && <p className="poolse-summary__overview">{summary.overview}</p>}
      {empty && <p className="poolse-summary__empty">Nothing to report from this call.</p>}

      {summary.decisions.length > 0 && (
        <SummarySection title="Decisions">
          <ul className="poolse-summary__list">
            {summary.decisions.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </SummarySection>
      )}

      {summary.actionItems.length > 0 && (
        <SummarySection title="Action items">
          <ul className="poolse-summary__list poolse-summary__list--tasks">
            {summary.actionItems.map((a, i) => {
              const due = formatDue(a.due);
              const resolved = a.assigneeUserId ? (nameFor?.(a.assigneeUserId) ?? null) : null;
              const ext = a.assigneeUserId && !resolved ? extFor(a.assigneeUserId) : null;
              return (
                <li key={i} className="poolse-summary__task">
                  <span className="poolse-summary__task-box" aria-hidden="true" />
                  <span className="poolse-summary__task-body">
                    <span className="poolse-summary__task-text">{a.text}</span>
                    {(resolved || ext || due) && (
                      <span className="poolse-summary__task-meta">
                        {resolved ? (
                          <span className="poolse-summary__assignee">{resolved}</span>
                        ) : ext ? (
                          <UserName externalId={ext} className="poolse-summary__assignee" />
                        ) : null}
                        {(resolved || ext) && due ? ' · ' : null}
                        {due}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </SummarySection>
      )}

      {summary.openQuestions.length > 0 && (
        <SummarySection title="Open questions">
          <ul className="poolse-summary__list">
            {summary.openQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </SummarySection>
      )}

      {summary.moments.length > 0 && (
        <SummarySection title="Key moments">
          <ul className="poolse-summary__moments">
            {summary.moments.map((m, i) => (
              <li key={i}>
                {open ? (
                  <button
                    type="button"
                    className="poolse-summary__moment"
                    onClick={(e) => {
                      e.stopPropagation();
                      open(summary.callId, m.startMs);
                    }}
                    aria-label={`Play from ${formatClock(m.startMs)}: ${m.label}`}
                  >
                    <span className="poolse-summary__time">{formatClock(m.startMs)}</span>
                    <span className="poolse-summary__moment-label">{m.label}</span>
                  </button>
                ) : (
                  <span className="poolse-summary__moment poolse-summary__moment--static">
                    <span className="poolse-summary__time">{formatClock(m.startMs)}</span>
                    <span className="poolse-summary__moment-label">{m.label}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </SummarySection>
      )}
    </section>
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
  const isAgent = !!agent || msg.is_agent === true;
  return (
    <div className="poolse-card-row" data-message-id={msg.id} role="article" tabIndex={-1}>
      {msg.sender_external_id && (
        <div className="poolse-card-row__sender">
          <span className="poolse-card-row__name">
            {profile?.displayName ?? msg.agent?.name ?? 'Note-taker'}
          </span>
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
  /** A link in the answer was pressed. Defaults to the provider's `onOpenMoment`. */
  onOpenMoment?: (callId: string, startMs: number) => void;
  placeholder?: string;
  className?: string;
}

/**
 * "What did we agree with Acme about pricing?" — a question box and its
 * answer, with links to the moments it comes from. Only meetings the
 * viewer could see are searched.
 */
export function AskMeetings({ callId, onOpenMoment, placeholder, className }: AskMeetingsProps) {
  const extras = useMessageExtras();
  const open = onOpenMoment ?? extras.onOpenMoment;
  const { answer, question, loading, error, ask, reset } = useAskMeetings({
    callId: callId ?? null,
  });
  const [draft, setDraft] = useState('');

  return (
    <section
      className={['poolse-ask', className].filter(Boolean).join(' ')}
      aria-label={callId ? 'Ask about this meeting' : 'Ask your meetings'}
    >
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
            placeholder ??
            (callId ? 'Ask about this meeting' : 'Ask your meetings, e.g. what did we decide?')
          }
          aria-label={callId ? 'Ask about this meeting' : 'Ask your meetings'}
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
              {answer.answer || 'Nothing in your meetings answers that.'}
            </p>
            {answer.links.length > 0 && (
              <ul className="poolse-ask__links" aria-label="Moments">
                {answer.links.map((l, i) => {
                  const inner = (
                    <>
                      <span className="poolse-summary__time">{formatClock(l.startMs)}</span>
                      <span className="poolse-ask__snippet">{l.snippet || 'In the meeting'}</span>
                    </>
                  );
                  return (
                    <li key={`${l.callId}-${l.startMs}-${i}`}>
                      {open ? (
                        <button
                          type="button"
                          className="poolse-summary__moment"
                          onClick={() => open(l.callId, l.startMs)}
                          aria-label={`Play from ${formatClock(l.startMs)}${l.snippet ? `: ${l.snippet}` : ''}`}
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
  /** A clip attachment (it carries `clip`) — plays its own file. */
  attachment?: Attachment | null;
  /**
   * Or a range of a recording, without a cut file: plays the recording
   * from `startMs` and stops at `endMs`.
   */
  clip?: { recordingId: string; startMs: number; endMs: number } | null;
  /** "Open the recording" — at the clip's start. */
  onOpenRecording?: (recordingId: string, startMs: number) => void;
  /** A slimmer layout, inside a message. */
  compact?: boolean;
  className?: string;
}

/** A short piece of a call's recording, shared in chat. */
export function ClipPlayer({
  attachment,
  clip: rangeClip,
  onOpenRecording,
  compact = false,
  className,
}: ClipPlayerProps) {
  const fromAttachment = attachment ? clipOf(attachment) : null;
  const info = fromAttachment ?? rangeClip ?? null;
  const fileUrl = useAttachmentUrl(attachment?.id ?? null);
  const recUrl = useRecordingUrl(!attachment && rangeClip ? rangeClip.recordingId : null);
  const url = attachment ? fileUrl.url : recUrl.url;
  const error = attachment ? fileUrl.error : recUrl.error;
  const media = useRef<HTMLMediaElement | null>(null);
  const isVideo = attachment ? attachment.content_type.startsWith('video/') : false;
  const ranged = !attachment && !!rangeClip;

  const label = info ? formatTimeRange(info.startMs, info.endMs) : null;
  const length = info ? formatClock(info.endMs - info.startMs) : null;

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
    onError: () => {
      if (!attachment) recUrl.refresh();
    },
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
        <span className="poolse-clip__title">Clip</span>
        {label && <span className="poolse-clip__range">{label}</span>}
        {length && <span className="poolse-clip__length">{length}</span>}
      </figcaption>
      {error ? (
        <p className="poolse-clip__error">The clip couldn’t be loaded.</p>
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
  /** A recording from `useRecordings(conversationId)`. */
  recording: Recording;
  /** The transcript beside it, following playback. Defaults to true. */
  showTranscript?: boolean;
  /** Start here (ms since the transcript started, like summary moments); a new value seeks. */
  startMs?: number | null;
  /** Skip silence starts on (when the recording has silence ranges). Defaults to false. */
  defaultSkipSilence?: boolean;
  className?: string;
}

/** Control the player from outside (e.g. a citation seeking it). */
export interface RecordingPlayerHandle {
  /** Seek to transcript time `ms` and play. */
  seek: (ms: number) => void;
  play: () => void;
  pause: () => void;
}

/**
 * A finished recording: play at 1×, 1.25×, 1.5× or 2×, skip silence
 * (when the recording lists its silences), jump by chapter, and read
 * the transcript as it scrolls along — press a line to play from there.
 * Expired links (they last five minutes) are renewed by themselves.
 */
export const RecordingPlayer = forwardRef<RecordingPlayerHandle, RecordingPlayerProps>(
  function RecordingPlayer(
    { recording, showTranscript = true, startMs, defaultSkipSilence = false, className },
    ref,
  ) {
    const ready = recording.status === 'ready';
    const { url, error, refresh } = useRecordingUrl(ready ? recording.id : null);
    const { transcript } = useTranscript(showTranscript && ready ? recording.call_id : null);
    const offset = transcriptOffsetMs(recording.started_at, transcript?.started_at);
    const chapters = useMemo(() => chaptersOf(recording), [recording]);
    const silences = useMemo(() => silencesOf(recording), [recording]);
    const segments = useMemo(() => transcript?.segments ?? [], [transcript]);

    const media = useRef<HTMLMediaElement | null>(null);
    const [posMs, setPosMs] = useState(0);
    const [rate, setRate] = useState<PlaybackRate>(1);
    const [skip, setSkip] = useState(defaultSkipSilence);
    // Where to be once the (new) source has loaded: a seek before
    // metadata, or the spot an expired link broke off at.
    const resume = useRef<{ ms: number; play: boolean } | null>(null);
    const renewals = useRef<number[]>([]);

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
      seek: (ms) => seekMedia(ms - offset, true),
      play: () => void media.current?.play().catch(() => undefined),
      pause: () => media.current?.pause(),
    }));

    useEffect(() => {
      if (typeof startMs === 'number') seekMedia(startMs - offset, false);
      // Only a new start point seeks; the offset settling doesn't.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [startMs]);

    useEffect(() => {
      if (media.current) media.current.playbackRate = rate;
    }, [rate, url]);

    // The transcript line under the playhead, kept in view unless the
    // viewer scrolled the transcript themselves in the last few seconds.
    const active = activeSegmentIndex(segments, posMs + offset);
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
    const isAudio = recording.mode === 'audio';

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
        const now = Date.now();
        renewals.current = renewals.current.filter((t) => now - t < 60_000);
        if (renewals.current.length >= 3) return;
        renewals.current.push(now);
        const el = media.current;
        resume.current = { ms: el ? el.currentTime * 1000 : posMs, play: el ? !el.paused : false };
        refresh();
      },
    };

    return (
      <section
        className={['poolse-player', className].filter(Boolean).join(' ')}
        aria-label="Recording"
      >
        <div className="poolse-player__stage">
          {!ready ? (
            <p className="poolse-player__note">
              {recording.status === 'failed'
                ? 'This recording couldn’t be saved.'
                : 'The recording is still being saved.'}
            </p>
          ) : error && !url ? (
            <p className="poolse-player__note" role="alert">
              {meetingsErrorMessage(error)}
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
                  <button type="button" onClick={() => seekMedia(s.start_ms - offset, true)}>
                    {newSpeaker && <span className="poolse-player__speaker">{speakerName(s)}</span>}
                    <span className="poolse-player__time">
                      {formatClock(Math.max(0, s.start_ms - offset))}
                    </span>
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
