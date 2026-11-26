// The one order every UI component uses to turn a user's external id
// into a name: the host's `labelFor`, then the `userResolver` profile,
// then an agent's own name, then a neutral fallback. Never the id: an
// external id (or a slice of a uuid) is not a name and is never shown.

import { useUser } from './use-user.js';

/** What a person with no name we can find is called. */
export const UNKNOWN_USER_LABEL = 'Unknown user';

export interface DisplayNameSources {
  /** The host's names (sync); wins when it returns a real name. */
  labelFor?: ((externalId: string) => string | null | undefined) | undefined;
  /** `useUser(...).profile?.displayName`. */
  profileName?: string | null | undefined;
  /** `useUser(...).agent?.name`. */
  agentName?: string | null | undefined;
  /** Shown when nothing above gives a name. Defaults to {@link UNKNOWN_USER_LABEL}. */
  fallback?: string | undefined;
}

/** A name worth showing: not empty, and not just the id again. */
function usable(name: string | null | undefined, externalId: string): string | null {
  const t = name?.trim();
  return t && t !== externalId ? t : null;
}

/**
 * A user's display name: `labelFor`, then the profile, then an agent's
 * name, then `fallback` ("Unknown user"). A source that only echoes the
 * external id counts as no name — ids never reach the screen.
 */
export function displayNameOf(
  externalId: string | null | undefined,
  sources: DisplayNameSources = {},
): string {
  const fallback = sources.fallback ?? UNKNOWN_USER_LABEL;
  if (!externalId) return fallback;
  return (
    usable(sources.labelFor?.(externalId), externalId) ??
    usable(sources.profileName, externalId) ??
    usable(sources.agentName, externalId) ??
    fallback
  );
}

/**
 * {@link displayNameOf} as a hook: asks the `userResolver` only when
 * `labelFor` has no name for this user.
 */
export function useUserLabel(
  externalId: string | null | undefined,
  labelFor?: ((externalId: string) => string | null | undefined) | undefined,
  fallback?: string,
): string {
  const label = externalId && labelFor ? usable(labelFor(externalId), externalId) : null;
  const { profile, agent } = useUser(label ? null : (externalId ?? null));
  if (label) return label;
  return displayNameOf(externalId, {
    profileName: profile?.displayName,
    agentName: agent?.name,
    ...(fallback !== undefined ? { fallback } : {}),
  });
}
