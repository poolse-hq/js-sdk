// Resolved display-name renderer with a 3-tier fallback chain. Used by
// MemberList, MentionInput's dropdown, TypingIndicator — anywhere a
// user identifier needs to become a human name.
//
// Priority:
//   1. Caller-supplied `labelFor` (sync, fast path) — back-compat with
//      apps that pass directory data through props.
//   2. Customer-configured `userResolver` via the `useUser` hook
//      (async, cached, dedup'd across components).
//   3. "Unknown user" — never the id itself (ids are not names).
//
// The order is `displayNameOf` from @poolse/react, shared with every
// row, bubble and header (and with React Native).
//
// Each instance is its own component so calling `<UserName>` inside a
// map() doesn't violate the Rules of Hooks — each gets its own
// useUser cell.

import { useAgent, useUserLabel } from '@poolse/react';
import { AgentBadge } from './AgentBadge.js';

const MAX_NAME_CHARS = 24;

export interface UserNameProps {
  /** The tenant's user identifier — what your `userResolver` consumes. */
  externalId: string | null | undefined;
  /** Sync override. When it has a name, the async resolver isn't asked. */
  labelFor?: (externalId: string) => string;
  /** What to render when `externalId` itself is null (e.g. system messages). */
  emptyFallback?: string;
  /** The Agent badge after an agent's name (AG1). Defaults to `true`. */
  agentBadge?: boolean;
  className?: string;
}

export function UserName({
  externalId,
  labelFor,
  emptyFallback = 'Unknown',
  agentBadge = true,
  className,
}: UserNameProps) {
  const name = useDisplayName(externalId, labelFor, emptyFallback);
  // Agents are known without the resolver.
  const isAgent = !!useAgent(agentBadge ? externalId : null);
  if (!isAgent) return <span className={className}>{truncate(name)}</span>;
  return (
    <span className={['poolse-username', className].filter(Boolean).join(' ')}>
      <span className="poolse-username__name">{truncate(name)}</span>
      <AgentBadge size="xs" />
    </span>
  );
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
  const name = useUserLabel(externalId, labelFor);
  return externalId ? name : emptyFallback;
}

function truncate(s: string): string {
  if (s.length <= MAX_NAME_CHARS) return s;
  return s.slice(0, MAX_NAME_CHARS - 1) + '…';
}
