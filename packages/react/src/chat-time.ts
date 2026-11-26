// Times as the chat components show them — a message's time of day,
// "5m ago" / "yesterday", and a clock that re-renders them — shared by
// web and React Native so both read the same. No date library; the
// viewer's locale throughout.

import { useEffect, useState } from 'react';

/** `'12h'`, `'24h'`, or your own formatter. Omitted: the locale's default. */
export type TimeFormat = '12h' | '24h' | ((date: Date) => string);

/** Time of day in the chosen format ("9:05 AM", "21:05"); a formatter function is used as-is. */
export function formatTimeOfDay(date: Date, format?: TimeFormat): string {
  if (typeof format === 'function') return format(date);
  if (format === '12h') {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  if (format === '24h') {
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  }
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** A message's time of day; empty for a missing or bad time. */
export function formatMessageTime(iso: string | null | undefined, format?: TimeFormat): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return formatTimeOfDay(date, format);
}

/** The narrow gutter's form of a time: no space before AM/PM, so it fits. */
export function gutterTime(time: string): string {
  return time.replace(/\s+(?=[AaPp]\.?[Mm]\.?$)/, '').replace(/\u202f/g, '');
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago `iso` was, relative to `now`:
 *
 * - `'long'` (default): "just now", "5m ago", "3h ago", "yesterday"
 *   (the calendar day before), a weekday ("Mon") within a week, else
 *   "Mar 4" (with the year when it isn't this year's).
 * - `'short'`: "now", "5m", "3h", "2d", "3w", then "Mar 4" — for tight
 *   rows.
 *
 * Empty for a missing or unparseable time; a time in the future counts
 * as now. Weekday and date names are in the viewer's locale.
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
  if (sameCalendarDay(then, nowDate) || diff < HOUR * 12) {
    return `${Math.floor(diff / HOUR)}h ago`;
  }
  const yesterday = new Date(nowDate);
  yesterday.setDate(nowDate.getDate() - 1);
  if (sameCalendarDay(then, yesterday)) return 'yesterday';
  if (diff < 7 * DAY) return then.toLocaleDateString(undefined, { weekday: 'short' });
  return monthDay(then, nowDate);
}

function monthDay(d: Date, now: Date): string {
  return d.toLocaleDateString(undefined, {
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

/** `Date.now()`, refreshed every `intervalMs` (default a minute) — re-renders relative times. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
