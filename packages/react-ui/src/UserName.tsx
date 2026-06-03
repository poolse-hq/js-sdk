// Resolved display-name renderer with a 3-tier fallback chain. Used by
// MemberList, MentionInput's dropdown, TypingIndicator — anywhere a
// user identifier needs to become a human name.
//
// Priority:
//   1. Caller-supplied `labelFor` (sync, fast path) — back-compat with
//      apps that pass directory data through props.
//   2. Customer-configured `userResolver` via the `useUser` hook
//      (async, cached, dedup'd across components).
//   3. The external_id itself, truncated. Always renders something.
//
// Each instance is its own component so calling `<UserName>` inside a
// map() doesn't violate the Rules of Hooks — each gets its own
// useUser cell.

import { useUser } from '@poolse/react';

const MAX_NAME_CHARS = 24;

export interface UserNameProps {
  /** The tenant's user identifier — what your `userResolver` consumes. */
  externalId: string | null | undefined;
  /** Sync override. When set, skips the async resolver entirely. */
  labelFor?: (externalId: string) => string;
  /** What to render when `externalId` itself is null (e.g. system messages). */
  emptyFallback?: string;
  className?: string;
}

export function UserName({
  externalId,
  labelFor,
  emptyFallback = 'Unknown',
  className,
}: UserNameProps) {
  // Skip the resolver when labelFor is given OR externalId is missing.
  const { profile } = useUser(labelFor ? null : externalId);
  const name = resolveDisplayName(externalId, profile?.displayName, labelFor, emptyFallback);
  return <span className={className}>{truncate(name)}</span>;
}

/**
 * Same priority chain as the component but as a plain hook so callers
 * that need the resolved name in a string context (aria-label,
 * tooltip, etc.) don't have to render an extra element.
 */
export function useDisplayName(
  externalId: string | null | undefined,
  labelFor?: (externalId: string) => string,
  emptyFallback = 'Unknown',
): string {
  const { profile } = useUser(labelFor ? null : externalId);
  return resolveDisplayName(externalId, profile?.displayName, labelFor, emptyFallback);
}

function resolveDisplayName(
  externalId: string | null | undefined,
  resolved: string | undefined,
  labelFor: ((id: string) => string) | undefined,
  emptyFallback: string,
): string {
  if (!externalId) return emptyFallback;
  if (labelFor) return labelFor(externalId);
  if (resolved) return resolved;
  // Last resort — show the tenant's id rather than a slice of a uuid
  // the dev never sees in their own DB.
  return externalId;
}

function truncate(s: string): string {
  if (s.length <= MAX_NAME_CHARS) return s;
  return s.slice(0, MAX_NAME_CHARS - 1) + '…';
}
