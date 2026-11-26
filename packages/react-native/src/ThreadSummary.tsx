import type { Message } from '@poolse/sdk';
import { displayNameOf, useUser } from '@poolse/react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { stackedParticipants, threadSummaryText } from './internal/thread.js';
import { Avatar } from './primitives/Avatar.js';
import { useTheme } from './theme/PoolseTheme.js';

export interface ThreadSummaryProps {
  /** The thread's root: `reply_count`, `last_reply_at`, `thread_participants`. */
  message: Pick<Message, 'reply_count' | 'last_reply_at' | 'thread_participants'>;
  onPress: () => void;
  labelFor?: (externalId: string) => string;
  avatarFor?: (externalId: string) => string | null;
  /** Align to the right (under your own bubble). */
  alignEnd?: boolean;
}

/**
 * "3 replies · last reply 5m ago" with the last few repliers' avatars
 * stacked in front. Tap opens the thread. Draws nothing without replies.
 */
export function ThreadSummary({
  message,
  onPress,
  labelFor,
  avatarFor,
  alignEnd = false,
}: ThreadSummaryProps) {
  const theme = useTheme();
  const count = message.reply_count ?? 0;
  if (count <= 0) return null;
  const label = threadSummaryText(count, message.last_reply_at);
  const people = stackedParticipants(message.thread_participants);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Open thread`}
      hitSlop={4}
      style={({ pressed }) => [
        styles.row,
        {
          alignSelf: alignEnd ? 'flex-end' : 'flex-start',
          borderRadius: theme.radii.pill,
          backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent',
        },
      ]}
    >
      {people.length > 0 ? (
        <View style={styles.stack}>
          {people.map((p, i) => (
            <View
              key={p.key}
              style={[
                styles.stacked,
                {
                  marginLeft: i === 0 ? 0 : -6,
                  borderColor: theme.colors.background,
                  zIndex: 3 - i,
                },
              ]}
            >
              <Participant
                externalId={p.externalId}
                fallback={p.key}
                {...(labelFor ? { labelFor } : {})}
                {...(avatarFor ? { avatarFor } : {})}
              />
            </View>
          ))}
        </View>
      ) : null}
      <Text
        style={[styles.text, { color: theme.colors.link, fontFamily: theme.fonts.body }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Participant({
  externalId,
  fallback,
  labelFor,
  avatarFor,
}: {
  externalId: string | null;
  fallback: string;
  labelFor?: (externalId: string) => string;
  avatarFor?: (externalId: string) => string | null;
}) {
  const resolved = useUser(externalId);
  const name = externalId
    ? displayNameOf(externalId, {
        labelFor,
        profileName: resolved.profile?.displayName,
        fallback: 'Someone',
      })
    : null;
  const src = externalId ? (avatarFor?.(externalId) ?? resolved.profile?.avatarUrl ?? null) : null;
  return <Avatar src={src} name={name} seed={externalId ?? fallback} size="xs" />;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingVertical: 2,
    paddingRight: 6,
  },
  stack: {
    flexDirection: 'row',
  },
  stacked: {
    borderWidth: 1.5,
    borderRadius: 999,
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
});
