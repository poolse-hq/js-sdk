/**
 * Text-shape helpers shared by the bubble renderer.
 *
 * The bubble picks between three body treatments — inline-meta plain
 * text, full markdown, jumbo emoji — and these predicates are the
 * entire decision. Kept dependency-free so the native package can
 * mirror them line for line (see react-ui/src/bubbleText.ts).
 */

/**
 * Whether the body contains anything Markdown would render
 * differently from plain text. When it doesn't, the bubble skips the
 * Markdown pipeline entirely and uses the plain-text fast path, which
 * is the only path that can float the timestamp into the last line —
 * block elements (paragraphs, lists, fences) own their line boxes and
 * push the meta below instead.
 *
 * Deliberately eager: a false positive only costs the inline
 * timestamp, a false negative would print literal `**` in a bubble.
 */
export function hasMarkdown(body: string): boolean {
  return /[*_~`#>|\\]|\[.*\]|^\s*(?:[-+]|\d+[.)])\s|https?:\/\/|www\./ms.test(body);
}

/**
 * 1–3 emoji and nothing else → the bubble drops its chrome and the
 * emoji render large (the iMessage convention — a lone 👍 deserves
 * better than a padded rectangle). Returns the emoji count, or 0 when
 * the body is not emoji-only.
 *
 * The regex builds each emoji as: one pictographic base (or keycap /
 * flag pair), optional skin tone, optional VS16, then any number of
 * ZWJ-joined continuations — so 👩‍👩‍👧‍👧 counts as one. Guarded by try
 * in case the engine lacks Unicode property escapes; the fallback is
 * simply "not emoji-only", which renders a normal bubble.
 */
export function emojiOnlyCount(body: string): number {
  const text = body.trim();
  if (!text || text.length > 32) return 0;
  try {
    const unit =
      '(?:\\p{Regional_Indicator}{2}|\\p{Extended_Pictographic})' +
      '[\\u{1F3FB}-\\u{1F3FF}]?\\uFE0F?' +
      '(?:\\u200D\\p{Extended_Pictographic}[\\u{1F3FB}-\\u{1F3FF}]?\\uFE0F?)*';
    const whole = new RegExp(`^(?:${unit}){1,3}$`, 'u');
    if (!whole.test(text)) return 0;
    const each = new RegExp(unit, 'gu');
    return (text.match(each) ?? []).length;
  } catch {
    return 0;
  }
}

/** Jumbo emoji font size by how many there are — fewer reads bigger. */
export function emojiFontSize(count: number): number {
  return count === 1 ? 44 : count === 2 ? 38 : 32;
}
