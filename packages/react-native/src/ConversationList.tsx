import type { Conversation, Uuid } from '@poolse/sdk';
import { useConversations } from '@poolse/react';
import { type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from './primitives/Avatar.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

export interface ConversationListProps {
  selectedId?: string | null;
  onSelect?: (conv: Conversation) => void;
  /** Optional override for each row's rendering. */
  renderItem?: (conv: Conversation, selected: boolean) => ReactNode;
  /** Custom empty state when there are no conversations. */
  emptyState?: ReactNode | string;
  /** Controlled-mode: skip `useConversations()` and render from these. */
  conversations?: Conversation[];
  loading?: boolean;
  error?: Error | null;
  /** Per-conversation unread counts rendered as a Pulse Coral pill. */
  unreadCounts?: Record<Uuid, number>;
}

export function ConversationList({
  selectedId,
  onSelect,
  renderItem,
  emptyState,
  conversations: controlled,
  loading: controlledLoading,
  error: controlledError,
  unreadCounts,
}: ConversationListProps) {
  const theme = usePoolseTheme();
  const auto = useConversations();
  const isControlled = controlled !== undefined;
  const conversations = isControlled ? controlled : auto.conversations;
  const loading = isControlled ? (controlledLoading ?? false) : auto.loading;
  const error = isControlled ? (controlledError ?? null) : auto.error;
  const counts = unreadCounts ?? (isControlled ? undefined : auto.unreadCounts);

  if (loading && conversations.length === 0) {
    return (
      <View style={[styles.placeholder, { backgroundColor: theme.colors.paper }]}>
        <ActivityIndicator color={theme.colors.brand} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.placeholder, { backgroundColor: theme.colors.paper }]}>
        <Text style={{ color: theme.colors.error, fontFamily: theme.type.fontBody }}>
          Failed to load conversations.
        </Text>
      </View>
    );
  }

  if (conversations.length === 0) {
    return (
      <View style={[styles.placeholder, { backgroundColor: theme.colors.paper }]}>
        {typeof emptyState === 'string' || emptyState == null ? (
          <Text style={{ color: theme.colors.ink3, fontFamily: theme.type.fontBody }}>
            {(emptyState as string) ?? 'No conversations yet.'}
          </Text>
        ) : (
          emptyState
        )}
      </View>
    );
  }

  return (
    <FlatList
      data={conversations}
      keyExtractor={(c) => c.id}
      style={{ backgroundColor: theme.colors.paper }}
      renderItem={({ item }) => {
        const selected = selectedId === item.id;
        if (renderItem) {
          return <>{renderItem(item, selected)}</>;
        }
        const unread = counts?.[item.id] ?? 0;
        return (
          <Pressable
            onPress={() => onSelect?.(item)}
            style={[
              styles.row,
              {
                backgroundColor: selected ? theme.colors.surface2 : 'transparent',
              },
            ]}
          >
            <Avatar src={null} name={item.name ?? null} seed={item.id} size="md" />
            <View style={styles.body}>
              <Text
                style={[styles.name, { color: theme.colors.ink, fontFamily: theme.type.fontBody }]}
                numberOfLines={1}
              >
                {item.name ?? 'Untitled conversation'}
              </Text>
              {item.last_message_at ? (
                <Text style={[styles.preview, { color: theme.colors.ink3 }]} numberOfLines={1}>
                  {formatRelative(item.last_message_at)}
                </Text>
              ) : null}
            </View>
            {unread > 0 ? (
              <View style={[styles.unreadPill, { backgroundColor: theme.colors.unreadPill }]}>
                <Text style={[styles.unreadText, { color: theme.colors.unreadPillText }]}>
                  {unread > 99 ? '99+' : String(unread)}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      }}
    />
  );
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h`;
    return `${Math.floor(diff / 86_400_000)}d`;
  } catch {
    return '';
  }
}

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
  },
  preview: {
    fontSize: 12,
  },
  unreadPill: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
