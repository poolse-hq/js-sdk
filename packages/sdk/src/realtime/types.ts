// Wire-shape mirror of the Phoenix-channel payloads poolse pushes.
// See poolse/apps/caas_realtime/lib/caas_realtime_web/channels/*.

import type { Conversation, Message, Uuid } from '../types.js';

/** `message:new` / `message:updated` push payloads. */
export type MessageNewEvent = Message;
export type MessageUpdatedEvent = Message;

/** `message:deleted` push payload (just the tombstone, no body). */
export interface MessageDeletedEvent {
  id: Uuid;
  conversation_id: Uuid;
  deleted_at: string | null;
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
