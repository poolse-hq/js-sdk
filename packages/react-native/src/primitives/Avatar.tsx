import type { PresenceState } from '@poolse/sdk';
import { useUserPresence } from '@poolse/react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { PresenceBadge } from '../PresenceBadge.js';
import { useTheme } from '../theme/PoolseTheme.js';
import { userColor } from './userColor.js';

export interface AvatarProps {
  /** URL to a profile image. Falls back to initials when omitted. */
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
}: AvatarProps) {
  const theme = useTheme();
  const dim = SIZES[size];
  const initials = computeInitials(name);
  const tint = seed ? userColor(seed) : theme.colors.accent;
  const fontSize = size === 'xs' ? 9 : size === 'sm' ? 11 : size === 'lg' ? 22 : 15;
  const badgeSize = Math.max(8, Math.round(dim * 0.32));
  const badgeStyle = { position: 'absolute' as const, bottom: -1, right: -1 };
  const lookupId = presence === true ? (userId ?? seed ?? null) : null;

  return (
    <View
      style={[
        styles.root,
        {
          width: dim,
          height: dim,
          borderRadius: dim / 2,
          backgroundColor: tint,
        },
      ]}
      accessibilityRole="image"
      accessibilityLabel={name ?? 'avatar'}
    >
      {src ? (
        <Image
          source={{ uri: src }}
          style={{ width: dim, height: dim, borderRadius: dim / 2 }}
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
      {lookupId ? (
        <LivePresenceBadge id={lookupId} size={badgeSize} style={badgeStyle} />
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
  presence: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    borderWidth: 2,
  },
});
