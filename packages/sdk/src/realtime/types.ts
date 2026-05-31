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
  user_id: Uuid;
}

/** `reaction:added` / `reaction:removed`. */
export interface ReactionEvent {
  message_id: Uuid;
  conversation_id: Uuid;
  emoji: string;
  user_id: Uuid;
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
