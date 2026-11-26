// Pure helpers the web (@poolse/react-ui) and React Native
// (@poolse/react-native) chat components share, so both platforms
// decide the same things the same way: which attachments are images,
// how a size reads, a sender's tint, how a bubble's body is drawn, the
// quick reactions offered. No DOM or React Native imports.

import { clipOf, type Attachment, type Message } from '@poolse/sdk';

/** The reactions offered one tap away (the long-press sheet, the toolbar picker). */
export const QUICK_REACTIONS: readonly string[] = ['👍', '❤️', '😂', '🎉', '😢', '🙏'];

/** Whether a MIME type is an image (any case: `Image/PNG` counts). */
export function isImageContentType(ct: string | null | undefined): boolean {
  return typeof ct === 'string' && ct.toLowerCase().startsWith('image/');
}

/**
 * A message's attachments as the bubble draws them: images (the
 * mosaic), clips cut from a recording (inline players) and everything
 * else (file cards).
 */
export function partitionAttachments(attachments: readonly Attachment[] | null | undefined): {
  images: Attachment[];
  clips: Attachment[];
  files: Attachment[];
} {
  const images: Attachment[] = [];
  const clips: Attachment[] = [];
  const files: Attachment[] = [];
  for (const a of attachments ?? []) {
    const clip = !!clipOf(a);
    if (isImageContentType(a.content_type)) images.push(a);
    if (clip) clips.push(a);
    if (!clip && !isImageContentType(a.content_type)) files.push(a);
  }
  return { images, clips, files };
}

/**
 * A size for people: "820 B", "1.5 KB", "47 KB", "3.2 MB" — one
 * decimal under 10, whole numbers from 10 up. Empty for a bad number.
 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

/**
 * The sender tints: eight hues legible on light and dark bubbles
 * (Tailwind 500 shades). Pulse Coral is left out — it's the viewer's own.
 */
export const USER_COLORS: readonly string[] = [
  '#6366f1', // indigo
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ec4899', // rose
  '#0ea5e9', // sky
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#d946ef', // fuchsia
];

/**
 * A stable tint for a user (any opaque id): the same input always gives
 * the same colour, so a person keeps their tint across sessions.
 */
export function userColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    // djb2-ish, kept as |0 so the running value stays int32.
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return USER_COLORS[Math.abs(h) % USER_COLORS.length]!;
}

/** Someone else's message that @-mentions the viewer. */
export function mentionsViewer(msg: Message, meId: string | null): boolean {
  return meId !== null && msg.sender_id !== meId && (msg.mentions ?? []).includes(meId);
}

/**
 * Whether the body contains anything Markdown would render
 * differently from plain text. When it doesn't, the bubble skips the
 * Markdown pipeline and uses the plain-text fast path, the only one
 * that can float the timestamp into the last line.
 *
 * Deliberately eager: a false positive only costs the inline
 * timestamp, a false negative would print literal `**` in a bubble.
 */
export function hasMarkdown(body: string): boolean {
  return /[*_~`#>|\\]|\[.*\]|^\s*(?:[-+]|\d+[.)])\s|https?:\/\/|www\./ms.test(body);
}

/**
 * 1–3 emoji and nothing else → the bubble drops its chrome and the
 * emoji render large. Returns the emoji count, or 0 when the body is
 * not emoji-only.
 *
 * Each emoji is one pictographic base (or a flag pair), an optional
 * skin tone, an optional VS16, then any ZWJ-joined continuations — so
 * 👩‍👩‍👧‍👧 counts as one. An engine without Unicode property escapes
 * gets 0 (a normal bubble).
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
