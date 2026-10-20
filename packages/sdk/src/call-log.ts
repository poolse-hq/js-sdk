// Call-log messages — the server records finished calls as chat
// messages so they appear inline in the conversation timeline. They
// arrive as `type: 'system'` (or, in future, `type: 'custom'`) with a
// JSON body:
//
//   {"kind":"call","call_id":"…","media":"audio"|"video",
//    "duration_ms":12345|null,"joined_user_ids":["uuid",…]}
//
//   {"kind":"call_missed","call_id":"…","user_id":"uuid"}
//
// `call_missed` is a per-callee marker: only the named user should
// see it ("Missed call"); everyone else hides it.
//
// The helpers here are pure + framework-agnostic so every UI package
// (web, React Native, or a customer's own) parses the payload the
// same way. Anything that isn't a well-formed call log returns null,
// so callers fall back to their normal system-message rendering.

import type { Message, Uuid } from './types.js';

export type CallLogMedia = 'audio' | 'video';

/** A completed (answered or unanswered) call. */
export interface CallLogEntry {
  kind: 'call';
  callId: string;
  media: CallLogMedia;
  /** Talk time in ms; `null` when nobody answered. */
  durationMs: number | null;
  joinedUserIds: Uuid[];
}

/** Per-callee "you missed this call" marker. */
export interface CallMissedEntry {
  kind: 'call_missed';
  callId: string;
  /** The callee who missed the call — the only user who should see it. */
  userId: Uuid;
  /** Present when the server includes it; defaults to `'audio'` for display. */
  media: CallLogMedia | null;
}

export type CallLog = CallLogEntry | CallMissedEntry;

/**
 * Parse a raw message body (or a conversation's `last_message_preview`)
 * into a call log. Returns null for non-JSON or unknown shapes.
 */
export function parseCallLogBody(body: string | null | undefined): CallLog | null {
  if (typeof body !== 'string') return null;
  const trimmed = body.trim();
  // Cheap pre-check so ordinary text never hits JSON.parse.
  if (!trimmed.startsWith('{') || !trimmed.includes('"kind"')) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const callId = typeof obj.call_id === 'string' ? obj.call_id : null;
  if (!callId) return null;
  const media = obj.media === 'audio' || obj.media === 'video' ? obj.media : null;

  if (obj.kind === 'call') {
    const d = obj.duration_ms;
    const durationMs = typeof d === 'number' && Number.isFinite(d) && d >= 0 ? d : null;
    const joined = Array.isArray(obj.joined_user_ids)
      ? obj.joined_user_ids.filter((u): u is string => typeof u === 'string')
      : [];
    return {
      kind: 'call',
      callId,
      media: media ?? 'audio',
      durationMs,
      joinedUserIds: joined,
    };
  }
  if (obj.kind === 'call_missed') {
    if (typeof obj.user_id !== 'string' || obj.user_id === '') return null;
    return { kind: 'call_missed', callId, userId: obj.user_id, media };
  }
  return null;
}

/**
 * Parse a message into a call log. Only `system` / `custom` messages
 * are considered; text messages that happen to contain JSON are
 * never treated as call logs. Deleted messages return null.
 */
export function parseCallLog(
  message: Pick<Message, 'type' | 'body'> & { deleted_at?: string | null },
): CallLog | null {
  if (message.type !== 'system' && message.type !== 'custom') return null;
  if (message.deleted_at) return null;
  return parseCallLogBody(message.body);
}

/** True when the message is a call log of either kind. */
export function isCallLogMessage(
  message: Pick<Message, 'type' | 'body'> & { deleted_at?: string | null },
): boolean {
  return parseCallLog(message) !== null;
}

/** `3:12`, `0:05`, `1:02:03`. Rounds to the nearest second. */
export function formatCallDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

/** Render-ready description of a call log for one viewer. */
export interface CallLogDisplay {
  media: CallLogMedia;
  /** "Voice call" / "Video call" / "Missed call". */
  title: string;
  /** "3:12" when answered, "No answer" when not, null for missed markers. */
  detail: string | null;
  /** True for the viewer's own missed-call marker — render in the error tone. */
  missed: boolean;
  /** Short one-line form for list previews ("Video call · 3:12"). */
  summary: string;
}

/**
 * Turn a call log into display copy for `currentUserId`. Returns null
 * when the entry should be hidden for this viewer (a `call_missed`
 * marker addressed to someone else).
 */
export function describeCallLog(log: CallLog, currentUserId: string | null): CallLogDisplay | null {
  if (log.kind === 'call_missed') {
    if (currentUserId === null || log.userId !== currentUserId) return null;
    const media = log.media ?? 'audio';
    return { media, title: 'Missed call', detail: null, missed: true, summary: 'Missed call' };
  }
  const title = log.media === 'video' ? 'Video call' : 'Voice call';
  const detail = log.durationMs !== null ? formatCallDuration(log.durationMs) : 'No answer';
  return {
    media: log.media,
    title,
    detail,
    missed: false,
    summary: `${title} · ${detail}`,
  };
}

/**
 * Convenience: parse + describe a message in one go. Returns
 * `undefined` when the message isn't a call log at all, `null` when
 * it IS one but is hidden for this viewer, otherwise the display.
 */
export function callLogDisplayFor(
  message: Pick<Message, 'type' | 'body'> & { deleted_at?: string | null },
  currentUserId: string | null,
): CallLogDisplay | null | undefined {
  const log = parseCallLog(message);
  if (!log) return undefined;
  return describeCallLog(log, currentUserId);
}

/**
 * Message filter for list rendering: drops call-log markers that are
 * hidden for this viewer so they don't affect grouping or day
 * separators. Every other message passes through untouched.
 */
export function isMessageVisibleTo(
  message: Pick<Message, 'type' | 'body'> & { deleted_at?: string | null },
  currentUserId: string | null,
): boolean {
  return callLogDisplayFor(message, currentUserId) !== null;
}

/**
 * Conversation-list preview text for a raw body / `last_message_preview`
 * string. Returns null when the string isn't a call log (show it as-is).
 * A missed-call marker addressed to someone else reads as a neutral
 * "Voice call" / "Video call" / "Call" instead of being hidden, since
 * the list row still needs some text.
 */
export function formatCallLogPreview(
  preview: string | null | undefined,
  currentUserId: string | null,
): string | null {
  const log = parseCallLogBody(preview);
  if (!log) return null;
  const display = describeCallLog(log, currentUserId);
  if (display) return display.summary;
  if (log.kind === 'call_missed' && log.media) {
    return log.media === 'video' ? 'Video call' : 'Voice call';
  }
  return 'Call';
}
