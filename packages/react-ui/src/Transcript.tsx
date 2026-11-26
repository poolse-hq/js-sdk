// Transcripts: the live panel beside a call and the viewer for a stored
// one. Same props in @poolse/react-native.
//
//     <LiveTranscriptPanel callId={call.id} />
//     <TranscriptViewer callId={callId} />

import type { TranscriptSegment, TranscriptSpeaker } from '@poolse/sdk';
import {
  ApiError,
  captureErrorMessage,
  findInText,
  formatCallDuration,
  groupTranscript,
  useLiveTranscript,
  useTranscript,
} from '@poolse/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isImeComposing } from './keymap.js';
import { PoolseIcon } from './PoolseIcon.js';

export interface LiveTranscriptPanelProps {
  /** The call. Null renders an empty panel. */
  callId: string | null;
  /** Keep the transcript topic open. Defaults to true; false while the panel is hidden. */
  enabled?: boolean;
  /** Start / Stop transcription buttons (someone in the call). Defaults to true. */
  showControls?: boolean;
  /** Shows a close button. */
  onClose?: () => void;
  title?: string;
  className?: string;
}

/**
 * The call's live transcript as it is spoken: speaker, time and text,
 * the current speaker's words in grey until they are final. Opens the
 * transcript topic while mounted (the last 200 lines arrive at once)
 * and sticks to the bottom unless you scroll up.
 */
export function LiveTranscriptPanel({
  callId,
  enabled = true,
  showControls = true,
  onClose,
  title = 'Live transcript',
  className,
}: LiveTranscriptPanelProps) {
  const live = useLiveTranscript(callId, { enabled });
  const blocks = useMemo(() => groupTranscript(live.segments), [live.segments]);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [live.segments]);

  const error = live.error ? transcriptError(live.error) : null;

  return (
    <section
      className={['poolse-transcript', 'poolse-transcript--live', className]
        .filter(Boolean)
        .join(' ')}
      aria-label={title}
    >
      <header className="poolse-transcript__head">
        <span className="poolse-transcript__title">
          {live.live && <span className="poolse-rec-dot" aria-hidden="true" />}
          {title}
        </span>
        {showControls && callId && (
          <button
            type="button"
            className="poolse-transcript__btn"
            onClick={() => void (live.live ? live.stop() : live.start())}
            disabled={live.pending}
          >
            {live.live ? 'Stop' : live.transcript ? 'Resume' : 'Start'}
          </button>
        )}
        {onClose && (
          <button
            type="button"
            className="poolse-transcript__icon-btn"
            onClick={onClose}
            aria-label="Close transcript"
          >
            <PoolseIcon name="close" size={16} label={null} />
          </button>
        )}
      </header>
      <div
        ref={scroller}
        className="poolse-transcript__body"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {blocks.length === 0 ? (
          <p className="poolse-transcript__empty">
            {error ??
              (live.live
                ? 'Listening…'
                : live.joined
                  ? 'Transcription is off. Start it to see what is said.'
                  : 'Opening the transcript…')}
          </p>
        ) : (
          blocks.map((b, i) => (
            <div key={`${b.speaker}-${b.startMs}-${i}`} className="poolse-transcript__block">
              <div className="poolse-transcript__who">
                <span className="poolse-transcript__name">{b.name}</span>
                <span className="poolse-transcript__time">{formatCallDuration(b.startMs)}</span>
              </div>
              <p className="poolse-transcript__text">
                {b.segments.map((s, k) => (
                  <span key={k} className={s.final ? undefined : 'poolse-transcript__interim'}>
                    {k > 0 ? ' ' : ''}
                    {s.text}
                  </span>
                ))}
              </p>
            </div>
          ))
        )}
      </div>
      {error && blocks.length > 0 && (
        <p className="poolse-transcript__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export interface TranscriptViewerProps {
  /** The call whose stored transcript to show. */
  callId: string | null;
  /**
   * Offer speaker renames. Defaults to true; the server allows it for
   * people who took part in the call and the conversation's owners and
   * admins, and anyone else gets an explanation instead.
   */
  canRename?: boolean;
  /** Makes timestamps buttons, e.g. to seek a recording (ms since the transcript started). */
  onSeek?: (ms: number) => void;
  title?: string;
  className?: string;
}

/**
 * A call's stored transcript: who spoke, when, and what they said;
 * search within it; and correct a speaker's name (everyone viewing sees
 * the change at once).
 */
export function TranscriptViewer({
  callId,
  canRename = true,
  onSeek,
  title = 'Transcript',
  className,
}: TranscriptViewerProps) {
  const { transcript, loading, missing, error, renameSpeakers } = useTranscript(callId);
  const [query, setQuery] = useState('');
  const [hit, setHit] = useState(0);
  const blocks = useMemo(() => groupTranscript(transcript?.segments ?? []), [transcript]);

  // Every hit, in reading order, as (block, segment, range).
  const hits = useMemo(() => {
    const out: Array<{ b: number; s: number; r: [number, number] }> = [];
    if (!query.trim()) return out;
    blocks.forEach((block, b) =>
      block.segments.forEach((seg, s) => {
        for (const r of findInText(seg.text, query)) out.push({ b, s, r });
      }),
    );
    return out;
  }, [blocks, query]);
  useEffect(() => setHit(0), [query]);

  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    body.current
      ?.querySelector('.poolse-transcript__hit--current')
      ?.scrollIntoView({ block: 'center' });
  }, [hit, hits]);

  const step = (d: number) =>
    setHit((h) => (hits.length ? (h + d + hits.length) % hits.length : 0));

  if (!callId) return null;

  const meta = transcript
    ? [
        transcript.started_at ? formatDate(transcript.started_at) : null,
        duration(transcript),
        transcript.speakers.length === 1 ? '1 speaker' : `${transcript.speakers.length} speakers`,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <section
      className={['poolse-transcript', 'poolse-transcript--viewer', className]
        .filter(Boolean)
        .join(' ')}
      aria-label={title}
    >
      <header className="poolse-transcript__head">
        <span className="poolse-transcript__heading">
          <span className="poolse-transcript__title">{title}</span>
          {meta && <span className="poolse-transcript__meta">{meta}</span>}
        </span>
      </header>

      {transcript && transcript.segments.length > 0 && (
        <div className="poolse-transcript__search" role="search">
          <PoolseIcon name="search" size={15} label={null} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isImeComposing(e)) {
                e.preventDefault();
                step(e.shiftKey ? -1 : 1);
              }
            }}
            placeholder="Search the transcript"
            aria-label="Search the transcript"
          />
          {query.trim() && (
            <>
              <span className="poolse-transcript__count" aria-live="polite">
                {hits.length ? `${hit + 1} of ${hits.length}` : 'No matches'}
              </span>
              <button
                type="button"
                className="poolse-transcript__icon-btn"
                onClick={() => step(-1)}
                disabled={!hits.length}
                aria-label="Previous match"
              >
                <PoolseIcon name="chevron-up" size={15} label={null} />
              </button>
              <button
                type="button"
                className="poolse-transcript__icon-btn"
                onClick={() => step(1)}
                disabled={!hits.length}
                aria-label="Next match"
              >
                <PoolseIcon name="chevron-down" size={15} label={null} />
              </button>
            </>
          )}
        </div>
      )}

      {transcript && transcript.speakers.length > 0 && (
        <SpeakerList
          speakers={transcript.speakers}
          canRename={canRename}
          onRename={renameSpeakers}
        />
      )}

      <div ref={body} className="poolse-transcript__body">
        {loading && !transcript ? (
          <p className="poolse-transcript__empty">Loading the transcript…</p>
        ) : missing ? (
          <p className="poolse-transcript__empty">This call has no transcript.</p>
        ) : error && !transcript ? (
          <p className="poolse-transcript__empty">{transcriptError(error)}</p>
        ) : transcript && transcript.segments.length === 0 ? (
          <p className="poolse-transcript__empty">Nothing was said in this call.</p>
        ) : (
          blocks.map((block, b) => (
            <div
              key={`${block.speaker}-${block.startMs}-${b}`}
              className="poolse-transcript__block"
            >
              <div className="poolse-transcript__who">
                <span className="poolse-transcript__name">{block.name}</span>
                {onSeek ? (
                  <button
                    type="button"
                    className="poolse-transcript__time poolse-transcript__time--link"
                    onClick={() => onSeek(block.startMs)}
                    aria-label={`Play from ${formatCallDuration(block.startMs)}`}
                  >
                    {formatCallDuration(block.startMs)}
                  </button>
                ) : (
                  <span className="poolse-transcript__time">
                    {formatCallDuration(block.startMs)}
                  </span>
                )}
              </div>
              <p className="poolse-transcript__text">
                {block.segments.map((seg, s) => (
                  <span key={s}>
                    {s > 0 ? ' ' : ''}
                    {highlight(seg, hits, b, s, hit)}
                  </span>
                ))}
              </p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function SpeakerList({
  speakers,
  canRename,
  onRename,
}: {
  speakers: TranscriptSpeaker[];
  canRename: boolean;
  onRename: (names: Record<string, string | null>) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (key: string, name: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await onRename({ [key]: name });
      setEditing(null);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? 'Only people who were in the call can rename speakers.'
          : err instanceof ApiError && err.code === 'validation_failed'
            ? 'Names can be up to 100 characters.'
            : 'The name could not be saved. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="poolse-transcript__speakers">
      <ul aria-label="Speakers">
        {speakers.map((sp) => (
          <li key={sp.key} className="poolse-transcript__speaker">
            {editing === sp.key ? (
              <form
                className="poolse-transcript__rename"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = draft.trim();
                  if (name) void save(sp.key, name);
                }}
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={100}
                  aria-label="Speaker name"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
                <button type="submit" disabled={busy || !draft.trim()}>
                  Save
                </button>
                {sp.corrected && (
                  <button type="button" disabled={busy} onClick={() => void save(sp.key, null)}>
                    Use their own name
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <span className="poolse-transcript__speaker-name" title={sp.name ?? undefined}>
                  {sp.name?.trim() || 'Speaker'}
                </span>
                {canRename && (
                  <button
                    type="button"
                    className="poolse-transcript__icon-btn"
                    onClick={() => {
                      setDraft(sp.name ?? '');
                      setError(null);
                      setEditing(sp.key);
                    }}
                    aria-label={`Rename ${sp.name?.trim() || 'speaker'}`}
                  >
                    <PoolseIcon name="edit" size={13} label={null} />
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p className="poolse-transcript__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function highlight(
  seg: TranscriptSegment,
  hits: Array<{ b: number; s: number; r: [number, number] }>,
  b: number,
  s: number,
  current: number,
): ReactNode {
  const mine = hits.map((h, i) => ({ ...h, i })).filter((h) => h.b === b && h.s === s);
  if (!mine.length) return seg.text;
  const out: ReactNode[] = [];
  let at = 0;
  for (const h of mine) {
    if (h.r[0] > at) out.push(seg.text.slice(at, h.r[0]));
    out.push(
      <mark
        key={h.i}
        className={`poolse-transcript__hit${h.i === current ? ' poolse-transcript__hit--current' : ''}`}
      >
        {seg.text.slice(h.r[0], h.r[1])}
      </mark>,
    );
    at = h.r[1];
  }
  if (at < seg.text.length) out.push(seg.text.slice(at));
  return out;
}

function duration(t: { started_at: string | null; ended_at: string | null }): string | null {
  if (!t.started_at || !t.ended_at) return null;
  const ms = Date.parse(t.ended_at) - Date.parse(t.started_at);
  return Number.isFinite(ms) && ms > 0 ? formatCallDuration(ms) : null;
}

function formatDate(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function transcriptError(err: Error): string {
  const code = err instanceof ApiError ? err.code : err.message;
  if (code === 'forbidden') return 'You can’t open this transcript.';
  if (code === 'not_found') return 'There is no transcript for this call.';
  return captureErrorMessage(err instanceof ApiError ? err : { code });
}
