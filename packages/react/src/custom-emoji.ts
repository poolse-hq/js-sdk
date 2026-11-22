// The workspace's own emoji (MS10). A custom emoji is sent and stored as
// the token `:name:` (in reactions and message text); the Workspace lists
// them (`GET /emoji` → `{name, url}`), and the pickers and reaction pills
// render the image for a token they know.

import { createContext, createElement, useContext, type ReactNode } from 'react';

export interface CustomEmoji {
  /** `^[a-z0-9_+-]{1,32}$`. */
  name: string;
  /** Absolute image URL (prefix the Workspace's address to its `url` path). */
  url: string;
}

const NAME = /^[a-z0-9_+-]{1,32}$/;

/** `:name:` for a custom emoji. */
export function customEmojiToken(name: string): string {
  return `:${name}:`;
}

/** The name in a `:name:` token, or `null` for anything else (a Unicode emoji). */
export function parseCustomEmojiToken(token: string): string | null {
  const m = /^:([a-z0-9_+-]{1,32}):$/.exec(token);
  return m ? m[1]! : null;
}

/** The custom emoji a token names, when it's in `set`. */
export function findCustomEmoji(
  token: string,
  set: readonly CustomEmoji[] | undefined,
): CustomEmoji | null {
  const name = parseCustomEmojiToken(token);
  if (!name || !set) return null;
  return set.find((e) => e.name === name) ?? null;
}

/** Custom emoji whose name contains every query word (`:` and spaces ignored), prefix matches first. */
export function searchCustomEmoji(set: readonly CustomEmoji[], query: string): CustomEmoji[] {
  const words = query.toLowerCase().replace(/:/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...set];
  const hits = set.filter((e) => NAME.test(e.name) && words.every((w) => e.name.includes(w)));
  return hits.sort(
    (a, b) =>
      Number(!a.name.startsWith(words[0]!)) - Number(!b.name.startsWith(words[0]!)) ||
      a.name.localeCompare(b.name),
  );
}

const CustomEmojiContext = createContext<readonly CustomEmoji[]>([]);

/** Give every picker and reaction strip below it the workspace's emoji. */
export function CustomEmojiProvider({
  emoji,
  children,
}: {
  emoji: readonly CustomEmoji[];
  children?: ReactNode;
}) {
  return createElement(CustomEmojiContext.Provider, { value: emoji }, children);
}

/** The custom emoji in scope (`[]` without a provider). */
export function useCustomEmoji(): readonly CustomEmoji[] {
  return useContext(CustomEmojiContext);
}
