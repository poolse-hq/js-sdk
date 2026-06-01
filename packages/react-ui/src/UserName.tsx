// Resolved display-name renderer with a 3-tier fallback chain. Used by
// MemberList, MentionInput's dropdown, TypingIndicator — anywhere a
// user_id needs to become a human name.
//
// Priority:
//   1. Caller-supplied `labelFor` (sync, fast path) — back-compat with
//      the v0.2 API + the way most apps already pass directory data
//      through props.
//   2. Customer-configured `userResolver` via the `useUser` hook
//      (async, cached, dedup'd across components).
//   3. `User abc123` derived from the userId slice — the always-renders
//      fallback when neither path produced a name. Truncates the
//      visible name to 24 chars so a runaway value can't blow out
//      the surrounding layout.
//
// Each instance is its own component so calling `<UserName>` inside a
// map() doesn't violate the Rules of Hooks — each gets its own
// useUser cell.

import type { Uuid } from '@poolse/sdk';
import { useUser } from '@poolse/react';

const MAX_NAME_CHARS = 24;

export interface UserNameProps {
  userId: Uuid | null | undefined;
  /** Sync override. When set, skips the async resolver entirely. */
  labelFor?: (userId: Uuid) => string;
  /** What to render when the userId itself is null (e.g. system messages). */
  emptyFallback?: string;
  className?: string;
}

export function UserName({
  userId,
  labelFor,
  emptyFallback = 'Unknown',
  className,
}: UserNameProps) {
  // Skip the resolver when labelFor is given OR userId is missing —
  // useUser handles the empty userId case internally (passing null),
  // so it's safe to call unconditionally.
  const { profile } = useUser(labelFor ? null : userId);
  const name = resolveDisplayName(userId, profile?.displayName, labelFor, emptyFallback);
  return <span className={className}>{truncate(name)}</span>;
}

/**
 * Same priority chain as the component but as a plain hook so callers
 * that need the resolved name in a string context (aria-label,
 * tooltip, etc.) don't have to render an extra element.
 */
export function useDisplayName(
  userId: Uuid | null | undefined,
  labelFor?: (userId: Uuid) => string,
  emptyFallback = 'Unknown',
): string {
  const { profile } = useUser(labelFor ? null : userId);
  return resolveDisplayName(userId, profile?.displayName, labelFor, emptyFallback);
}

function resolveDisplayName(
  userId: Uuid | null | undefined,
  resolved: string | undefined,
  labelFor: ((id: Uuid) => string) | undefined,
  emptyFallback: string,
): string {
  if (!userId) return emptyFallback;
  if (labelFor) return labelFor(userId);
  if (resolved) return resolved;
  return `User ${userId.slice(0, 6)}`;
}

function truncate(s: string): string {
  if (s.length <= MAX_NAME_CHARS) return s;
  return s.slice(0, MAX_NAME_CHARS - 1) + '…';
}
