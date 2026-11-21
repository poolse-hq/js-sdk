// Presence → what the badge draws and what the header says. Pure, so
// vitest can run it under node.

import type { Presence, PresenceState } from '@poolse/sdk';

import { relativeTime } from './time.js';

/** What `<PresenceBadge>` draws: nothing for offline / unknown. */
export type PresenceBadgeKind = 'online' | 'away' | 'in_call' | 'dnd';

/**
 * The badge for a state. Do-not-disturb wins over online / away (a
 * moon), but not over a call or offline — an offline user shows no
 * badge at all.
 */
export function presenceBadgeKind(
  state: PresenceState | null | undefined,
  doNotDisturb = false,
): PresenceBadgeKind | null {
  if (!state || state === 'offline') return null;
  if (state === 'in_call') return 'in_call';
  if (doNotDisturb) return 'dnd';
  return state;
}

/**
 * The line under a direct chat's title: "Online", "Away", "In a call",
 * "Last seen 5m ago" (offline with a known last-seen time), or null
 * when nothing useful is known. Do-not-disturb adds " · Do not disturb".
 */
export function presenceText(
  presence: Pick<Presence, 'state' | 'last_seen_at' | 'do_not_disturb'> | null | undefined,
  now: Date | number = Date.now(),
): string | null {
  if (!presence) return null;
  const dnd = presence.do_not_disturb ? ' · Do not disturb' : '';
  switch (presence.state) {
    case 'online':
      return `Online${dnd}`;
    case 'away':
      return `Away${dnd}`;
    case 'in_call':
      return 'In a call';
    case 'offline': {
      const ago = relativeTime(presence.last_seen_at, now);
      return ago ? `Last seen ${ago}` : null;
    }
    default:
      return null;
  }
}
