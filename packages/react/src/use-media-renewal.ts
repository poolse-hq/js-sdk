import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseMediaRenewalOptions {
  /** Most renewals in `windowMs`. Defaults to 3. */
  max?: number;
  /** Defaults to one minute. */
  windowMs?: number;
}

export interface UseMediaRenewal {
  /**
   * Call from the media element's `onError`. Renews the link (calls
   * `refresh`) and returns true, or returns false once the cap is reached;
   * `exhausted` is then true.
   */
  renew: () => boolean;
  /** The cap was reached: the media will not play, show an error. */
  exhausted: boolean;
}

/**
 * Renew an expiring media link when the player errors, at most `max` times
 * in `windowMs`. Without a cap, a file that can never play (missing object,
 * codec, CORS) fetches a new link on every error, forever. A new `key`
 * (the recording or clip id) starts over.
 */
export function useMediaRenewal(
  refresh: () => void,
  key: unknown,
  { max = 3, windowMs = 60_000 }: UseMediaRenewalOptions = {},
): UseMediaRenewal {
  const times = useRef<number[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    times.current = [];
    setExhausted(false);
  }, [key]);

  const renew = useCallback(() => {
    const now = Date.now();
    times.current = times.current.filter((t) => now - t < windowMs);
    if (times.current.length >= max) {
      setExhausted(true);
      return false;
    }
    times.current.push(now);
    refreshRef.current();
    return true;
  }, [max, windowMs]);

  return { renew, exhausted };
}
