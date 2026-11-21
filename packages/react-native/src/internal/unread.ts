// The "New messages" divider — pure, so vitest can run it under node.

/**
 * The sequence of the first message the viewer hadn't read when the
 * conversation opened: `last_sequence - unread_count + 1`. Null when
 * nothing was unread or the counts aren't known.
 */
export function firstUnreadSequence(
  conversation: { last_sequence?: number | null; unread_count?: number | null } | null | undefined,
): number | null {
  if (!conversation) return null;
  const { last_sequence: last, unread_count: unread } = conversation;
  if (typeof last !== 'number' || typeof unread !== 'number' || unread <= 0) return null;
  return Math.max(1, last - unread + 1);
}

/**
 * The message the divider goes above: the first loaded message at or
 * after `fromSequence` that someone else sent (your own messages from
 * another device aren't news). Optimistic sends (no server sequence
 * yet) are skipped. Null when there isn't one loaded.
 */
export function newMessagesDividerId(
  messages: ReadonlyArray<{ id: string; sequence: number; sender_id: string | null }>,
  fromSequence: number | null,
  meId: string | null,
): string | null {
  if (fromSequence === null) return null;
  for (const m of messages) {
    if (typeof m.sequence !== 'number' || m.sequence === Number.MAX_SAFE_INTEGER) continue;
    if (m.sequence < fromSequence) continue;
    if (meId !== null && m.sender_id === meId) continue;
    return m.id;
  }
  return null;
}

/**
 * Whether older pages still need loading before the first unread
 * message can be shown: the oldest loaded message is newer than it.
 */
export function needsOlderForUnread(
  messages: ReadonlyArray<{ sequence: number }>,
  fromSequence: number | null,
): boolean {
  if (fromSequence === null) return false;
  const oldest = messages.find(
    (m) => typeof m.sequence === 'number' && m.sequence !== Number.MAX_SAFE_INTEGER,
  );
  if (!oldest) return false;
  return oldest.sequence > fromSequence;
}
