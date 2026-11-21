import type { Message } from '@poolse/sdk';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from './theme/PoolseTheme.js';

export interface SendStatusProps {
  message: Message;
  onRetry?: () => void;
  onDiscard?: () => void;
  alignEnd?: boolean;
}

/**
 * Under an unsent message: "Waiting for network…" while it's queued
 * offline (it goes out by itself), or "Not sent" with Retry and Delete
 * when the server refused it.
 */
export function SendStatus({ message, onRetry, onDiscard, alignEnd = true }: SendStatusProps) {
  const theme = useTheme();
  const status = message.local_status;
  if (status !== 'queued' && status !== 'failed') return null;
  const failed = status === 'failed';
  const text = failed
    ? message.local_error
      ? `Not sent: ${message.local_error}`
      : 'Not sent'
    : 'Waiting for network…';
  const button = (label: string, onPress: () => void, danger = false) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label} message`}
      hitSlop={8}
      style={styles.button}
    >
      <Text
        style={[
          styles.buttonText,
          { color: danger ? theme.colors.danger : theme.colors.accentStrong },
          { fontFamily: theme.fonts.body },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
  return (
    <View
      style={[styles.root, { justifyContent: alignEnd ? 'flex-end' : 'flex-start' }]}
      accessibilityLiveRegion="polite"
    >
      <Text
        style={[
          styles.text,
          { color: failed ? theme.colors.danger : theme.colors.textMuted },
          { fontFamily: theme.fonts.body },
        ]}
      >
        {text}
      </Text>
      {onRetry ? button(failed ? 'Retry' : 'Send now', onRetry) : null}
      {failed && onDiscard ? button('Delete', onDiscard, true) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
    marginBottom: 4,
  },
  text: { fontSize: 12, flexShrink: 1 },
  button: { paddingVertical: 2 },
  buttonText: { fontSize: 12, fontWeight: '700' },
});
