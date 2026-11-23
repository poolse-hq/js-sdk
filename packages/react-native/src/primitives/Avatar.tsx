import type { PresenceState } from '@poolse/sdk';
import { useOptionalPoolse, useUserPresence } from '@poolse/react';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { PresenceBadge } from '../PresenceBadge.js';
import { useTheme } from '../theme/PoolseTheme.js';
import { userColor } from './userColor.js';

export interface AvatarProps {
  /** URL to a profile image. Falls back to initials when omitted or it fails to load. */
  src?: string | null;
  /** Used for initials. */
  name?: string | null;
  /** Stable color seed (typically the user's external_id). */
  seed?: string | null;
  /** Show a green presence dot in the bottom-right corner. Superseded by `presence`. */
  online?: boolean;
  /**
   * A presence badge in the bottom-right corner (see `<PresenceBadge>`):
   * a state, or `true` to look it up live with `useUserPresence` for
   * `userId` (else `seed`) — that needs a `<PoolseProvider>` above.
   */
  presence?: PresenceState | true | null;
  /** Do not disturb, with an explicit `presence` state (looked up automatically with `true`). */
  doNotDisturb?: boolean;
  /** Who `presence={true}` looks up: a user id or external id. Defaults to `seed`. */
  userId?: string | null;
  /** Size variant. `md` → 40px, `sm` → 28px, `xs` → 20px, `lg` → 56px. */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /**
   * An agent, not a person (AG1): a rounded-square avatar with a small
   * agent mark, and "(agent)" in its label. Pass `useUser(id).agent`.
   */
  agent?: boolean;
}

const SIZES = { xs: 20, sm: 28, md: 40, lg: 56 } as const;

export function Avatar({
  src,
  name,
  seed,
  online,
  presence,
  doNotDisturb,
  userId,
  size = 'md',
  agent = false,
}: AvatarProps) {
  const theme = useTheme();
  const dim = SIZES[size];
  const initials = computeInitials(name);
  // A broken image falls back to the initials (keyed by src: a new one retries).
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const tint = seed ? userColor(seed) : theme.colors.accent;
  const fontSize = size === 'xs' ? 9 : size === 'sm' ? 11 : size === 'lg' ? 22 : 15;
  const badgeSize = Math.max(8, Math.round(dim * 0.32));
  const badgeStyle = { position: 'absolute' as const, bottom: -1, right: -1 };
  const lookupId = presence === true ? (userId ?? seed ?? null) : null;
  const radius = agent ? Math.round(dim * 0.28) : dim / 2;

  return (
    <View
      style={[
        styles.root,
        {
          width: dim,
          height: dim,
          borderRadius: radius,
          backgroundColor: agent ? theme.colors.info : tint,
        },
      ]}
      accessibilityRole="image"
      accessibilityLabel={agent ? `${name ?? 'Agent'} (agent)` : (name ?? 'avatar')}
    >
      {src && failedSrc !== src ? (
        <Image
          source={{ uri: src }}
          onError={() => setFailedSrc(src)}
          style={{ width: dim, height: dim, borderRadius: radius }}
          accessible={false}
        />
      ) : (
        <Text
          style={{
            color: theme.colors.accentText,
            fontSize,
            fontWeight: '600',
            fontFamily: theme.fonts.body,
          }}
        >
          {initials}
        </Text>
      )}
      {agent && size !== 'xs' ? (
        <View
          style={[
            styles.agentMark,
            {
              width: Math.max(8, Math.round(dim * 0.28)),
              height: Math.max(8, Math.round(dim * 0.28)),
              backgroundColor: theme.colors.info,
              borderColor: theme.colors.surface,
            },
          ]}
        />
      ) : null}
      {lookupId ? (
        <OptionalLivePresenceBadge id={lookupId} size={badgeSize} style={badgeStyle} />
      ) : presence && presence !== true ? (
        <PresenceBadge
          state={presence}
          {...(doNotDisturb ? { doNotDisturb } : {})}
          size={badgeSize}
          style={badgeStyle}
        />
      ) : online && presence === undefined ? (
        <View
          style={[
            styles.presence,
            {
              backgroundColor: theme.colors.presence,
              borderColor: theme.colors.surface,
              width: dim * 0.32,
              height: dim * 0.32,
              borderRadius: dim * 0.16,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

// Outside a <PoolseProvider> there is nobody to ask: no badge, no throw.
function OptionalLivePresenceBadge(props: {
  id: string;
  size: number;
  style: { position: 'absolute'; bottom: number; right: number };
}) {
  return useOptionalPoolse() ? <LivePresenceBadge {...props} /> : null;
}

// Its own component so `useUserPresence` (which needs a provider) only
// runs for avatars that asked for a lookup.
function LivePresenceBadge({
  id,
  size,
  style,
}: {
  id: string;
  size: number;
  style: { position: 'absolute'; bottom: number; right: number };
}) {
  const presence = useUserPresence(id);
  return (
    <PresenceBadge
      state={presence?.state ?? null}
      doNotDisturb={!!presence?.do_not_disturb}
      size={size}
      style={style}
    />
  );
}

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

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  agentMark: {
    position: 'absolute',
    left: -2,
    bottom: -2,
    borderRadius: 3,
    borderWidth: 2,
  },
  presence: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    borderWidth: 2,
  },
});
