// Emoji picker data and search — pure, so vitest can run it under node.

import { EMOJI_CATEGORIES } from './emojiData.js';

export interface EmojiEntry {
  emoji: string;
  /** Lower-case search words. */
  keywords: string[];
  category: string;
}

export interface EmojiCategory {
  id: string;
  title: string;
  emojis: EmojiEntry[];
}

let parsed: EmojiCategory[] | null = null;

/** The built-in set, parsed on first call. */
export function emojiCategories(): EmojiCategory[] {
  if (parsed) return parsed;
  parsed = EMOJI_CATEGORIES.map((cat) => ({
    id: cat.id,
    title: cat.title,
    emojis: cat.data.split('|').map((entry) => {
      const [emoji = '', ...words] = entry.trim().split(/\s+/);
      return { emoji, keywords: words.map((w) => w.toLowerCase()), category: cat.id };
    }),
  }));
  return parsed;
}

/**
 * Emoji matching `query`: every query word must prefix one of an
 * emoji's keywords. Prefix-of-first-keyword matches (the emoji's name)
 * come first. Pasting an emoji finds it. Empty query → [].
 */
export function searchEmoji(query: string, limit = 60): EmojiEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const strong: EmojiEntry[] = [];
  const weak: EmojiEntry[] = [];
  for (const cat of emojiCategories()) {
    for (const e of cat.emojis) {
      if (e.emoji === query.trim()) {
        strong.unshift(e);
        continue;
      }
      const all = words.every((w) => e.keywords.some((k) => k.startsWith(w)));
      if (!all) continue;
      if (e.keywords[0]?.startsWith(words[0]!)) strong.push(e);
      else weak.push(e);
    }
  }
  return [...strong, ...weak].slice(0, limit);
}

/**
 * Most-recent-first list after using `emoji`: moved to the front, no
 * duplicates, at most `max` long.
 */
export function pushRecent(recent: readonly string[], emoji: string, max = 24): string[] {
  return [emoji, ...recent.filter((e) => e !== emoji)].slice(0, max);
}

let recentEmojis: string[] = [];

/** Emoji picked in this app session, most recent first (in memory). */
export function getRecentEmojis(): string[] {
  return recentEmojis;
}

export function recordRecentEmoji(emoji: string): void {
  recentEmojis = pushRecent(recentEmojis, emoji);
}
