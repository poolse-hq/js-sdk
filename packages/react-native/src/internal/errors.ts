// Send errors → the notice ConversationView shows. Pure, so vitest can
// run it under node.

/** What to tell the user when a send fails. */
export function sendErrorNotice(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'quoted_message_deleted') return 'The message you replied to was deleted.';
  if (code === 'quoted_message_not_found' || code === 'quoted_message_wrong_conversation') {
    return "The message you replied to isn't available.";
  }
  if (code === 'reply_parent_not_found' || code === 'message_deleted') {
    return 'That message was deleted.';
  }
  const status = (err as { status?: unknown } | null)?.status;
  if (status === 413) return 'That message is too long to send.';
  if (status === 429) return "You're sending too fast. Try again in a moment.";
  return "Couldn't send the message. Try again.";
}

/** The send failed because its quote target is gone: drop the quote. */
export function isQuoteGone(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return (
    code === 'quoted_message_deleted' ||
    code === 'quoted_message_not_found' ||
    code === 'quoted_message_wrong_conversation'
  );
}

/**
 * For a reaction pick's promise: `useReactions` has already rolled the
 * optimistic change back (the pill goes away again), so the failure
 * needs no other handling — only not to become an unhandled rejection.
 */
export function ignoreRolledBack(): void {}
