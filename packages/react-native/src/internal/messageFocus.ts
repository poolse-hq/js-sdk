// Pure helpers for ConversationView / MessageList — no React Native
// imports, so vitest can run them under node.

/**
 * The newest message the read cursor may move to: the tail, unless
 * it's an optimistic send the server hasn't assigned a sequence yet
 * (marking that would 404). Null when there's nothing to mark.
 */
export function latestMarkableId(
  messages: ReadonlyArray<{ id: string; sequence: number }>,
): string | null {
  const latest = messages[messages.length - 1];
  if (!latest?.id) return null;
  if (typeof latest.sequence !== 'number' || latest.sequence <= 0) return null;
  if (latest.sequence === Number.MAX_SAFE_INTEGER) return null;
  return latest.id;
}

/** Index of a message row in a list of message / separator items, or -1. */
export function indexOfMessage(
  items: ReadonlyArray<{ kind: string; msg?: { id: string } }>,
  messageId: string,
): number {
  return items.findIndex((it) => it.kind === 'msg' && it.msg?.id === messageId);
}
