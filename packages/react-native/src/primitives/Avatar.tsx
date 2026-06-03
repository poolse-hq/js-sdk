import { Image, StyleSheet, Text, View } from 'react-native';

import { usePoolseTheme } from '../theme/PoolseTheme.js';
import { userColor } from './userColor.js';

export interface AvatarProps {
  /** URL to a profile image. Falls back to initials when omitted. */
  src?: string | null;
  /** Used for initials. */
  name?: string | null;
  /** Stable color seed (typically the user's external_id). */
  seed?: string | null;
  /** Show a green presence dot in the bottom-right corner. */
  online?: boolean;
  /** Size variant. `md` → 40px, `sm` → 28px, `lg` → 56px. */
  size?: 'sm' | 'md' | 'lg';
}

const SIZES = { sm: 28, md: 40, lg: 56 } as const;

export function Avatar({ src, name, seed, online, size = 'md' }: AvatarProps) {
  const theme = usePoolseTheme();
  const dim = SIZES[size];
  const initials = computeInitials(name);
  const tint = seed ? userColor(seed) : theme.colors.brand;
  const fontSize = size === 'sm' ? 11 : size === 'lg' ? 22 : 15;

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
            color: theme.colors.onBrand,
            fontSize,
            fontWeight: '600',
            fontFamily: theme.type.fontBody,
          }}
        >
          {initials}
        </Text>
      )}
      {online ? (
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
