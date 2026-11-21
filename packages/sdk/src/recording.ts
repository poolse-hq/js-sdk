// Recording and transcript helpers shared by every UI package:
//
//   * the `{"kind":"recording",…}` system message the server posts when a
//     recording starts or stops — the notice for anyone who comes later —
//     parsed and worded per viewer, like `call-log.ts` does for calls;
//   * which call participants are poolse's own (the transcript assistant,
//     the recorder) and must not be shown as people;
//   * folding live transcript segments (interim and final) into a list.

import type { Message, Uuid } from './types.js';
import type { RecordingMode, TranscriptSegment } from './resources/calls.js';

/** A parsed recording notice (`kind: "recording"`, v1). */
export interface RecordingNotice {
  kind: 'recording';
  event: 'started' | 'stopped';
  callId: string;
  recordingId: string | null;
  mode: RecordingMode;
  auto: boolean;
  consentRequired: boolean;
  startedByUserId: Uuid | null;
  stoppedByUserId: Uuid | null;
}

/** Parse a raw body; null for anything that isn't a recording notice. */
export function parseRecordingNoticeBody(body: string | null | undefined): RecordingNotice | null {
  if (typeof body !== 'string') return null;
  const trimmed = body.trim();
  if (!trimmed.startsWith('{') || !trimmed.includes('"recording"')) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.kind !== 'recording') return null;
  if (obj.event !== 'started' && obj.event !== 'stopped') return null;
  if (typeof obj.call_id !== 'string' || obj.call_id === '') return null;
  const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
  return {
    kind: 'recording',
    event: obj.event,
    callId: obj.call_id,
    recordingId: str(obj.recording_id),
    mode: obj.mode === 'audio' ? 'audio' : 'video',
    auto: obj.auto === true,
    consentRequired: obj.consent_required === true,
    startedByUserId: str(obj.started_by_user_id),
    stoppedByUserId: str(obj.stopped_by_user_id),
  };
}

/** Parse a message: only `system` / `custom` ones, never deleted ones. */
export function parseRecordingNotice(
  message: Pick<Message, 'type' | 'body'> & { deleted_at?: string | null },
): RecordingNotice | null {
  if (message.type !== 'system' && message.type !== 'custom') return null;
  if (message.deleted_at) return null;
  return parseRecordingNoticeBody(message.body);
}

/** Render-ready wording of a recording notice for one viewer. */
export interface RecordingNoticeDisplay {
  event: 'started' | 'stopped';
  mode: RecordingMode;
  /** "Recording started", "Audio recording stopped". */
  title: string;
  /** "by you", "by Elena", "Automatic", with "consent required" when it applies; null when unknown. */
  detail: string | null;
  /** One line, for list previews: "Recording started · by Elena". */
  summary: string;
}

/**
 * Word a recording notice for `currentUserId`. `nameFor` turns a poolse
 * user id into a display name (null when unknown: the name is left out —
 * a raw id is never shown).
 */
export function describeRecordingNotice(
  notice: RecordingNotice,
  currentUserId: string | null,
  nameFor?: (userId: Uuid) => string | null | undefined,
): RecordingNoticeDisplay {
  const what = notice.mode === 'audio' ? 'Audio recording' : 'Recording';
  const title = `${what} ${notice.event}`;
  const actor = notice.event === 'started' ? notice.startedByUserId : notice.stoppedByUserId;
  let by: string | null = null;
  if (actor && actor === currentUserId) by = 'by you';
  else if (actor) {
    const name = nameFor?.(actor);
    if (name) by = `by ${name}`;
  } else if (notice.event === 'started' && notice.auto) by = 'Automatic';
  const parts = [
    by,
    notice.event === 'started' && notice.consentRequired ? 'consent required' : null,
  ].filter((p): p is string => !!p);
  const detail = parts.length ? parts.join(', ') : null;
  return {
    event: notice.event,
    mode: notice.mode,
    title,
    detail,
    summary: detail ? `${title} · ${detail}` : title,
  };
}

/**
 * Parse + describe in one go: `undefined` when the message isn't a
 * recording notice, else its display.
 */
export function recordingNoticeDisplayFor(
  message: Pick<Message, 'type' | 'body'> & { deleted_at?: string | null },
  currentUserId: string | null,
  nameFor?: (userId: Uuid) => string | null | undefined,
): RecordingNoticeDisplay | undefined {
  const notice = parseRecordingNotice(message);
  return notice ? describeRecordingNotice(notice, currentUserId, nameFor) : undefined;
}

/** Conversation-list preview text for a recording notice body; null when it isn't one. */
export function formatRecordingNoticePreview(
  preview: string | null | undefined,
  currentUserId: string | null,
): string | null {
  const notice = parseRecordingNoticeBody(preview);
  return notice ? describeRecordingNotice(notice, currentUserId).summary : null;
}

/** The identity prefix of poolse's own call participants (`poolse:assistant:<call_id>`). */
export const POOLSE_SERVICE_IDENTITY_PREFIX = 'poolse:';

/**
 * True for a call participant that is poolse itself rather than a
 * person: the transcript/notice assistant (`poolse:…`, LiveKit kind
 * AGENT) or LiveKit Egress's recorder (`EG_…`). Leave them out of
 * participant lists, grids and "alone" checks.
 */
export function isServiceParticipant(identity: string | null | undefined, kind?: unknown): boolean {
  if (typeof identity !== 'string') return false;
  if (identity.startsWith(POOLSE_SERVICE_IDENTITY_PREFIX)) return true;
  if (identity.startsWith('EG_')) return true;
  // livekit-client's `ParticipantKind` is a string enum ('egress',
  // 'agent'); the protocol's is numeric (2 = EGRESS, 4 = AGENT). SIP
  // (phone) participants are people and stay.
  if (typeof kind === 'string') return /^(egress|agent)$/i.test(kind);
  return kind === 2 || kind === 4;
}

/** A live transcript segment as the UI keeps it. */
export interface LiveTranscriptSegment extends TranscriptSegment {
  /** False while the speaker is still talking: the next segment from them replaces it. */
  final: boolean;
}

/**
 * Fold one pushed segment into a live list: an interim segment replaces
 * the speaker's previous interim one; a final one replaces it too and
 * stays. Finals are kept in time order, the open interims after them.
 * Returns a new array; at most `max` finals are kept (oldest dropped).
 */
export function applyLiveSegment(
  list: readonly LiveTranscriptSegment[],
  segment: LiveTranscriptSegment,
  max = 1000,
): LiveTranscriptSegment[] {
  const withoutInterim = list.filter((s) => s.final || s.speaker !== segment.speaker);
  const finals = withoutInterim.filter((s) => s.final);
  const interims = withoutInterim.filter((s) => !s.final);
  if (segment.final) {
    // A redelivered final (a rejoin's catch-up overlapping the stream) is kept once.
    const dup = finals.some(
      (s) =>
        s.speaker === segment.speaker && s.start_ms === segment.start_ms && s.text === segment.text,
    );
    if (!dup) {
      let i = finals.length;
      while (i > 0 && finals[i - 1]!.start_ms > segment.start_ms) i--;
      finals.splice(i, 0, segment);
    }
    if (finals.length > max) finals.splice(0, finals.length - max);
  } else {
    interims.push(segment);
  }
  return [...finals, ...interims];
}
