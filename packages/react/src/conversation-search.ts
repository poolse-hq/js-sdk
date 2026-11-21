import type { Conversation } from '@poolse/sdk';

export interface ConversationSearchOptions {
  /** Your own external id — left out of a direct chat's names. */
  meExternalId?: string | null;
  /** Names for members' external ids (what the list shows). */
  labelFor?: (externalId: string) => string;
}

/**
 * Conversations matching `query` (case-insensitive) by name, the other
 * members' names in `labelFor` / external ids, and the last message.
 * An empty query returns the list as is. What `<ConversationList query>`
 * uses on web and React Native.
 */
export function filterConversations<T extends Conversation>(
  conversations: ReadonlyArray<T>,
  query: string,
  opts: ConversationSearchOptions = {},
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return conversations.slice();
  return conversations.filter((c) => {
    const hay: string[] = [c.name ?? '', c.last_message_preview ?? ''];
    for (const ext of c.member_external_ids ?? []) {
      if (ext === opts.meExternalId) continue;
      hay.push(ext);
      if (opts.labelFor) hay.push(opts.labelFor(ext));
    }
    return hay.some((h) => h.toLowerCase().includes(needle));
  });
}
