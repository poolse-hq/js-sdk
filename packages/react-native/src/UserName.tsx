import { Text, View } from 'react-native';
import { useAgent, useUserLabel } from '@poolse/react';

import { AgentBadge } from './AgentBadge.js';
import { useTheme } from './theme/PoolseTheme.js';

export interface UserNameProps {
  /** The user's external_id. Pass null to render the fallback. */
  externalId: string | null | undefined;
  /** Shown when `externalId` is null. Defaults to "" (nothing). */
  fallback?: string;
  /** Caller-supplied label override; if it returns a string, it wins. */
  labelFor?: (externalId: string) => string;
  /** The Agent badge after an agent's name (AG1). Defaults to `true`. */
  agentBadge?: boolean;
}

/**
 * Display name for a user, looked up via the SDK's `userResolver`
 * with caller-overridable + fallback fallbacks. Renders a `<Text>`.
 */
export function UserName({ externalId, fallback, labelFor, agentBadge = true }: UserNameProps) {
  const theme = useTheme();
  const name = useDisplayName(externalId, labelFor) || fallback || '';
  const isAgent = !!useAgent(agentBadge ? externalId : null);
  const text = (
    <Text
      style={{ color: theme.colors.text, fontFamily: theme.fonts.body, flexShrink: 1 }}
      numberOfLines={1}
    >
      {name}
    </Text>
  );
  if (!isAgent) return text;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
      {text}
      <AgentBadge size="xs" />
    </View>
  );
}

/**
 * Resolves a user's display name via the 3-tier chain (`displayNameOf`
 * in @poolse/react, the same order as web):
 * 1. `labelFor(externalId)` — caller-supplied override
 * 2. SDK `userResolver` (memoized via `useUser`)
 * 3. "Unknown user" — never the id itself
 *
 * Returns "" when `externalId` is null.
 */
export function useDisplayName(
  externalId: string | null | undefined,
  labelFor?: (externalId: string) => string,
): string {
  const name = useUserLabel(externalId, labelFor);
  return externalId ? name : '';
}
