import type { Me } from '@poolse/sdk';
import { useEffect, useState } from 'react';
import { usePoolse } from './provider.js';

interface UseMeState {
  me: Me | null;
  loading: boolean;
  error: Error | null;
}

/**
 * The currently-signed-in End User (`/v1/me`). Fetches once on mount
 * and never re-fetches automatically — user identity is stable for
 * the JWT's lifetime.
 *
 * Most apps won't need this; the JWT subject is enough. Useful when
 * the UI needs the display name / external_id without re-asking the
 * Customer's backend.
 */
export function useMe(): UseMeState {
  const chat = usePoolse();
  const [state, setState] = useState<UseMeState>(() => {
    const known = chat.me.peek();
    return { me: known, loading: known === null, error: null };
  });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    // Every screen shares one user: a change made anywhere (say,
    // read receipts turned off) re-renders all of them.
    const off = chat.me.onChange((me) => {
      if (!cancelled) setState({ me, loading: false, error: null });
    });

    chat.me
      .show(controller.signal)
      .then((me) => {
        if (!cancelled) setState({ me, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState((prev) => ({
            me: prev.me,
            loading: false,
            error: err instanceof Error ? err : new Error(String(err)),
          }));
        }
      });

    return () => {
      cancelled = true;
      off();
      controller.abort();
    };
  }, [chat]);

  return state;
}
