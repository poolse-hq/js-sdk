import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from './theme/PoolseTheme.js';

export interface DaySeparatorProps {
  label: string;
  /**
   * `'pill'` (default) — a centred chip, for bubbles. `'rule'` — a
   * hairline across the row with the chip on it, for the `list` and
   * `compact` layouts.
   */
  variant?: 'pill' | 'rule';
}

/**
 * Centered date pill rendered between messages whose `inserted_at`
 * falls on a different calendar day from the previous message. Pair
 * with `formatDayLabel` from `@poolse/react` to compute the label
 * ("Today" / "Yesterday" / weekday / "26 May 2024").
 */
export function DaySeparator({ label, variant = 'pill' }: DaySeparatorProps) {
  const theme = useTheme();
  const rule =
    variant === 'rule' ? (
      <View style={[styles.rule, { backgroundColor: theme.colors.border }]} />
    ) : null;
  return (
    <View style={[styles.wrap, rule ? styles.wrapRule : null]}>
      {rule}
      <View
        style={[
          styles.chip,
          {
            backgroundColor: theme.colors.surfaceAlt,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <Text
          style={[
            styles.label,
            {
              color: theme.colors.textMuted,
              fontFamily: theme.fonts.body,
            },
          ]}
        >
          {label}
        </Text>
      </View>
      {rule}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    marginVertical: 8,
  },
  wrapRule: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
  },
  rule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
