import type { PresenceState } from '@poolse/sdk';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { presenceBadgeKind } from './internal/presence.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
import { useTheme } from './theme/PoolseTheme.js';

export interface PresenceBadgeProps {
  /** `online`, `away`, `in_call` or `offline` (draws nothing), as `useUserPresence` gives it. */
  state: PresenceState | null | undefined;
  /** Do not disturb: a moon instead of the online / away dot. */
  doNotDisturb?: boolean;
  /** Diameter in px. Defaults to 12. */
  size?: number;
  /** The ring around the badge — the colour it sits on. Defaults to `colors.surface`. */
  ringColor?: string;
  style?: StyleProp<ViewStyle>;
}

const LABELS = {
  online: 'Online',
  away: 'Away',
  in_call: 'In a call',
  dnd: 'Do not disturb',
} as const;

/**
 * A presence dot: online = `success`, away = `warning`, in a call =
 * `accent` with a phone, do not disturb = a moon. Offline (or unknown)
 * draws nothing.
 */
export function PresenceBadge({
  state,
  doNotDisturb = false,
  size = 12,
  ringColor,
  style,
}: PresenceBadgeProps) {
  const theme = useTheme();
  const kind = presenceBadgeKind(state, doNotDisturb);
  if (!kind) return null;
  const fill =
    kind === 'online'
      ? theme.colors.success
      : kind === 'away'
        ? theme.colors.warning
        : kind === 'in_call'
          ? theme.colors.accent
          : theme.colors.warning;
  const ring = Math.max(1.5, Math.round(size / 6));
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={LABELS[kind]}
      style={[
        styles.badge,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: ring,
          borderColor: ringColor ?? theme.colors.surface,
          backgroundColor: kind === 'dnd' ? (ringColor ?? theme.colors.surface) : fill,
        },
        style,
      ]}
    >
      {kind === 'in_call' && size >= 10 ? (
        <PoolseIcon
          name="phone"
          size={size - ring * 2 - 1}
          color={theme.colors.accentText}
          label={null}
        />
      ) : null}
      {kind === 'dnd' ? <Moon size={size - ring * 2} color={fill} /> : null}
    </View>
  );
}

function Moon({ size, color }: { size: number; color: string }) {
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${color}" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>`;
  return <SvgXml xml={xml} width={size} height={size} />;
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
