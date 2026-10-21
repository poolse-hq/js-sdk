// Call-log messages — the server records finished calls as chat
// messages so they appear inline in the conversation timeline. They
// arrive as `type: 'system'` (or, in future, `type: 'custom'`) with a
// JSON body. Since server v2, ONE record per call:
//
//   {"kind":"call","v":2,"call_id":"…","media":"audio"|"video",
//    "caller_user_id":"uuid","started_at":ms,"ended_at":ms,
//    "end_reason":"finished"|"declined_all"|"no_answer"|"cancelled",
//    "duration_ms":12345|null,"joined_user_ids":["uuid",…],
//    "participants":[{"user_id":"uuid","status":"joined"|"declined"|"busy"|"missed"}]}
//
// Every viewer reads it differently — "Outgoing call · 4:12" for the
// caller, "Missed voice call" for someone who didn't pick up, "You
// declined" — which `describeCallLog` works out from `caller_user_id`
// and the viewer's own status.
//
// Older history holds the v1 shapes: the same `call` record without
// `v`/caller/participants, plus a per-callee marker only the named
// user sees:
//
//   {"kind":"call_missed","call_id":"…","user_id":"uuid"}
//
// The helpers here are pure + framework-agnostic so every UI package
// (web, React Native, or a customer's own) parses the payload the
// same way. Anything that isn't a well-formed call log returns null,
// so callers fall back to their normal system-message rendering.

import type { Message, Uuid } from './types.js';

export type CallLogMedia = 'audio' | 'video';

/** What became of one person a call involved (the caller excluded). */
export type CallParticipantStatus = 'joined' | 'declined' | 'busy' | 'missed';

/** Why a call ended, as the server recorded it. */
export type CallEndReason = 'finished' | 'declined_all' | 'no_answer' | 'cancelled';

/** A completed (answered or unanswered) call. */
export interface CallLogEntry {
  kind: 'call';
  callId: string;
  media: CallLogMedia;
  /** Talk time in ms; `null` when nobody answered. */
  durationMs: number | null;
  joinedUserIds: Uuid[];
  /** `2` for the one-record-per-call shape; `1` for older history. */
  version: 1 | 2;
  /** Who placed the call. `null` on v1 records. */
  callerUserId: Uuid | null;
  /** Everyone else the call involved, with their outcome. Empty on v1. */
  participants: Array<{ userId: Uuid; status: CallParticipantStatus }>;
  endReason: CallEndReason | null;
  /** Epoch ms; `null` on v1 records. */
  startedAt: number | null;
  endedAt: number | null;
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
    const participants = Array.isArray(obj.participants)
      ? obj.participants.flatMap((p) => {
          if (!p || typeof p !== 'object') return [];
          const { user_id: userId, status } = p as Record<string, unknown>;
          if (typeof userId !== 'string' || !isParticipantStatus(status)) return [];
          return [{ userId, status }];
        })
      : [];
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
      kind: 'call',
      callId,
      media: media ?? 'audio',
      durationMs,
      joinedUserIds: joined,
      version: obj.v === 2 ? 2 : 1,
      callerUserId: typeof obj.caller_user_id === 'string' ? obj.caller_user_id : null,
      participants,
      endReason: isEndReason(obj.end_reason) ? obj.end_reason : null,
      startedAt: num(obj.started_at),
      endedAt: num(obj.ended_at),
    };
  }
  if (obj.kind === 'call_missed') {
    if (typeof obj.user_id !== 'string' || obj.user_id === '') return null;
    return { kind: 'call_missed', callId, userId: obj.user_id, media };
  }
  return null;
}

function isParticipantStatus(v: unknown): v is CallParticipantStatus {
  return v === 'joined' || v === 'declined' || v === 'busy' || v === 'missed';
}

function isEndReason(v: unknown): v is CallEndReason {
  return v === 'finished' || v === 'declined_all' || v === 'no_answer' || v === 'cancelled';
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
  /** "Outgoing voice call", "Missed video call", "Group voice call"… */
  title: string;
  /** "3:12" when answered; "No answer", "Declined", "You declined"…; null when the title says it all. */
  detail: string | null;
  /** The viewer missed this call — render in the error tone. */
  missed: boolean;
  /** Short one-line form for list previews ("Video call · 3:12"). */
  summary: string;
  /** `outgoing` when the viewer placed the call, `incoming` when someone called them, else null. */
  direction: 'outgoing' | 'incoming' | null;
  /**
   * Worth offering "Call back": the viewer missed or declined it, or
   * placed it and nobody picked up.
   */
  callBack: boolean;
}

/**
 * Turn a call log into display copy for `currentUserId`. Returns null
 * when the entry should be hidden for this viewer (a v1 `call_missed`
 * marker addressed to someone else).
 */
export function describeCallLog(log: CallLog, currentUserId: string | null): CallLogDisplay | null {
  if (log.kind === 'call_missed') {
    if (currentUserId === null || log.userId !== currentUserId) return null;
    const media = log.media ?? 'audio';
    return display(media, 'Missed call', null, {
      missed: true,
      direction: 'incoming',
      callBack: true,
    });
  }

  const kind = log.media === 'video' ? 'video' : 'voice';
  const duration = log.durationMs !== null ? formatCallDuration(log.durationMs) : null;
  const group = log.participants.length > 1;
  const me = currentUserId;

  // v1 history, or a record this viewer is not in (joined the
  // conversation later): the neutral wording every viewer used to get.
  const mine = me !== null ? log.participants.find((p) => p.userId === me) : undefined;
  const isCaller = me !== null && log.callerUserId === me;
  if (log.version === 1 || (!isCaller && !mine)) {
    const title = group
      ? `Group ${kind} call`
      : log.media === 'video'
        ? 'Video call'
        : 'Voice call';
    return display(log.media, title, duration ?? 'No answer', { direction: null, callBack: false });
  }

  if (isCaller) {
    const title = `Outgoing ${kind} call`;
    if (duration)
      return display(log.media, title, duration, { direction: 'outgoing', callBack: false });
    const allBusy =
      log.participants.length > 0 && log.participants.every((p) => p.status === 'busy');
    const detail =
      log.endReason === 'cancelled'
        ? 'Cancelled'
        : log.endReason === 'declined_all'
          ? allBusy
            ? 'Busy'
            : 'Declined'
          : 'No answer';
    return display(log.media, title, detail, { direction: 'outgoing', callBack: true });
  }

  switch (mine!.status) {
    case 'joined':
      return display(log.media, group ? `Group ${kind} call` : `Incoming ${kind} call`, duration, {
        direction: 'incoming',
        callBack: false,
      });
    case 'declined':
      return display(log.media, `Incoming ${kind} call`, 'You declined', {
        direction: 'incoming',
        callBack: true,
      });
    case 'busy':
      return display(log.media, `Missed ${kind} call`, 'You were on another call', {
        missed: true,
        direction: 'incoming',
        callBack: true,
      });
    case 'missed':
      return display(log.media, group ? `Missed group ${kind} call` : `Missed ${kind} call`, null, {
        missed: true,
        direction: 'incoming',
        callBack: true,
      });
  }
}

function display(
  media: CallLogMedia,
  title: string,
  detail: string | null,
  extra: { missed?: boolean; direction: CallLogDisplay['direction']; callBack: boolean },
): CallLogDisplay {
  return {
    media,
    title,
    detail,
    missed: extra.missed ?? false,
    summary: detail ? `${title} · ${detail}` : title,
    direction: extra.direction,
    callBack: extra.callBack,
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
