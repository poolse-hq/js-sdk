import { StyleSheet, Text, View } from 'react-native';

import { usePoolseTheme } from './theme/PoolseTheme.js';

export interface DaySeparatorProps {
  label: string;
}

/**
 * Centered date pill rendered between messages whose `inserted_at`
 * falls on a different calendar day from the previous message. Pair
 * with `formatDayLabel` from `@poolse/react` to compute the label
 * ("Today" / "Yesterday" / weekday / "26 May 2024").
 */
export function DaySeparator({ label }: DaySeparatorProps) {
  const theme = usePoolseTheme();
  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.chip,
          {
            backgroundColor: theme.colors.surface2,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <Text
          style={[
            styles.label,
            {
              color: theme.colors.ink2,
              fontFamily: theme.type.fontBody,
            },
          ]}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    marginVertical: 8,
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
