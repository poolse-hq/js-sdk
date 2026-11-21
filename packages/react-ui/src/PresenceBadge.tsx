// PresenceBadge — the dot on an avatar that says whether someone is
// around: online (success), away (warning), in a call (accent, with a
// phone glyph), do not disturb (a moon). Offline draws nothing.
//
// The state comes from `useUserPresence` / `usePresenceMany` in
// @poolse/react; `<Avatar presence>` wires it for you.

import type { Presence, PresenceState } from '@poolse/sdk';
import { formatRelativeTime } from './relativeTime.js';

export interface PresenceBadgeProps {
  /** `online`, `away`, `in_call` or `offline` (offline renders nothing). */
  state: PresenceState | null | undefined;
  /**
   * The person paused notifications or is in their quiet hours
   * (`Presence.do_not_disturb`): a moon replaces the dot while they are
   * not offline.
   */
  doNotDisturb?: boolean;
  /** Matches the avatar it sits on. Defaults to `md`. */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

export function PresenceBadge({
  state,
  doNotDisturb = false,
  size = 'md',
  className,
}: PresenceBadgeProps) {
  if (!state || state === 'offline') return null;
  const kind = doNotDisturb ? 'dnd' : state;
  const label = doNotDisturb ? 'Do not disturb' : presenceStateLabel(state);
  return (
    <span
      className={[
        'poolse-presence-badge',
        `poolse-presence-badge--${kind}`,
        `poolse-presence-badge--${size}`,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      role="img"
      aria-label={label}
      title={label}
      data-presence={kind}
    >
      {kind === 'in_call' ? <PhoneGlyph /> : kind === 'dnd' ? <MoonGlyph /> : null}
    </span>
  );
}

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
 * The line a header or roster shows under a name: "Online", "Away",
 * "In a call", "Last seen 5m ago" (offline with a known time), else
 * "Offline". Null when presence isn't known yet.
 */
export function presenceText(
  presence: Presence | null | undefined,
  now = Date.now(),
): string | null {
  if (!presence) return null;
  if (presence.state === 'offline') {
    const ago = formatRelativeTime(presence.last_seen_at, now);
    return ago ? `Last seen ${ago}` : 'Offline';
  }
  return presenceStateLabel(presence.state);
}

function PhoneGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"
      />
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1z" />
    </svg>
  );
}
