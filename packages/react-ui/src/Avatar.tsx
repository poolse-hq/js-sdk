// Avatar — circular profile picture or initials fallback, optional
// presence badge. The initials gradient (brand → brand-strong) keeps
// even no-image users visually anchored to the brand identity.

import type { Presence, PresenceState } from '@poolse/sdk';
import { useOptionalPoolse, useUserPresence } from '@poolse/react';
import { useState } from 'react';
import { PresenceBadge } from './PresenceBadge.js';

export interface AvatarProps {
  /** URL to a profile image. Renders initials fallback when omitted or load fails. */
  src?: string | null;
  /** Used for initials and as the image alt text. */
  name?: string | null;
  /**
   * Show a green presence dot in the bottom-right corner.
   * @deprecated Use `presence` (`presence="online"`).
   */
  online?: boolean;
  /**
   * A presence badge in the bottom-right corner (see `<PresenceBadge>`):
   * a state (`'online' | 'away' | 'in_call' | 'offline'`), a `Presence`
   * (also shows do-not-disturb), or `true` to look it up live with
   * `useUserPresence(userId)`. Offline draws nothing.
   */
  presence?: PresenceState | Presence | true | null;
  /**
   * Whose avatar this is — a poolse user id or an `external_id`. Needed
   * by `presence={true}`.
   */
  userId?: string | null;
  /** Size variant; defaults to `md` (40px). `xs` is 20px. */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /**
   * An agent, not a person (AG1): a rounded-square avatar with a small
   * agent mark, and "(agent)" in its label. Pass `useUser(id).agent`.
   */
  agent?: boolean;
  className?: string;
}

export function Avatar({
  src,
  name,
  online,
  presence,
  userId,
  size = 'md',
  agent = false,
  className,
}: AvatarProps) {
  const initials = computeInitials(name);
  // A broken image falls back to the initials (keyed by src: a new one retries).
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = !!src && failedSrc !== src;

  const classes = [
    'poolse-avatar',
    size !== 'md' ? `poolse-avatar--${size}` : null,
    agent ? 'poolse-avatar--agent' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const label = agent ? `${name ?? 'Agent'} (agent)` : (name ?? 'avatar');

  const badge =
    presence === true ? (
      userId ? (
        <OptionalLivePresenceBadge userId={userId} size={size} />
      ) : null
    ) : presence ? (
      typeof presence === 'string' ? (
        <PresenceBadge state={presence} size={size} className="poolse-avatar__badge" />
      ) : (
        <PresenceBadge
          state={presence.state}
          doNotDisturb={!!presence.do_not_disturb}
          size={size}
          className="poolse-avatar__badge"
        />
      )
    ) : online ? (
      <span className="poolse-avatar__presence" aria-hidden="true" />
    ) : null;

  return (
    <span className={classes} aria-label={label} role="img">
      {showImage ? (
        <img src={src} alt={name ?? ''} onError={() => setFailedSrc(src)} />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
      {agent && size !== 'xs' ? <span className="poolse-avatar__agent" aria-hidden="true" /> : null}
      {badge}
    </span>
  );
}

// Outside a <PoolseProvider> (a public booking page) there is nobody to
// ask: no badge, no throw.
function OptionalLivePresenceBadge(props: { userId: string; size: AvatarProps['size'] }) {
  return useOptionalPoolse() ? <LivePresenceBadge {...props} /> : null;
}

// Own component so the presence subscription exists only for avatars
// that asked for it (and Avatar keeps working outside a provider).
function LivePresenceBadge({ userId, size }: { userId: string; size: AvatarProps['size'] }) {
  const presence = useUserPresence(userId);
  if (!presence) return null;
  return (
    <PresenceBadge
      state={presence.state}
      doNotDisturb={!!presence.do_not_disturb}
      {...(size ? { size } : {})}
      className="poolse-avatar__badge"
    />
  );
}

/**
 * Compute up to 2 initials from a name. "Jane Doe" → "JD",
 * "alice" → "A", null/empty → "?".
 */
function computeInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return (
    parts
      .map((p) => p.charAt(0).toUpperCase())
      .join('')
      .slice(0, 2) || '?'
  );
}
