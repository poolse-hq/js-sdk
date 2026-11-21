// @-mention parsing for <MentionInput> — pure, so vitest can run it
// under node.

/** An `@query` being typed: where the `@` is and what follows it. */
export interface MentionQuery {
  /** Index of the `@`. */
  start: number;
  /** Text between the `@` and the cursor (may be empty). */
  query: string;
}

/**
 * The mention being typed at `cursor`, if any: an `@` at the start of
 * the text or after whitespace / an opening bracket, followed by up to
 * 32 characters without whitespace, reaching the cursor.
 */
export function activeMentionQuery(text: string, cursor: number): MentionQuery | null {
  const upto = text.slice(0, Math.max(0, Math.min(cursor, text.length)));
  const match = /(^|[\s([{])@([^\s@]{0,32})$/.exec(upto);
  if (!match) return null;
  const query = match[2] ?? '';
  return { start: upto.length - query.length - 1, query };
}

/**
 * Replace the `@query` at `start…cursor` with `@label ` and put the
 * cursor after it.
 */
export function insertMention(
  text: string,
  start: number,
  cursor: number,
  label: string,
): { text: string; cursor: number } {
  const token = `@${label} `;
  const before = text.slice(0, start);
  const after = text.slice(Math.max(cursor, start)).replace(/^ /, '');
  return { text: `${before}${token}${after}`, cursor: before.length + token.length };
}

/**
 * The user ids still mentioned in `text`: those picked whose `@label`
 * is still there (deleting the text drops the mention). Deduped, in
 * pick order.
 */
export function mentionedUserIds(
  text: string,
  picked: ReadonlyArray<{ userId: string; label: string }>,
): string[] {
  const out: string[] = [];
  for (const p of picked) {
    if (out.includes(p.userId)) continue;
    if (text.includes(`@${p.label}`)) out.push(p.userId);
  }
  return out;
}

/**
 * Members whose name or id matches `query` (case-insensitive): name
 * prefix first, then a word prefix, then anywhere. At most `limit`.
 */
export function filterMentionCandidates<T extends { label: string; externalId: string }>(
  candidates: readonly T[],
  query: string,
  limit = 8,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return candidates.slice(0, limit);
  const rank = (c: T): number => {
    const label = c.label.toLowerCase();
    const id = c.externalId.toLowerCase();
    if (label.startsWith(q) || id.startsWith(q)) return 0;
    if (label.split(/\s+/).some((w) => w.startsWith(q))) return 1;
    if (label.includes(q) || id.includes(q)) return 2;
    return -1;
  };
  return candidates
    .map((c, i) => ({ c, r: rank(c), i }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.c);
}
