// Presence → what a badge draws and what a header or roster says,
// shared by web and React Native so both show the same thing.

import type { Presence, PresenceState } from '@poolse/sdk';
import { relativeTime } from './chat-time.js';

/** What a presence badge draws: nothing for offline / unknown. */
export type PresenceBadgeKind = 'online' | 'away' | 'in_call' | 'dnd';

/** "Online", "Away", "In a call", "Offline". */
export function presenceStateLabel(state: PresenceState): string {
  switch (state) {
    case 'online':
      return 'Online';
    case 'away':
      return 'Away';
    case 'in_call':
      return 'In a call';
    default:
      return 'Offline';
  }
}

/**
 * The badge for a state. Do-not-disturb (a moon) wins over online and
 * away, but not over a call — "in a call" says more right now — and an
 * offline user shows no badge at all.
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
 * The line under a name: "Online", "Away", "In a call", "Last seen 5m
 * ago" (offline with a known time), else "Offline"; online and away add
 * " · Do not disturb". Null when presence isn't known yet.
 */
export function presenceText(
  presence:
    | (Pick<Presence, 'state' | 'last_seen_at'> & Partial<Pick<Presence, 'do_not_disturb'>>)
    | null
    | undefined,
  now: Date | number = Date.now(),
): string | null {
  if (!presence) return null;
  if (presence.state === 'offline') {
    const ago = relativeTime(presence.last_seen_at, now);
    return ago ? `Last seen ${ago}` : 'Offline';
  }
  const dnd = presence.do_not_disturb && presence.state !== 'in_call' ? ' · Do not disturb' : '';
  return `${presenceStateLabel(presence.state)}${dnd}`;
}
