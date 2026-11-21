// Light on phones with several workspaces: only the workspace on screen
// keeps its socket; the others close theirs (keeping their caches warm
// in memory) and reconnect when switched to — or for a while when a
// push for them arrives (`client.wake()`). With the app in the
// background every socket closes.

import type { Poolse } from '@poolse/sdk';
import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { applyBackground } from '../internal/background.js';

export { applyBackground };

export interface BackgroundClientsOptions {
  /**
   * Also report presence from the app state on the client on screen
   * (`active` in the foreground, `idle` otherwise). Default `true`.
   */
  presence?: boolean;
  /**
   * Keep these clients connected even when not on screen (a workspace
   * with a call running, say). Default none.
   */
  keepConnected?: ReadonlyArray<Poolse>;
}

/**
 * Drive `setBackground` for every signed-in workspace from `AppState`
 * and which one is on screen.
 *
 * ```tsx
 * useBackgroundClients(clients, current);
 * // In the push handler, for the workspace the push names:
 * clientFor(push.tenant_id)?.wake();
 * ```
 */
export function useBackgroundClients(
  clients: ReadonlyArray<Poolse>,
  active: Poolse | null,
  opts: BackgroundClientsOptions = {},
): void {
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState ?? 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', setAppState);
    return () => sub.remove();
  }, []);
  // `inactive` (iOS: the notification centre, an incoming call sheet)
  // is brief; only `background` closes sockets.
  const appActive = appState !== 'background';
  const keep = opts.keepConnected ?? EMPTY;
  const presence = opts.presence ?? true;
  const lastActive = useRef<Poolse | null>(null);

  useEffect(() => {
    applyBackground(clients, active, appActive, keep);
  }, [clients, active, appActive, keep]);

  useEffect(() => {
    if (!presence) return;
    const prev = lastActive.current;
    if (prev && prev !== active && !prev.destroyed) prev.presence.setActivity('idle');
    lastActive.current = active;
    if (active && !active.destroyed) {
      active.presence.setActivity(appState === 'active' ? 'active' : 'idle');
    }
  }, [active, appState, presence]);
}

const EMPTY: ReadonlyArray<Poolse> = [];
