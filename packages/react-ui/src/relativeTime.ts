// Relative times for "last reply 5m ago" and "Last seen 2h ago", plus a
// clock hook that re-renders them. Shared with React Native through
// @poolse/react (`relativeTime`, `useNow`).

import { relativeTime } from '@poolse/react';

export { useNow } from '@poolse/react';

/**
 * `just now`, `5m ago`, `3h ago`, `yesterday` (the calendar day before),
 * a weekday within a week, then the date (`Mar 4`, or `Mar 4, 2025` in
 * another year), in the viewer's locale. Empty for a bad date.
 */
export function formatRelativeTime(iso: string | null | undefined, now = Date.now()): string {
  return relativeTime(iso, now);
}
