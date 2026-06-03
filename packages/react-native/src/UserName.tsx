import { Text } from 'react-native';
import { useUser } from '@poolse/react';

import { usePoolseTheme } from './theme/PoolseTheme.js';

export interface UserNameProps {
  /** The user's external_id. Pass null to render the fallback. */
  externalId: string | null | undefined;
  /** Optional fallback when the resolver returns nothing. Defaults to the externalId itself. */
  fallback?: string;
  /** Caller-supplied label override; if it returns a string, it wins. */
  labelFor?: (externalId: string) => string;
}

/**
 * Display name for a user, looked up via the SDK's `userResolver`
 * with caller-overridable + fallback fallbacks. Renders a `<Text>`.
 */
export function UserName({ externalId, fallback, labelFor }: UserNameProps) {
  const theme = usePoolseTheme();
  const name = useDisplayName(externalId, labelFor) ?? fallback ?? externalId ?? '';
  return <Text style={{ color: theme.colors.ink, fontFamily: theme.type.fontBody }}>{name}</Text>;
}

/**
 * Resolves a user's display name via the 3-tier chain:
 * 1. `labelFor(externalId)` — caller-supplied override
 * 2. SDK `userResolver` (memoized via `useUser`)
 * 3. The externalId itself (so something always renders)
 */
export function useDisplayName(
  externalId: string | null | undefined,
  labelFor?: (externalId: string) => string,
): string {
  const resolved = useUser(externalId ?? null);
  if (!externalId) return '';
  if (labelFor) {
    const override = labelFor(externalId);
    if (override) return override;
  }
  return resolved.profile?.displayName ?? externalId;
}
