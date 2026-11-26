// After the call (the server's docs/SUMMARIES.md):
//
//   * the summary posted into the call's conversation — a system message
//     `{"kind":"call_summary","v":1,…}` — and `GET /v1/calls/:id/summary`
//     for the full one; `summary:ready` on the conversation (RT6, RT7, RT10);
//   * the follow-up draft (RT12, never sent by poolse);
//   * asking your meetings — `POST /v1/meetings/ask` (RT8);
//   * clips — cut from a recording, then shared as an attachment (RT9);
//   * playback — `GET /v1/recordings/:id/playback`: a link, chapters and the
//     transcript in recording time (RT13).
//
// Every wire shape is read in the "wire mapping" section and nowhere else.
//
// Two clocks: transcript time (ms since the transcript started — summary
// items' `start_ms`) and recording time (ms into the recording file —
// `recording_ms`, chapters, playback segments). A `MeetingMoment` carries
// both so the app can open either the transcript or the recording.

import type { Recording, TranscriptSegment } from './resources/calls.js';
import type { RestClient } from './rest-client.js';
import type { Attachment, Message, Uuid } from './types.js';
import { kindPayload } from './agents.js';

/** A point in a meeting, as links in summaries and answers carry it. */
export interface MeetingMoment {
  callId: string;
  conversationId: Uuid | null;
  /** Transcript time; null when unknown. */
  startMs: number | null;
  endMs: number | null;
  /** The call's (first) recording, and the same moment in it; null without one. */
  recordingId: string | null;
  recordingMs: number | null;
}

/** One line of a summary (a decision, an open question, a section item). */
export interface SummaryItem {
  text: string;
  /** Transcript time; null when the model pointed at nothing. */
  startMs: number | null;
  endMs: number | null;
  /** The same moment in the recording; null without one. */
  recordingMs: number | null;
}

/** An action item (RT7). */
export interface SummaryActionItem extends SummaryItem {
  /** Stable within one version of a summary. */
  id: string | null;
  /** Set when the model named someone who is a member. */
  assigneeUserId: Uuid | null;
  /** The name as said (when no member matched, or alongside). */
  assigneeName: string | null;
  /** `YYYY-MM-DD` when a date or day was said. */
  dueDate: string | null;
  /** The words used ("by Friday"). */
  dueText: string | null;
}

/** A key moment. */
export interface SummaryMoment extends SummaryItem {
  /** = `text`: the moment's title. */
  title: string;
  speakerName: string | null;
}

/** A style's own section (standup per person, client call "Commitments"…). */
export interface SummarySection {
  title: string;
  items: SummaryItem[];
}

export type SummaryStatus =
  | 'waiting'
  | 'queued'
  | 'running'
  | 'ready'
  | 'failed'
  | 'skipped'
  | 'deleted';

/** A call's summary — from its chat message or `GET /v1/calls/:id/summary`. */
export interface CallSummary {
  /** The summary's id; null on a message without it. */
  id: string | null;
  callId: string;
  conversationId: Uuid | null;
  /** The chat message carrying it, when known. */
  messageId: Uuid | null;
  recordingId: string | null;
  /** `ready` for a message; any status from REST and events. */
  status: SummaryStatus;
  /** `default`, `standup`, `client_call`, `interview`, `one_on_one`, `retro`. */
  style: string;
  language: string | null;
  overview: string | null;
  decisions: SummaryItem[];
  actionItems: SummaryActionItem[];
  openQuestions: SummaryItem[];
  moments: SummaryMoment[];
  sections: SummarySection[];
  /** The message carries a cut-down copy: fetch the full one. */
  shortened: boolean;
  /** The transcript was too long and was cut before summarising. */
  truncated: boolean;
  /** failed: why; skipped: `no_speech` | `no_model` | `no_transcript`. */
  error: string | null;
}

/** A follow-up draft (RT12) — shown for review; poolse never sends it. */
export interface FollowUpDraft {
  callId: string;
  summaryId: string | null;
  conversationId: Uuid | null;
  channel: 'message' | 'email';
  language: string | null;
  /** Email only. */
  subject: string | null;
  /** Short Markdown for a message, plain text for an email. */
  body: string;
  to: Array<{ userId: Uuid; externalId: string | null; name: string | null }>;
  actionItems: SummaryActionItem[];
}

/** A source of an answer from `meetings.ask`. */
export interface MeetingCitation extends MeetingMoment {
  ref: string | null;
  /** `said`, `overview`, `decision`, `action item`, `open question`, `moment`. */
  kind: string;
  text: string;
  speakerName: string | null;
}

/** A meeting that was searched. */
export interface MeetingCallRef {
  callId: string;
  conversationId: Uuid | null;
  conversationName: string | null;
  startedAt: string | null;
  recordingId: string | null;
}

/** `meetings.ask` reply. */
export interface MeetingAnswer {
  /** Null when nothing in the visible meetings answers it. */
  answer: string | null;
  citations: MeetingCitation[];
  calls: MeetingCallRef[];
}

export type ClipStatus = 'queued' | 'cutting' | 'ready' | 'failed' | 'deleted';

/** A clip cut from a recording (RT9). Times are recording time. */
export interface Clip {
  id: string;
  callId: string | null;
  conversationId: Uuid | null;
  recordingId: string;
  status: ClipStatus;
  title: string | null;
  startMs: number;
  endMs: number;
  durationMs: number | null;
  contentType: string | null;
  sizeBytes: number | null;
  createdByUserId: Uuid | null;
  error: string | null;
  createdAt: string | null;
}

/** What a clip attachment was cut from (`attachment.clip`), when the server says. */
export interface ClipInfo {
  recordingId: string;
  startMs: number;
  endMs: number;
  clipId: string | null;
}

/** A recording chapter, in recording time. */
export interface RecordingChapter {
  title: string;
  startMs: number;
  endMs: number | null;
}

/** A stretch without speech, skipped by "Skip silence". */
export interface SilenceRange {
  startMs: number;
  endMs: number;
}

/** `GET /v1/recordings/:id/playback`. */
export interface RecordingPlayback {
  recording: Recording | null;
  /** Valid 5 minutes: fetch again when the media fails. */
  url: string;
  expiresAt: string | null;
  contentType: string | null;
  chapters: RecordingChapter[];
  summaryId: string | null;
  /** Segment times in recording ms; lines said before the recording are left out. */
  transcript: {
    id: string | null;
    language: string | null;
    /** Transcript start − recording start: recording ms = transcript ms + offsetMs. */
    offsetMs: number;
    segments: TranscriptSegment[];
  } | null;
}

/** Longest question `meetings.ask` sends. */
export const ASK_QUESTION_MAX = 1000;
/** Longest follow-up instructions. */
export const FOLLOW_UP_INSTRUCTIONS_MAX = 1000;

/** The speeds the players offer. */
export const PLAYBACK_RATES = [1, 1.25, 1.5, 2] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

// ── wire mapping (adjust here when the server contract changes) ─────────

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const ms = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
const unwrap = (res: unknown): unknown => obj(res)?.data ?? res;

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

// Like `clip`, but paragraphs and line breaks stay (an overview can
// have several).
function clipParagraphs(s: string, max: number): string {
  const t = s
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function itemFromWire(x: unknown, max = 1000): SummaryItem | null {
  if (typeof x === 'string') {
    return x.trim() ? { text: clip(x, max), startMs: null, endMs: null, recordingMs: null } : null;
  }
  const r = obj(x);
  const text = str(r?.text) ?? str(r?.title);
  if (!r || !text) return null;
  return {
    text: clip(text, max),
    startMs: ms(r.start_ms),
    endMs: ms(r.end_ms),
    recordingMs: ms(r.recording_ms),
  };
}

function items(v: unknown, max = 30): SummaryItem[] {
  return Array.isArray(v)
    ? v
        .map((x) => itemFromWire(x))
        .filter((x): x is SummaryItem => !!x)
        .slice(0, max)
    : [];
}

const STATUSES: readonly SummaryStatus[] = [
  'waiting',
  'queued',
  'running',
  'ready',
  'failed',
  'skipped',
  'deleted',
];

/** A Summary (REST, event or message body) → CallSummary; null when it isn't one. */
export function summaryFromWire(raw: unknown): CallSummary | null {
  const o = obj(raw);
  const callId = str(o?.call_id);
  if (!o || !callId) return null;
  const actionItems: SummaryActionItem[] = Array.isArray(o.action_items)
    ? o.action_items
        .map((x): SummaryActionItem | null => {
          const base = itemFromWire(x);
          if (!base) return null;
          const r = obj(x) ?? {};
          const dueDate = str(r.due_date);
          return {
            ...base,
            id: str(r.id),
            assigneeUserId: str(r.assignee_user_id),
            assigneeName: str(r.assignee_name),
            dueDate: dueDate && /^\d{4}-\d{2}-\d{2}/.test(dueDate) ? dueDate.slice(0, 10) : null,
            dueText: str(r.due_text),
          };
        })
        .filter((x): x is SummaryActionItem => !!x)
        .slice(0, 30)
    : [];
  const moments: SummaryMoment[] = Array.isArray(o.moments)
    ? o.moments
        .map((x): SummaryMoment | null => {
          const base = itemFromWire(x, 200);
          if (!base) return null;
          const r = obj(x) ?? {};
          return { ...base, title: base.text, speakerName: str(r.speaker_name) };
        })
        .filter((x): x is SummaryMoment => !!x)
        .sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity))
        .slice(0, 30)
    : [];
  const sections: SummarySection[] = Array.isArray(o.sections)
    ? o.sections
        .map((x): SummarySection | null => {
          const r = obj(x);
          const title = str(r?.title);
          if (!r || !title) return null;
          return { title: clip(title, 120), items: items(r.items) };
        })
        .filter((x): x is SummarySection => !!x && x.items.length > 0)
        .slice(0, 20)
    : [];
  const overview = str(o.overview);
  const status = STATUSES.includes(o.status as SummaryStatus)
    ? (o.status as SummaryStatus)
    : 'ready';
  return {
    id: str(o.summary_id) ?? str(o.id),
    callId,
    conversationId: str(o.conversation_id),
    messageId: str(o.message_id),
    recordingId: str(o.recording_id),
    status,
    style: str(o.style) ?? 'default',
    language: str(o.language),
    overview: overview ? clipParagraphs(overview, 4000) : null,
    decisions: items(o.decisions),
    actionItems,
    openQuestions: items(o.open_questions),
    moments,
    sections,
    shortened: o.shortened === true,
    truncated: o.truncated === true,
    error: str(o.error),
  };
}

/** The summary a message carries (`kind: "call_summary"`), else null. */
export function parseCallSummary(
  message: Pick<Message, 'type' | 'body'> & {
    id?: string;
    conversation_id?: string;
    deleted_at?: string | null;
  },
): CallSummary | null {
  const payload = kindPayload(message, 'call_summary');
  const s = payload ? summaryFromWire(payload) : null;
  if (!s) return null;
  return {
    ...s,
    conversationId: s.conversationId ?? message.conversation_id ?? null,
    messageId: s.messageId ?? message.id ?? null,
  };
}

function momentFromWire(r: Obj, callId: string): MeetingMoment {
  return {
    callId,
    conversationId: str(r.conversation_id),
    startMs: ms(r.start_ms),
    endMs: ms(r.end_ms),
    recordingId: str(r.recording_id),
    recordingMs: ms(r.recording_ms),
  };
}

/** `{data: {answer, citations, calls}}` → MeetingAnswer. */
export function meetingAnswerFromWire(raw: unknown): MeetingAnswer {
  const o = obj(unwrap(raw));
  const citations: MeetingCitation[] = Array.isArray(o?.citations)
    ? o.citations
        .map((x): MeetingCitation | null => {
          const r = obj(x);
          const callId = str(r?.call_id);
          if (!r || !callId) return null;
          return {
            ...momentFromWire(r, callId),
            ref: str(r.ref) ?? (typeof r.ref === 'number' ? String(r.ref) : null),
            kind: str(r.kind) ?? 'said',
            text: clip(str(r.text) ?? '', 300),
            speakerName: str(r.speaker_name),
          };
        })
        .filter((x): x is MeetingCitation => !!x)
        .slice(0, 30)
    : [];
  const calls: MeetingCallRef[] = Array.isArray(o?.calls)
    ? o.calls
        .map((x): MeetingCallRef | null => {
          const r = obj(x);
          const callId = str(r?.call_id);
          if (!r || !callId) return null;
          return {
            callId,
            conversationId: str(r.conversation_id),
            conversationName: str(r.conversation_name),
            startedAt: str(r.started_at),
            recordingId: str(r.recording_id),
          };
        })
        .filter((x): x is MeetingCallRef => !!x)
    : [];
  return { answer: str(o?.answer), citations, calls };
}

const CLIP_STATUSES: readonly ClipStatus[] = ['queued', 'cutting', 'ready', 'failed', 'deleted'];

/** A Clip row → Clip; null when it isn't one. */
export function clipFromWire(raw: unknown): Clip | null {
  const o = obj(raw);
  const id = str(o?.id);
  const recordingId = str(o?.recording_id);
  const startMs = ms(o?.start_ms);
  const endMs = ms(o?.end_ms);
  if (!o || !id || !recordingId || startMs === null || endMs === null) return null;
  return {
    id,
    callId: str(o.call_id),
    conversationId: str(o.conversation_id),
    recordingId,
    status: CLIP_STATUSES.includes(o.status as ClipStatus) ? (o.status as ClipStatus) : 'queued',
    title: str(o.title),
    startMs,
    endMs,
    durationMs: ms(o.duration_ms),
    contentType: str(o.content_type),
    sizeBytes: ms(o.size_bytes),
    createdByUserId: str(o.created_by_user_id),
    error: str(o.error),
    createdAt: str(o.created_at),
  };
}

/**
 * What a clip attachment was cut from, else null. Reads `attachment.clip`
 * (`{clip_id?, recording_id, start_ms, end_ms}`); an attachment the server
 * doesn't mark is an ordinary file.
 */
export function clipOf(attachment: Pick<Attachment, 'clip'> | null | undefined): ClipInfo | null {
  const c = obj(attachment?.clip);
  const recordingId = str(c?.recording_id);
  const startMs = ms(c?.start_ms);
  const endMs = ms(c?.end_ms);
  if (!c || !recordingId || startMs === null || endMs === null || endMs <= startMs) return null;
  return { recordingId, startMs, endMs, clipId: str(c.clip_id) ?? str(c.id) };
}

function chaptersFromWire(list: unknown): RecordingChapter[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((x): RecordingChapter | null => {
      const r = obj(x);
      const title = str(r?.title);
      const at = ms(r?.start_ms);
      return r && title && at !== null
        ? { title: clip(title, 120), startMs: at, endMs: ms(r.end_ms) }
        : null;
    })
    .filter((x): x is RecordingChapter => !!x)
    .sort((a, b) => a.startMs - b.startMs)
    .slice(0, 100);
}

/** `recording.chapters`, in time order (recording time). */
export function chaptersOf(
  recording: Pick<Recording, 'chapters'> | null | undefined,
): RecordingChapter[] {
  return chaptersFromWire(recording?.chapters);
}

/** `recording.silences` (optional, not sent by the server yet), in time order, overlaps merged. */
export function silencesOf(
  recording: Pick<Recording, 'silences'> | null | undefined,
): SilenceRange[] {
  const list = recording?.silences;
  if (!Array.isArray(list)) return [];
  const ranges = list
    .map((x): SilenceRange | null => {
      const r = obj(x);
      const a = ms(r?.start_ms);
      const b = ms(r?.end_ms);
      return a !== null && b !== null && b > a ? { startMs: a, endMs: b } : null;
    })
    .filter((x): x is SilenceRange => !!x)
    .sort((a, b) => a.startMs - b.startMs);
  const merged: SilenceRange[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.startMs <= last.endMs) last.endMs = Math.max(last.endMs, r.endMs);
    else merged.push({ ...r });
  }
  return merged;
}

/** `{data: {recording, url, expires_at, content_type, chapters, summary_id, transcript}}`. */
export function playbackFromWire(raw: unknown): RecordingPlayback {
  const o = obj(unwrap(raw)) ?? {};
  const t = obj(o.transcript);
  const segments: TranscriptSegment[] = Array.isArray(t?.segments)
    ? t.segments
        .map((x): TranscriptSegment | null => {
          const r = obj(x);
          const start = ms(r?.start_ms);
          if (!r || start === null || typeof r.text !== 'string') return null;
          return {
            speaker: str(r.speaker) ?? '',
            speaker_user_id: str(r.speaker_user_id),
            speaker_name: str(r.speaker_name),
            text: r.text,
            start_ms: start,
            end_ms: ms(r.end_ms) ?? start,
            language: str(r.language),
          };
        })
        .filter((x): x is TranscriptSegment => !!x)
        .sort((a, b) => a.start_ms - b.start_ms)
    : [];
  const recording = obj(o.recording) as unknown as Recording | null;
  return {
    recording,
    url: str(o.url) ?? '',
    expiresAt: str(o.expires_at),
    contentType: str(o.content_type),
    chapters: chaptersFromWire(o.chapters ?? recording?.chapters),
    summaryId: str(o.summary_id),
    transcript: t
      ? {
          id: str(t.id),
          language: str(t.language),
          offsetMs:
            typeof t.offset_ms === 'number' && Number.isFinite(t.offset_ms) ? t.offset_ms : 0,
          segments,
        }
      : null,
  };
}

function followUpFromWire(raw: unknown, callId: string): FollowUpDraft {
  const o = obj(unwrap(raw)) ?? {};
  const s = summaryFromWire({ call_id: callId, action_items: o.action_items });
  return {
    callId: str(o.call_id) ?? callId,
    summaryId: str(o.summary_id),
    conversationId: str(o.conversation_id),
    channel: o.channel === 'email' ? 'email' : 'message',
    language: str(o.language),
    subject: str(o.subject),
    body: typeof o.body === 'string' ? o.body : '',
    to: Array.isArray(o.to)
      ? o.to
          .map((x) => {
            const r = obj(x);
            const userId = str(r?.user_id);
            return userId ? { userId, externalId: str(r?.external_id), name: str(r?.name) } : null;
          })
          .filter((x): x is FollowUpDraft['to'][number] => !!x)
      : [],
    actionItems: s?.actionItems ?? [],
  };
}

/** The moment of a summary item, for `onOpenMoment`. */
export function momentOf(summary: CallSummary, item: SummaryItem): MeetingMoment {
  return {
    callId: summary.callId,
    conversationId: summary.conversationId,
    startMs: item.startMs,
    endMs: item.endMs,
    recordingId: summary.recordingId,
    recordingMs: item.recordingMs,
  };
}

// ── display and playback ────────────────────────────────────────────────

/** "Standup", "Client call", "Interview", "1:1", "Retro", else "Meeting". */
export function summaryStyleLabel(style: string): string {
  switch (style) {
    case 'standup':
      return 'Standup';
    case 'client_call':
      return 'Client call';
    case 'interview':
      return 'Interview';
    case 'one_on_one':
      return '1:1';
    case 'retro':
      return 'Retro';
    default:
      return 'Meeting';
  }
}

/**
 * Conversation-list preview for a summary body; null when it isn't one.
 * Previews are cut at 80 characters, so a cut-off body still reads as one.
 */
export function formatCallSummaryPreview(preview: string | null | undefined): string | null {
  if (typeof preview !== 'string') return null;
  const s = parseCallSummary({ type: 'system', body: preview });
  if (!s) return /^\s*\{.*"kind"\s*:\s*"call_summary"/.test(preview) ? 'Call summary' : null;
  const label = summaryStyleLabel(s.style);
  return label === 'Meeting' ? 'Call summary' : `Call summary · ${label}`;
}

/** Why a summary isn't there, in words; null for a ready one. */
export function summaryStatusText(s: Pick<CallSummary, 'status' | 'error'>): string | null {
  switch (s.status) {
    case 'ready':
      return null;
    case 'waiting':
      return 'The summary follows when the call ends.';
    case 'queued':
    case 'running':
      return 'Writing the summary…';
    case 'deleted':
      return 'This summary was deleted.';
    case 'skipped':
      return s.error === 'no_speech'
        ? 'Nothing was said, so there is no summary.'
        : s.error === 'no_model'
          ? 'Summaries aren’t set up on this server.'
          : 'There is no summary for this call.';
    default:
      return 'The summary couldn’t be written.';
  }
}

/** "Due 3 Dec" from a `YYYY-MM-DD` date, else the words used ("by Friday"); null without either. */
export function formatDue(
  dueDate: string | null,
  dueText?: string | null,
  locale?: string,
): string | null {
  if (dueDate) {
    // A bare date is a day, not midnight UTC.
    const d = /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
      ? new Date(`${dueDate}T12:00:00`)
      : new Date(dueDate);
    if (!Number.isNaN(d.getTime())) {
      return `Due ${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}`;
    }
  }
  return dueText ? clip(dueText, 60) : null;
}

/** The chapter playing at `atMs` (index), or -1 before the first. */
export function chapterIndexAt(chapters: readonly RecordingChapter[], atMs: number): number {
  let idx = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i]!.startMs <= atMs) idx = i;
    else break;
  }
  return idx;
}

/**
 * With "Skip silence" on: where to jump when the playhead `atMs` is in a
 * silence of at least `minMs` — its end, less a short lead-in — else null.
 */
export function skipSilenceTarget(
  silences: readonly SilenceRange[],
  atMs: number,
  minMs = 1500,
  leadMs = 250,
): number | null {
  for (const s of silences) {
    if (s.startMs > atMs) break;
    if (atMs >= s.startMs && atMs < s.endMs - leadMs && s.endMs - s.startMs >= minMs) {
      return s.endMs - leadMs;
    }
  }
  return null;
}

/**
 * Silences from a transcript: the gaps between segments of at least
 * `minMs` (default 2 s). The players use these for "Skip silence" when the
 * recording lists none. `segments` in time order.
 */
export function silencesFromSegments(
  segments: readonly Pick<TranscriptSegment, 'start_ms' | 'end_ms'>[],
  minMs = 2000,
): SilenceRange[] {
  const out: SilenceRange[] = [];
  let lastEnd = 0;
  for (const s of segments) {
    if (s.start_ms - lastEnd >= minMs) out.push({ startMs: lastEnd, endMs: s.start_ms });
    lastEnd = Math.max(lastEnd, s.end_ms);
  }
  return out;
}

/**
 * The segment being spoken at `atMs`: the last one that started at or
 * before it, or -1. `segments` in time order.
 */
export function activeSegmentIndex(
  segments: readonly Pick<TranscriptSegment, 'start_ms'>[],
  atMs: number,
): number {
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid]!.start_ms <= atMs) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** "1:05 – 1:40". */
export function formatTimeRange(startMs: number, endMs: number): string {
  return `${formatClock(startMs)} – ${formatClock(endMs)}`;
}

/** "0:42", "12:05", "1:02:33". */
export function formatClock(msValue: number): string {
  const total = Math.max(0, Math.floor(msValue / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Plain-language text for a failed summary, ask, clip or playback request. */
export function meetingsErrorMessage(err: unknown): string {
  const e = err as { code?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  switch (code) {
    case 'validation_failed':
      return 'That isn’t valid: questions can be up to 1000 characters, clips 1 s to 10 min.';
    case 'not_found':
      return 'That meeting couldn’t be found.';
    case 'forbidden':
      return 'You don’t have access to that meeting.';
    case 'no_model':
      return 'This needs an AI model, and none is set up on this server.';
    case 'model_error':
      return 'The AI model didn’t answer. Try again.';
    case 'no_transcript':
      return 'This call has no transcript to summarise.';
    case 'summary_running':
      return 'The summary is being written already.';
    case 'summary_not_ready':
      return 'The summary isn’t ready yet.';
    case 'legal_hold':
      return 'This is under a legal hold and can’t be deleted.';
    case 'not_ready':
      return 'The recording is still being saved. Try again in a moment.';
    case 'recording_deleted':
      return 'This recording was deleted.';
    case 'clip_deleted':
      return 'This clip was deleted.';
    case 'clip_running':
      return 'The clip is still being cut.';
    case 'recording_too_large':
      return 'This recording is too large to cut clips from.';
    case 'clips_unavailable':
      return 'Clips aren’t set up on this server.';
    case 'rate_limited':
      return 'Too many requests. Wait a minute and try again.';
    default:
      return 'Something went wrong. Try again.';
  }
}

// ── REST ────────────────────────────────────────────────────────────────

const call = (id: string) => `/v1/calls/${encodeURIComponent(id)}`;
const conversation = (id: string) => `/v1/conversations/${encodeURIComponent(id)}`;
const recordingPath = (id: string) => `/v1/recordings/${encodeURIComponent(id)}`;
const clipPath = (id: string) => `/v1/clips/${encodeURIComponent(id)}`;

/** A conversation's summary settings (`GET|PUT …/summary-settings`). */
export interface ConversationSummarySettings {
  enabled: boolean | null;
  style: string | null;
  effective: { enabled: boolean; style: string; post_to_chat: boolean };
}

/**
 * `poolse.meetings` — summaries, follow-up drafts, asking, clips and
 * playback. Errors are `ApiError` codes; `meetingsErrorMessage` words them.
 */
export class MeetingsResource {
  constructor(private readonly rest: RestClient) {}

  /**
   * `POST /v1/meetings/ask` — `{question, call_id?, conversation_id?}`.
   * Only meetings the user can see. `validation_failed` (empty or over
   * {@link ASK_QUESTION_MAX}), `forbidden` (the call), `rate_limited`
   * (20/min), `no_model` (503).
   */
  async ask(opts: {
    question: string;
    callId?: string | null;
    conversationId?: string | null;
    signal?: AbortSignal;
  }): Promise<MeetingAnswer> {
    const question = opts.question.trim().slice(0, ASK_QUESTION_MAX);
    const res = await this.rest.request<unknown>({
      method: 'POST',
      path: '/v1/meetings/ask',
      body: {
        question,
        ...(opts.callId ? { call_id: opts.callId } : {}),
        ...(opts.conversationId ? { conversation_id: opts.conversationId } : {}),
      },
      // Answers cost model time: no silent repeats.
      maxRetries: 0,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return meetingAnswerFromWire(res);
  }

  /** `GET /v1/calls/:id/summary` — the full summary (any status); `not_found` (404) none yet. */
  async summary(callId: string, signal?: AbortSignal): Promise<CallSummary> {
    const res = await this.rest.request<unknown>({
      method: 'GET',
      path: `${call(callId)}/summary`,
      ...(signal ? { signal } : {}),
    });
    return requireSummary(res);
  }

  /**
   * `POST /v1/calls/:id/summary` `{style?, post?}` — write it again
   * (`queued`; `summary:ready` follows). `post: true` posts a new chat
   * message. `no_transcript`, `summary_running` (409), `rate_limited`.
   */
  async regenerateSummary(
    callId: string,
    opts: { style?: string; post?: boolean; signal?: AbortSignal } = {},
  ): Promise<CallSummary> {
    const res = await this.rest.request<unknown>({
      method: 'POST',
      path: `${call(callId)}/summary`,
      body: {
        ...(opts.style ? { style: opts.style } : {}),
        ...(opts.post !== undefined ? { post: opts.post } : {}),
      },
      maxRetries: 0,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return requireSummary(res);
  }

  /** `DELETE /v1/calls/:id/summary` — `legal_hold`, `summary_running` (409). */
  async deleteSummary(callId: string, signal?: AbortSignal): Promise<CallSummary> {
    const res = await this.rest.request<unknown>({
      method: 'DELETE',
      path: `${call(callId)}/summary`,
      ...(signal ? { signal } : {}),
    });
    return requireSummary(res);
  }

  /** `GET /v1/conversations/:id/summaries` — newest first. */
  async summaries(
    conversationId: string,
    opts: { limit?: number; before?: string; signal?: AbortSignal } = {},
  ): Promise<CallSummary[]> {
    const res = await this.rest.request<unknown>({
      method: 'GET',
      path: `${conversation(conversationId)}/summaries`,
      query: {
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        ...(opts.before !== undefined ? { before: opts.before } : {}),
      },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const rows = unwrap(res);
    return Array.isArray(rows)
      ? rows.map(summaryFromWire).filter((s): s is CallSummary => !!s)
      : [];
  }

  /** `GET /v1/summary-styles` — `[{id, name}]` for a picker. */
  async styles(signal?: AbortSignal): Promise<Array<{ id: string; name: string }>> {
    const res = await this.rest.request<unknown>({
      method: 'GET',
      path: '/v1/summary-styles',
      ...(signal ? { signal } : {}),
    });
    const rows = unwrap(res);
    return Array.isArray(rows)
      ? rows
          .map((r) => {
            const o = obj(r);
            const id = str(o?.id);
            return id ? { id, name: str(o?.name) ?? summaryStyleLabel(id) } : null;
          })
          .filter((x): x is { id: string; name: string } => !!x)
      : [];
  }

  /** `PUT /v1/calls/:id/summary-settings` `{style}` — this meeting's style. */
  async setCallStyle(callId: string, style: string, signal?: AbortSignal): Promise<CallSummary> {
    const res = await this.rest.request<unknown>({
      method: 'PUT',
      path: `${call(callId)}/summary-settings`,
      body: { style },
      ...(signal ? { signal } : {}),
    });
    return requireSummary(res);
  }

  /** `GET /v1/conversations/:id/summary-settings`. */
  async conversationSettings(
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<ConversationSummarySettings> {
    const res = await this.rest.request<{ data: ConversationSummarySettings }>({
      method: 'GET',
      path: `${conversation(conversationId)}/summary-settings`,
      ...(signal ? { signal } : {}),
    });
    return res.data;
  }

  /** `PUT /v1/conversations/:id/summary-settings` — owners and admins (`forbidden`). */
  async updateConversationSettings(
    conversationId: string,
    patch: { enabled?: boolean | null; style?: string | null },
    signal?: AbortSignal,
  ): Promise<ConversationSummarySettings> {
    const res = await this.rest.request<{ data: ConversationSummarySettings }>({
      method: 'PUT',
      path: `${conversation(conversationId)}/summary-settings`,
      body: patch,
      ...(signal ? { signal } : {}),
    });
    return res.data;
  }

  /**
   * `POST /v1/calls/:id/summary/follow-up` `{channel, instructions?}` — a
   * draft to review; poolse never sends it. `summary_not_ready` (409),
   * `no_model` (503), `model_error` (502), `rate_limited`.
   */
  async followUp(
    callId: string,
    opts: { channel?: 'message' | 'email'; instructions?: string; signal?: AbortSignal } = {},
  ): Promise<FollowUpDraft> {
    const instructions = opts.instructions?.trim().slice(0, FOLLOW_UP_INSTRUCTIONS_MAX);
    const res = await this.rest.request<unknown>({
      method: 'POST',
      path: `${call(callId)}/summary/follow-up`,
      body: { channel: opts.channel ?? 'message', ...(instructions ? { instructions } : {}) },
      maxRetries: 0,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return followUpFromWire(res, callId);
  }

  /**
   * `GET /v1/recordings/:id/playback` — a 5-minute link, chapters and the
   * transcript in recording time. `not_ready` (409), `recording_deleted` (410).
   */
  async playback(recordingId: string, signal?: AbortSignal): Promise<RecordingPlayback> {
    const res = await this.rest.request<unknown>({
      method: 'GET',
      path: `${recordingPath(recordingId)}/playback`,
      ...(signal ? { signal } : {}),
    });
    return playbackFromWire(res);
  }

  /**
   * `POST /v1/recordings/:id/clips` `{start_ms, end_ms, base?, title?}` —
   * cut a clip (`queued`; `clip:ready` follows). `base: 'transcript'` takes
   * transcript times. 1 s to 10 min. `not_ready`, `recording_deleted`,
   * `recording_too_large`, `validation_failed`, `rate_limited`,
   * `clips_unavailable`.
   */
  async createClip(
    recordingId: string,
    opts: {
      startMs: number;
      endMs: number;
      base?: 'recording' | 'transcript';
      title?: string;
      signal?: AbortSignal;
    },
  ): Promise<Clip> {
    const res = await this.rest.request<unknown>({
      method: 'POST',
      path: `${recordingPath(recordingId)}/clips`,
      body: {
        start_ms: Math.max(0, Math.round(opts.startMs)),
        end_ms: Math.max(0, Math.round(opts.endMs)),
        ...(opts.base ? { base: opts.base } : {}),
        ...(opts.title?.trim() ? { title: opts.title.trim().slice(0, 200) } : {}),
      },
      maxRetries: 0,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return requireClip(res);
  }

  /** `GET /v1/recordings/:id/clips`. */
  async clips(recordingId: string, signal?: AbortSignal): Promise<Clip[]> {
    const res = await this.rest.request<unknown>({
      method: 'GET',
      path: `${recordingPath(recordingId)}/clips`,
      ...(signal ? { signal } : {}),
    });
    const rows = unwrap(res);
    return Array.isArray(rows) ? rows.map(clipFromWire).filter((c): c is Clip => !!c) : [];
  }

  /** `GET /v1/clips/:id`. */
  async clip(clipId: string, signal?: AbortSignal): Promise<Clip> {
    const res = await this.rest.request<unknown>({
      method: 'GET',
      path: clipPath(clipId),
      ...(signal ? { signal } : {}),
    });
    return requireClip(res);
  }

  /** `GET /v1/clips/:id/download-url` — 5 minutes; `not_ready`, `clip_deleted`. */
  async clipDownloadUrl(
    clipId: string,
    signal?: AbortSignal,
  ): Promise<{ url: string; expiresAt: string | null; contentType: string | null }> {
    const res = await this.rest.request<unknown>({
      method: 'GET',
      path: `${clipPath(clipId)}/download-url`,
      ...(signal ? { signal } : {}),
    });
    const o = obj(unwrap(res)) ?? {};
    return {
      url: str(o.url) ?? '',
      expiresAt: str(o.expires_at),
      contentType: str(o.content_type),
    };
  }

  /**
   * `POST /v1/clips/:id/attachment` — a pending attachment of yours
   * holding the clip; send it with a message (`attachment_ids`).
   */
  async clipAttachment(clipId: string, signal?: AbortSignal): Promise<{ attachmentId: string }> {
    const res = await this.rest.request<unknown>({
      method: 'POST',
      path: `${clipPath(clipId)}/attachment`,
      body: {},
      ...(signal ? { signal } : {}),
    });
    const id = str(obj(unwrap(res))?.attachment_id);
    if (!id) throw new TypeError('clip attachment: no attachment_id in the reply');
    return { attachmentId: id };
  }

  /** `DELETE /v1/clips/:id` — its maker or owners/admins; `legal_hold`, `clip_running`. */
  async deleteClip(clipId: string, signal?: AbortSignal): Promise<Clip> {
    const res = await this.rest.request<unknown>({
      method: 'DELETE',
      path: clipPath(clipId),
      ...(signal ? { signal } : {}),
    });
    return requireClip(res);
  }
}

function requireSummary(res: unknown): CallSummary {
  const s = summaryFromWire(unwrap(res));
  if (!s) throw new TypeError('summary: unexpected reply');
  return s;
}

function requireClip(res: unknown): Clip {
  const c = clipFromWire(unwrap(res));
  if (!c) throw new TypeError('clip: unexpected reply');
  return c;
}
