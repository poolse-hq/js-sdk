// Relative times for presence ("Last seen 5m ago"), thread summaries
// ("last reply 2h ago") and conversation rows ("5m"). No React Native
// imports, so vitest can run it under node.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago `iso` was, relative to `now`:
 *
 * - `'long'` (default): "just now", "5m ago", "3h ago", "yesterday",
 *   a weekday ("Mon") within a week, else "Mar 4" (with the year when
 *   it isn't this year's).
 * - `'short'`: "now", "5m", "3h", "2d", "3w", then "Mar 4" — for tight
 *   rows.
 *
 * Empty for a missing or unparseable time; a time in the future counts
 * as now.
 */
export function relativeTime(
  iso: string | null | undefined,
  now: Date | number = Date.now(),
  style: 'long' | 'short' = 'long',
): string {
  if (!iso) return '';
  const then = new Date(iso);
  const t = then.getTime();
  if (Number.isNaN(t)) return '';
  const nowDate = typeof now === 'number' ? new Date(now) : now;
  const diff = Math.max(0, nowDate.getTime() - t);

  if (style === 'short') {
    if (diff < MINUTE) return 'now';
    if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
    if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
    if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
    if (diff < 28 * DAY) return `${Math.floor(diff / (7 * DAY))}w`;
    return monthDay(then, nowDate);
  }

  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (sameCalendarDay(then, nowDate)) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < HOUR * 12) return `${Math.floor(diff / HOUR)}h ago`;
  const yesterday = new Date(nowDate);
  yesterday.setDate(nowDate.getDate() - 1);
  if (sameCalendarDay(then, yesterday)) return 'yesterday';
  if (diff < 7 * DAY) return then.toLocaleDateString('en-US', { weekday: 'short' });
  return monthDay(then, nowDate);
}

function monthDay(d: Date, now: Date): string {
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
  });
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
