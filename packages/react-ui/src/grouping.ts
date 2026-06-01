// Bubble grouping + day-separator helpers — extracted from
// ConversationView so they're testable in isolation and reusable
// if a customer rolls their own message-list layout.

import type { Message } from '@poolse/sdk';

/**
 * Where this message sits inside a same-sender, same-day, in-window
 * cluster. Drives the bubble's corner treatment + the row's
 * inter-cluster margin.
 *
 *   * `standalone`  — single bubble, gets the tail
 *   * `first`       — first of multi; all corners rounded
 *   * `middle`      — interior; all corners rounded
 *   * `last`        — last of multi; gets the tail
 */
export type GroupPosition = 'first' | 'middle' | 'last' | 'standalone';

export function computeGroupPosition(
  msg: Message,
  prev: Message | null,
  next: Message | null,
  windowMs: number,
): GroupPosition {
  const continuesPrev = sameGroup(msg, prev, windowMs);
  const continuesNext = sameGroup(next, msg, windowMs);
  if (continuesPrev && continuesNext) return 'middle';
  if (continuesPrev) return 'last';
  if (continuesNext) return 'first';
  return 'standalone';
}

export function sameGroup(a: Message | null, b: Message | null, windowMs: number): boolean {
  if (!a || !b) return false;
  if (a.sender_id !== b.sender_id) return false;
  if (!sameDay(a.inserted_at, b.inserted_at)) return false;
  const ta = new Date(a.inserted_at).getTime();
  const tb = new Date(b.inserted_at).getTime();
  return Math.abs(ta - tb) <= windowMs;
}

export function sameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/**
 * "Today" / "Yesterday" / "Mon, 26 May" / "26 May 2024" — same
 * convention as iMessage / WhatsApp / Telegram. `now` is exposed
 * for deterministic testing; defaults to the current wall clock.
 */
export function formatDayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.floor((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) {
    return d.toLocaleDateString(undefined, { weekday: 'long' });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
