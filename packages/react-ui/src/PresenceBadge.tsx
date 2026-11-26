// PresenceBadge — the dot on an avatar that says whether someone is
// around: online (success), away (warning), in a call (accent, with a
// phone glyph), do not disturb (a moon). Offline draws nothing.
//
// The state comes from `useUserPresence` / `usePresenceMany` in
// @poolse/react; `<Avatar presence>` wires it for you.

import type { PresenceState } from '@poolse/sdk';
import { presenceBadgeKind, presenceStateLabel } from '@poolse/react';

// The text helpers are shared with React Native; re-exported here as before.
export { presenceStateLabel, presenceText } from '@poolse/react';

export interface PresenceBadgeProps {
  /** `online`, `away`, `in_call` or `offline` (offline renders nothing). */
  state: PresenceState | null | undefined;
  /**
   * The person paused notifications or is in their quiet hours
   * (`Presence.do_not_disturb`): a moon replaces the dot while they are
   * online or away (a call still shows the phone).
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
  const kind = presenceBadgeKind(state, doNotDisturb);
  if (!kind || !state) return null;
  const label = kind === 'dnd' ? 'Do not disturb' : presenceStateLabel(state);
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
