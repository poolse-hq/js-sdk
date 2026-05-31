// Avatar — circular profile picture or initials fallback, optional
// presence dot. The initials gradient (brand → brand-strong) keeps
// even no-image users visually anchored to the brand identity.

export interface AvatarProps {
  /** URL to a profile image. Renders initials fallback when omitted or load fails. */
  src?: string | null;
  /** Used for initials and as the image alt text. */
  name?: string | null;
  /** Show a green presence dot in the bottom-right corner. */
  online?: boolean;
  /** Size variant; defaults to `md` (40px). */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Avatar({ src, name, online, size = 'md', className }: AvatarProps) {
  const initials = computeInitials(name);

  const classes = [
    'poolse-avatar',
    size === 'sm' ? 'poolse-avatar--sm' : null,
    size === 'lg' ? 'poolse-avatar--lg' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} aria-label={name ?? 'avatar'} role="img">
      {src ? <img src={src} alt={name ?? ''} /> : <span aria-hidden="true">{initials}</span>}
      {online ? <span className="poolse-avatar__presence" aria-hidden="true" /> : null}
    </span>
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
