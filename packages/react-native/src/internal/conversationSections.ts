// ConversationList sections — pure, so vitest can run it under node.

import type { Conversation } from '@poolse/sdk';

/** One section of `<ConversationList sections>`. */
export interface ConversationSection {
  title: string;
  /** Conversations this section holds. Each conversation goes to the first section that takes it. */
  filter: (conversation: Conversation) => boolean;
}

/** `<ConversationList groupBy>`: `'type'` → "Channels" (groups), then "Direct messages". */
export type ConversationGroupBy = 'type';

export interface BuiltSection {
  title: string;
  data: Conversation[];
}

export const TYPE_SECTIONS: ConversationSection[] = [
  { title: 'Channels', filter: (c) => c.type !== 'direct' },
  { title: 'Direct messages', filter: (c) => c.type === 'direct' },
];

/**
 * Split conversations into sections, keeping their order. A
 * conversation lands in the first section whose `filter` takes it;
 * ones no section takes are dropped. Empty sections are left out.
 * Null when there is nothing to section (no `sections`, no `groupBy`).
 */
export function buildConversationSections(
  conversations: readonly Conversation[],
  sections: readonly ConversationSection[] | undefined,
  groupBy?: ConversationGroupBy,
): BuiltSection[] | null {
  const defs = sections ?? (groupBy === 'type' ? TYPE_SECTIONS : null);
  if (!defs || defs.length === 0) return null;
  const buckets = defs.map((d) => ({ title: d.title, data: [] as Conversation[] }));
  for (const conv of conversations) {
    const i = defs.findIndex((d) => d.filter(conv));
    if (i !== -1) buckets[i]!.data.push(conv);
  }
  return buckets.filter((b) => b.data.length > 0);
}
