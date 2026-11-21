// Pure helpers for keeping a local copy of messages in step with the
// server's events — shared by @poolse/react, @poolse/react-ui and
// @poolse/react-native so every list applies an edit, a link preview,
// a delete or a thread summary the same way.

import type { ThreadUpdatedEvent } from './realtime/types.js';
import type { IsoDateTime, Message, Uuid } from './types.js';

/** A deleted message: kept in place as a "message deleted" row. */
export function isTombstone(msg: Pick<Message, 'deleted_at'>): boolean {
  return msg.deleted_at != null;
}

/**
 * `msg` as the server's tombstone of it: no body, quote, mentions,
 * reactions, attachments or link previews; id, sequence, sender and
 * thread fields stay.
 */
export function toTombstone(msg: Message, deletedAt: IsoDateTime | null): Message {
  return {
    ...msg,
    deleted_at: deletedAt ?? msg.deleted_at ?? new Date().toISOString(),
    body: null,
    quoted_message_id: null,
    quoted_message: null,
    mentions: [],
    reactions: {},
    attachments: [],
    link_previews: [],
  };
}

/**
 * Fold a fresh copy of a message (`message:updated`, a REST response)
 * into the one already held. Fields the fresh copy leaves out are kept,
 * so a payload from an older server doesn't wipe link previews or the
 * thread summary; a pre-summary server's `reply_count: 0` doesn't
 * reset a known count either.
 */
export function mergeMessage(prev: Message, next: Message): Message {
  const merged: Message = { ...prev, ...next };
  const legacyZero =
    next.reply_count === 0 &&
    next.last_reply_at === undefined &&
    next.thread_participants === undefined;
  if (legacyZero && prev.reply_count !== undefined) merged.reply_count = prev.reply_count;
  return merged;
}

/** Apply a `thread:updated` summary to its root message. */
export function applyThreadUpdate(msg: Message, evt: ThreadUpdatedEvent): Message {
  return {
    ...msg,
    reply_count: evt.reply_count,
    last_reply_at: evt.last_reply_at,
    thread_participants: evt.thread_participants,
  };
}

/**
 * A message that quotes `deletedId` shows the quote as deleted
 * (`quoted_message.deleted_at` set, `body: null`). Returns `msg`
 * itself when it doesn't quote it.
 */
export function markQuoteDeleted(
  msg: Message,
  deletedId: Uuid,
  deletedAt: IsoDateTime | null,
): Message {
  const quote = msg.quoted_message;
  if (!quote || quote.id !== deletedId) return msg;
  return {
    ...msg,
    quoted_message: { ...quote, body: null, deleted_at: deletedAt ?? new Date().toISOString() },
  };
}
