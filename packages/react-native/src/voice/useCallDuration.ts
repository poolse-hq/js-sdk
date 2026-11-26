import { formatClock } from '@poolse/sdk';
import { useEffect, useRef, useState } from 'react';

/**
 * How long the call has been connected, as `m:ss` (or `h:mm:ss`).
 *
 * Anchored to a timestamp rather than counting ticks: a phone that
 * sleeps or throttles timers would otherwise drift, and a call timer
 * that reads 4:12 after eleven minutes is worse than none. Returns null
 * until the call is actually up, so a ringing call shows its status
 * line instead of `0:00`.
 */
export function useCallDuration(connected: boolean): string | null {
  const startedAt = useRef<number | null>(null);
  const [, tick] = useState(0);

  if (connected && startedAt.current === null) startedAt.current = Date.now();
  if (!connected && startedAt.current !== null) startedAt.current = null;

  useEffect(() => {
    if (!connected) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [connected]);

  if (!connected || startedAt.current === null) return null;
  return formatClock(Date.now() - startedAt.current);
}
