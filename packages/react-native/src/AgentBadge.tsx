// AgentBadge — the "Agent" pill next to an agent's name (AG1). Same
// props as @poolse/react-ui. An agent is never shown as a person:
// wherever its name appears, so does this.

import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from './theme/PoolseTheme.js';

export interface AgentBadgeProps {
  /** `sm` (default) beside names in lists; `xs` in dense rows. */
  size?: 'xs' | 'sm';
  /** Defaults to "Agent". */
  label?: string;
  style?: StyleProp<ViewStyle>;
}

export function AgentBadge({ size = 'sm', label = 'Agent', style }: AgentBadgeProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.pill,
        size === 'xs' && styles.pillXs,
        { backgroundColor: withAlpha(theme.colors.info, 0.14) },
        style,
      ]}
      accessibilityRole="text"
      accessibilityLabel="AI agent"
    >
      <Text
        style={[
          styles.text,
          size === 'xs' && styles.textXs,
          { color: theme.colors.info, fontFamily: theme.fonts.body },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * The badge as nested text, for inside a `<Text>` (a sender label that
 * is itself pressable text). Same wording and color as `<AgentBadge>`.
 */
export function AgentBadgeInline({ label = 'Agent' }: { label?: string }) {
  const theme = useTheme();
  return (
    <Text
      style={{ color: theme.colors.info, fontWeight: '700', fontSize: 11 }}
      accessibilityLabel="AI agent"
    >
      {label}
    </Text>
  );
}

/** `#rrggbb` + alpha → `rgba(…)`; anything else is returned as is. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) return color;
  return `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})`;
}

const styles = StyleSheet.create({
  pill: {
    flexShrink: 0,
    alignSelf: 'center',
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 999,
  },
  pillXs: { paddingHorizontal: 6, paddingVertical: 0 },
  text: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
  textXs: { fontSize: 10 },
});
