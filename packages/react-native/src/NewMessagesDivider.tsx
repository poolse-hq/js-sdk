import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from './theme/PoolseTheme.js';

export interface NewMessagesDividerProps {
  /** Defaults to "New messages". */
  label?: string;
}

/**
 * The line `<ConversationView>` draws above the first message you
 * hadn't read when the conversation opened. Full width, so it reads the
 * same in every layout.
 */
export function NewMessagesDivider({ label = 'New messages' }: NewMessagesDividerProps) {
  const theme = useTheme();
  return (
    <View
      style={[styles.row, { paddingHorizontal: theme.spacing.md }]}
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      <View style={[styles.line, { backgroundColor: theme.colors.accent }]} />
      <Text
        style={[styles.label, { color: theme.colors.accentStrong, fontFamily: theme.fonts.body }]}
      >
        {label}
      </Text>
      <View style={[styles.line, { backgroundColor: theme.colors.accent }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 8,
  },
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth * 2,
    opacity: 0.7,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});
