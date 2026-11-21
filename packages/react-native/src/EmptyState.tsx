import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from './theme/PoolseTheme.js';

export interface EmptyStateProps {
  /** What's empty, in a few words: "No messages yet". */
  title: string;
  /** What to do next. */
  hint?: string;
  /** A button for the next step. */
  action?: ReactNode;
}

/**
 * An empty screen that says what to do next — the default for an empty
 * conversation list, an empty conversation and an empty thread. Pass
 * your own `emptyState` to any of them to replace it.
 */
export function EmptyState({ title, hint, action }: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View style={styles.root} accessible accessibilityRole="text">
      <Text
        style={[styles.title, { color: theme.colors.text, fontFamily: theme.fonts.body }]}
        maxFontSizeMultiplier={2}
      >
        {title}
      </Text>
      {hint ? (
        <Text
          style={[styles.hint, { color: theme.colors.textMuted, fontFamily: theme.fonts.body }]}
          maxFontSizeMultiplier={2}
        >
          {hint}
        </Text>
      ) : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', paddingHorizontal: 24, paddingVertical: 24, maxWidth: 360 },
  title: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  hint: { fontSize: 14, lineHeight: 20, marginTop: 6, textAlign: 'center' },
  action: { marginTop: 14 },
});
