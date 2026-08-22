import { useEffect, useRef, useState } from 'react';

export interface AloneWatchOptions {
  /** Whether the call is actually carrying media right now. */
  active: boolean;
  /** How many OTHER people are on the call — excluding yourself. */
  others: number;
  /** Grace period before the verdict. `0` disables the watch. */
  graceMs: number;
}

/**
 * Report when this client is the last one left on a call.
 *
 * The mesh's counterpart to `CallRoom`'s built-in check. It lives here
 * rather than in `VoiceRoom` because the mesh's roster arrives as
 * presence on poolse's own channel, which the hook already holds — and
 * duplicating the subscription inside the SDK to watch a number the
 * hook can see would buy nothing.
 *
 * Two guards, both load-bearing:
 *
 *   * Nobody has to have been here — `seenPeer` — before an empty room
 *     counts as abandonment. Otherwise the caller who connects first,
 *     alone by definition until the callee joins, ends their own call.
 *   * The verdict waits out `graceMs`, so two people hanging up in the
 *     same tick, or a reconnect that briefly empties presence, does not
 *     read as everyone walking out.
 *
 * Latches once true: a consumer hanging up in an effect needs the
 * signal to survive being read, and an abandoned call is never
 * un-abandoned. Resets when the call goes inactive.
 */
export function useAloneWatch({ active, others, graceMs }: AloneWatchOptions): boolean {
  const [alone, setAlone] = useState(false);
  const seenPeer = useRef(false);

  useEffect(() => {
    if (!active) {
      seenPeer.current = false;
      setAlone(false);
      return;
    }

    if (others > 0) {
      seenPeer.current = true;
      return;
    }

    if (graceMs <= 0 || !seenPeer.current) return;

    const timer = setTimeout(() => setAlone(true), graceMs);
    // Cleared by the next run whenever `others` changes, so somebody
    // rejoining inside the grace period cancels the verdict.
    return () => clearTimeout(timer);
  }, [active, others, graceMs]);

  return alone;
}
