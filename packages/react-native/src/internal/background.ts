// Pure part of `useBackgroundClients`, so vitest can run it under node.

import type { Poolse } from '@poolse/sdk';

/**
 * Which clients should be in the background: all of them while the app
 * isn't active; otherwise every one except `active` (and `keepConnected`).
 */
export function applyBackground(
  clients: ReadonlyArray<Poolse>,
  active: Poolse | null,
  appActive: boolean,
  keepConnected: ReadonlyArray<Poolse> = [],
): void {
  for (const c of clients) {
    if (c.destroyed) continue;
    const foreground = appActive && (c === active || keepConnected.includes(c));
    c.setBackground(!foreground);
  }
}
