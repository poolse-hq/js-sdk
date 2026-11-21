// After the call (docs: README "Meetings"):
//
//   * the summary the server posts into the call's conversation — a
//     `{"kind":"call_summary",…}` message with decisions, action items,
//     open questions and key moments (RT6, RT7, RT10);
//   * asking your meetings — `POST /v1/meetings/ask` (RT8);
//   * clips — attachments cut from a recording, carrying `clip` (RT9);
//   * playback helpers — chapters, silence ranges and the transcript
//     line under the playhead (RT13).
//
// As in agents.ts, every wire shape is read in the "wire mapping"
// section and nowhere else.

import type { Recording, TranscriptSegment } from './resources/calls.js';
import type { RestClient } from './rest-client.js';
import type { Attachment, Message, Uuid } from './types.js';
import { kindPayload } from './agents.js';

/** One action item of a summary. */
export interface SummaryActionItem {
  text: string;
  /** Who it's for (poolse user id); null when nobody was named. */
  assigneeUserId: Uuid | null;
  /** `YYYY-MM-DD` or an ISO time; null without a date. */
  due: string | null;
}

/** A key moment, linked to its point in the recording. */
export interface SummaryMoment {
  label: string;
  /** Ms since the call's transcript started. */
  startMs: number;
}

/** A call's summary (`kind: "call_summary"`). */
export interface CallSummary {
  callId: string;
  conversationId: Uuid | null;
  messageId: Uuid | null;
  /** The summary style: `standup`, `client_call`, `interview`, `one_on_one`, `retro`, `default`… */
  style: string;
  /** A short overview paragraph, when the style has one. */
  overview: string | null;
  decisions: string[];
  actionItems: SummaryActionItem[];
  openQuestions: string[];
  moments: SummaryMoment[];
  /** The call's recording, when there is one. */
  recordingId: string | null;
}

/** A link from an answer to a moment of a meeting. */
export interface MeetingLink {
  callId: string;
  startMs: number;
  snippet: string;
}

/** `meetings.ask` reply. */
export interface MeetingAnswer {
  answer: string;
  links: MeetingLink[];
}

/** What a clip attachment was cut from. */
export interface ClipInfo {
  recordingId: string;
  startMs: number;
  endMs: number;
}

/** A recording chapter (`recording.chapters`). */
export interface RecordingChapter {
  title: string;
  startMs: number;
}

/** A stretch without speech (`recording.silences`), skipped by "Skip silence". */
export interface SilenceRange {
  startMs: number;
  endMs: number;
}

/** Longest question `meetings.ask` sends. */
export const ASK_QUESTION_MAX = 1000;

/** The speeds the players offer. */
export const PLAYBACK_RATES = [1, 1.25, 1.5, 2] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

// ── wire mapping (adjust here when the server contract changes) ─────────

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const ms = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** A list of strings, or of `{text}` objects. */
function textList(v: unknown, max = 50): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) =>
      typeof x === 'string'
        ? x
        : x && typeof x === 'object'
          ? (str((x as Record<string, unknown>).text) ?? '')
          : '',
    )
    .filter((x) => x.trim() !== '')
    .slice(0, max)
    .map((x) => clip(x, 1000));
}

/** The summary a message carries, else null. */
export function parseCallSummary(
  message: Pick<Message, 'type' | 'body'> & {
    id?: string;
    conversation_id?: string;
    deleted_at?: string | null;
  },
): CallSummary | null {
  const o = kindPayload(message, 'call_summary');
  if (!o) return null;
  const callId = str(o.call_id);
  if (!callId) return null;
  const actionItems: SummaryActionItem[] = Array.isArray(o.action_items)
    ? o.action_items
        .map((x): SummaryActionItem | null => {
          if (typeof x === 'string')
            return { text: clip(x, 1000), assigneeUserId: null, due: null };
          if (!x || typeof x !== 'object') return null;
          const r = x as Record<string, unknown>;
          const text = str(r.text);
          if (!text) return null;
          return {
            text: clip(text, 1000),
            assigneeUserId: str(r.assignee_user_id),
            due: str(r.due),
          };
        })
        .filter((x): x is SummaryActionItem => !!x)
        .slice(0, 50)
    : [];
  const moments: SummaryMoment[] = Array.isArray(o.moments)
    ? o.moments
        .map((x): SummaryMoment | null => {
          if (!x || typeof x !== 'object') return null;
          const r = x as Record<string, unknown>;
          const label = str(r.label);
          const at = ms(r.start_ms);
          return label && at !== null ? { label: clip(label, 200), startMs: at } : null;
        })
        .filter((x): x is SummaryMoment => !!x)
        .sort((a, b) => a.startMs - b.startMs)
        .slice(0, 50)
    : [];
  const overview = str(o.overview) ?? str(o.summary);
  return {
    callId,
    conversationId: message.conversation_id ?? null,
    messageId: message.id ?? null,
    style: str(o.style) ?? 'default',
    overview: overview ? clip(overview, 2000) : null,
    decisions: textList(o.decisions),
    actionItems,
    openQuestions: textList(o.open_questions),
    moments,
    recordingId: str(o.recording_id),
  };
}

/** `{answer, links: [{call_id, start_ms, snippet}]}` → MeetingAnswer. */
export function meetingAnswerFromWire(raw: unknown): MeetingAnswer {
  const o = (
    raw && typeof raw === 'object' && 'data' in (raw as object)
      ? (raw as { data: unknown }).data
      : raw
  ) as Record<string, unknown> | null;
  const links: MeetingLink[] = Array.isArray(o?.links)
    ? o.links
        .map((x): MeetingLink | null => {
          if (!x || typeof x !== 'object') return null;
          const r = x as Record<string, unknown>;
          const callId = str(r.call_id);
          const at = ms(r.start_ms);
          if (!callId || at === null) return null;
          return { callId, startMs: at, snippet: clip(str(r.snippet) ?? '', 200) };
        })
        .filter((x): x is MeetingLink => !!x)
        .slice(0, 20)
    : [];
  return { answer: str(o?.answer) ?? '', links };
}

/** The clip an attachment is (`attachment.clip`), else null. */
export function clipOf(attachment: Pick<Attachment, 'clip'> | null | undefined): ClipInfo | null {
  const c = attachment?.clip as Record<string, unknown> | null | undefined;
  if (!c || typeof c !== 'object') return null;
  const recordingId = str(c.recording_id);
  const startMs = ms(c.start_ms);
  const endMs = ms(c.end_ms);
  if (!recordingId || startMs === null || endMs === null || endMs <= startMs) return null;
  return { recordingId, startMs, endMs };
}

/** `recording.chapters`, in time order. */
export function chaptersOf(
  recording: Pick<Recording, 'chapters'> | null | undefined,
): RecordingChapter[] {
  const list = recording?.chapters;
  if (!Array.isArray(list)) return [];
  return list
    .map((x): RecordingChapter | null => {
      if (!x || typeof x !== 'object') return null;
      const r = x as unknown as Record<string, unknown>;
      const title = str(r.title);
      const at = ms(r.start_ms);
      return title && at !== null ? { title: clip(title, 120), startMs: at } : null;
    })
    .filter((x): x is RecordingChapter => !!x)
    .sort((a, b) => a.startMs - b.startMs)
    .slice(0, 100);
}

/** `recording.silences` (optional), in time order, overlaps merged. */
export function silencesOf(
  recording: Pick<Recording, 'silences'> | null | undefined,
): SilenceRange[] {
  const list = recording?.silences;
  if (!Array.isArray(list)) return [];
  const ranges = list
    .map((x): SilenceRange | null => {
      if (!x || typeof x !== 'object') return null;
      const r = x as unknown as Record<string, unknown>;
      const a = ms(r.start_ms);
      const b = ms(r.end_ms);
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

// ── display and playback ────────────────────────────────────────────────

/** "Standup", "Client call", "Interview", "1:1", "Retro", else "Call summary". */
export function summaryStyleLabel(style: string): string {
  switch (style) {
    case 'standup':
      return 'Standup';
    case 'client_call':
    case 'client':
      return 'Client call';
    case 'interview':
      return 'Interview';
    case 'one_on_one':
    case '1:1':
      return '1:1';
    case 'retro':
      return 'Retro';
    default:
      return 'Call summary';
  }
}

/** Conversation-list preview for a summary body; null when it isn't one. */
export function formatCallSummaryPreview(preview: string | null | undefined): string | null {
  if (typeof preview !== 'string') return null;
  const s = parseCallSummary({ type: 'custom', body: preview });
  // Previews are cut at 80 chars: a cut-off body still reads as a summary.
  if (!s) return /^\s*\{.*"kind"\s*:\s*"call_summary"/.test(preview) ? 'Call summary' : null;
  const label = summaryStyleLabel(s.style);
  return label === 'Call summary' ? 'Call summary' : `Call summary · ${label}`;
}

/** "Due 3 Dec" for an action item's date; null when it has none or it doesn't parse. */
export function formatDue(due: string | null, locale?: string): string | null {
  if (!due) return null;
  // A bare date is a day, not midnight UTC.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(due) ? new Date(`${due}T12:00:00`) : new Date(due);
  if (Number.isNaN(d.getTime())) return null;
  return `Due ${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}`;
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
 * With "Skip silence" on: where to jump when the playhead `atMs` is in
 * a silence of at least `minMs` — its end, less a short lead-in — else
 * null (keep playing).
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
 * How far into the transcript a recording starts: recording time +
 * this = transcript time. 0 when either start is unknown. The two
 * clocks differ when transcription began before (or after) recording.
 */
export function transcriptOffsetMs(
  recordingStartedAt: string | null | undefined,
  transcriptStartedAt: string | null | undefined,
): number {
  if (!recordingStartedAt || !transcriptStartedAt) return 0;
  const d = Date.parse(recordingStartedAt) - Date.parse(transcriptStartedAt);
  return Number.isFinite(d) ? d : 0;
}

/**
 * The segment being spoken at `atMs` (transcript time): the last one
 * that started at or before it, or -1. `segments` in time order.
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

/** Plain-language text for a failed `meetings.ask`, or a recording that won't play. */
export function meetingsErrorMessage(err: unknown): string {
  const e = err as { code?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  switch (code) {
    case 'validation_failed':
      return `Questions can be up to ${ASK_QUESTION_MAX} characters.`;
    case 'not_found':
      return 'That meeting couldn’t be found.';
    case 'forbidden':
      return 'You don’t have access to that meeting.';
    case 'ask_unavailable':
    case 'llm_unavailable':
      return 'Asking about meetings isn’t set up on this server.';
    case 'not_ready':
      return 'The recording is still being saved. Try again in a moment.';
    case 'rate_limited':
      return 'Too many questions. Wait a minute and try again.';
    default:
      return 'Something went wrong. Try again.';
  }
}

// ── REST ────────────────────────────────────────────────────────────────

/** `poolse.meetings` — ask what was said in your meetings. */
export class MeetingsResource {
  constructor(private readonly rest: RestClient) {}

  /**
   * `POST /v1/meetings/ask` — `{question, call_id?}`. Only meetings the
   * user could see are searched. Without `callId`: all of them.
   * Errors (`ApiError.code`): `validation_failed` (empty or longer than
   * {@link ASK_QUESTION_MAX}), `not_found` / `forbidden` (the call),
   * `rate_limited`.
   */
  async ask(opts: {
    question: string;
    callId?: string | null;
    signal?: AbortSignal;
  }): Promise<MeetingAnswer> {
    const question = opts.question.trim().slice(0, ASK_QUESTION_MAX);
    const res = await this.rest.request<unknown>({
      method: 'POST',
      path: '/v1/meetings/ask',
      body: { question, ...(opts.callId ? { call_id: opts.callId } : {}) },
      // Answers cost model time: no silent repeats.
      maxRetries: 0,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return meetingAnswerFromWire(res);
  }
}
