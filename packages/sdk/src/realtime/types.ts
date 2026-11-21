// Wire-shape mirror of the Phoenix-channel payloads poolse pushes.
// See poolse/apps/caas_realtime/lib/caas_realtime_web/channels/*.

import type { Conversation, Message, ThreadParticipant, Uuid } from '../types.js';

/** `message:new` / `message:updated` push payloads. */
export type MessageNewEvent = Message;
export type MessageUpdatedEvent = Message;

/** `message:deleted` push payload (just the tombstone, no body). */
export interface MessageDeletedEvent {
  id: Uuid;
  conversation_id: Uuid;
  /** The thread the deleted message replied in; null for a top-level one. Absent on older servers. */
  thread_root_id?: Uuid | null;
  deleted_at: string | null;
}

/**
 * `thread:updated` — a thread's summary after a reply was posted or
 * deleted, so a feed showing the root updates its count and avatars.
 */
export interface ThreadUpdatedEvent {
  /** The thread's root message. */
  message_id: Uuid;
  conversation_id: Uuid;
  reply_count: number;
  last_reply_at: string | null;
  thread_participants: ThreadParticipant[];
}

/**
 * `message:stream` — an AI agent's reply as it's being written.
 *
 *   * `started`: the agent began writing (carries `sender_external_id`).
 *   * `delta`: the next piece of text; append it.
 *   * `tool`: the agent is running one of its tools (`tool` is its name).
 *   * `failed`: the agent couldn't answer; nothing will be posted.
 *
 * The finished reply arrives as a normal `message:new` whose `id`
 * equals the stream's `id`, so swap the streaming bubble for it.
 */
export interface MessageStreamEvent {
  id: Uuid;
  conversation_id: Uuid;
  sender_id: Uuid;
  status: 'started' | 'delta' | 'tool' | 'failed';
  sender_external_id?: string | null;
  delta?: string;
  tool?: string;
  error?: string;
}

/** `typing:start` / `typing:stop`. */
export interface TypingEvent {
  /** Internal poolse user id. Most consumer code uses `external_id` instead. */
  user_id: Uuid;
  /** The tenant's own id — what your `userResolver` consumes. */
  external_id: string | null;
}

/** `reaction:added` / `reaction:removed`. */
export interface ReactionEvent {
  message_id: Uuid;
  conversation_id: Uuid;
  emoji: string;
  user_id: Uuid;
}

/**
 * `member:read` — a conversation member advanced their read cursor.
 * Server broadcasts on `conversation:<id>` so the sender's
 * read-receipt glyph (check vs check-double) updates in real time
 * without needing to refetch the member list.
 */
export interface MemberReadEvent {
  user_id: Uuid;
  conversation_id: Uuid;
  last_read_message_id: Uuid;
  last_read_at: string;
}

/** `call:started` — a call went live on the conversation. */
export interface CallStartedEvent {
  cv: number;
  call: import('../resources/live-calls.js').LiveCall;
}

/** `call:participants` — who is in the live call's room right now (user ids). */
export interface CallParticipantsEvent {
  cv: number;
  call_id: string;
  participants: Uuid[];
}

/** `call:finished` — the call is over for everyone. */
export interface CallFinishedEvent {
  cv: number;
  call_id: string;
  ended_at?: string;
  duration_ms?: number;
  joined_user_ids?: Uuid[];
  /** `finished` | `declined_all` | `busy_all` | `no_answer` | `cancelled`. */
  reason?: string;
  /** Present on the `user:<id>` copy (`UserChannel.onCallFinished`). */
  conversation_id?: Uuid;
}

/**
 * Your ring for a call is over (`call:ring_ended` on `user:<id>`): stop
 * ringing on this device.
 */
export interface RingEndedEvent {
  cv: number;
  call_id: string;
  conversation_id: Uuid;
  /** `answered_elsewhere` | `declined` | `cancelled` | `timeout` | `finished`. */
  reason: string;
  /** The device that resolved the ring (e.g. the one that answered), so it can ignore this. */
  device_id?: string;
}

/** Per-user mention push on the `user:<id>` channel. */
export interface MentionEvent {
  message_id: Uuid;
  conversation_id: Uuid;
  sender_id: Uuid | null;
}

/**
 * Pushed on `user:<id>` when the user is added to a conversation —
 * either as creator (via `POST /v1/conversations`) or as additional
 * member (via `POST /v1/conversations/:id/members`). Payload is the
 * full conversation row.
 */
export type ConversationCreatedEvent = Conversation;

/**
 * Pushed on `user:<id>` whenever a conversation's surface state
 * changes — currently fires after every `send_message`. Lets the
 * conversation-list view update `last_message_preview` /
 * `last_message_at` / `last_sequence` and bump the unread badge
 * without a refetch.
 *
 * `by_user_id` is the message sender's internal id, so clients can
 * leave their own unread at 0 (the server already advanced their
 * read cursor in the same transaction).
 */
export interface ConversationUpdatedEvent {
  conversation: Conversation;
  by_user_id: Uuid | null;
}

/**
 * `conversation:read` on `user:<id>` — the user's read position in a
 * conversation moved (they marked it read on some device, or a call
 * record / system message advanced it). Sent to all of their devices
 * so every unread badge agrees.
 */
export interface ConversationReadEvent {
  conversation_id: Uuid;
  last_read_message_id: Uuid | null;
  last_read_sequence: number | null;
  unread_count: number;
  mention_unread_count: number;
}

/**
 * `app:event` on `user:<id>` — an event your own backend (or the
 * Workspace API) sent to the user, e.g. `member:updated` after a
 * profile change or `workspace:updated`. poolse doesn't interpret
 * `data`, except that the SDK refreshes cached profiles on
 * `member:updated` (see `Poolse.onAppEvent`).
 */
export interface AppEvent {
  type: string;
  data: Record<string, unknown>;
}

/** Phoenix Presence list shape. */
export type PresenceSnapshot = Record<
  Uuid,
  {
    metas: Array<{
      phx_ref: string;
      online_at: number;
      external_id?: string;
    }>;
  }
>;

/**
 * Connection status. Reflects the underlying socket lifecycle plus
 * channel join state — easier for UIs than tracking both separately.
 */
export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

/** Unsubscribe handle returned by `onX` listener registrations. */
export type Unsubscribe = () => void;
