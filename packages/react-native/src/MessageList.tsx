import type { Message } from '@poolse/sdk';
import {
  ActivityIndicator,
  FlatList,
  type ListRenderItem,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useCallback, type ReactElement } from 'react';

import { usePoolseTheme } from './theme/PoolseTheme.js';

export interface MessageListProps {
  messages: Message[];
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  renderItem: (msg: Message, index: number) => ReactElement;
  /** Slot rendered above the latest message (typically the typing indicator). */
  ListHeader?: ReactElement | null;
  /** Slot rendered below the oldest message (rare — typically nothing). */
  ListFooter?: ReactElement | null;
  /** Custom empty state when there are no messages. */
  emptyState?: ReactElement | string;
}

/**
 * Inverted FlatList wrapper for chat history. Newest message at the
 * bottom (visually), oldest at the top. Calls `onLoadMore` when the
 * user scrolls near the top edge and `hasMore` is true.
 *
 * Pagination is owned by `useMessages` (hand it `messages` +
 * `hasMore` + `loadMore`); this component just renders + scrolls.
 */
export function MessageList({
  messages,
  loading = false,
  hasMore = false,
  onLoadMore,
  renderItem,
  ListHeader = null,
  ListFooter = null,
  emptyState,
}: MessageListProps) {
  const theme = usePoolseTheme();

  // FlatList is inverted, so the newest item is index 0 (rendered at
  // the bottom visually). React's `messages` is newest-last per the
  // SDK convention; we reverse for FlatList.
  const data = [...messages].reverse();

  const handleRender: ListRenderItem<Message> = useCallback(
    ({ item, index }) => renderItem(item, messages.length - 1 - index),
    [renderItem, messages.length],
  );

  if (loading && messages.length === 0) {
    return (
      <View style={[styles.placeholder, { backgroundColor: theme.colors.paper }]}>
        <ActivityIndicator color={theme.colors.brand} />
      </View>
    );
  }

  if (messages.length === 0) {
    return (
      <View style={[styles.placeholder, { backgroundColor: theme.colors.paper }]}>
        {typeof emptyState === 'string' ? (
          <Text style={{ color: theme.colors.ink3, fontFamily: theme.type.fontBody }}>
            {emptyState}
          </Text>
        ) : (
          (emptyState ?? null)
        )}
      </View>
    );
  }

  return (
    <FlatList
      inverted
      data={data}
      keyExtractor={(item) => item.id}
      renderItem={handleRender}
      onEndReached={hasMore ? onLoadMore : undefined}
      onEndReachedThreshold={0.3}
      // `inverted` flips the list, so FlatList's ListHeaderComponent
      // renders at the bottom of the screen (above the latest message,
      // next to the composer) and ListFooterComponent renders at the
      // top (above the oldest message). That matches our prop names.
      ListHeaderComponent={ListHeader}
      ListFooterComponent={
        <View>
          {hasMore && loading ? (
            <ActivityIndicator color={theme.colors.ink3} style={{ marginVertical: 8 }} />
          ) : null}
          {ListFooter}
        </View>
      }
      style={{ backgroundColor: theme.colors.paper }}
      contentContainerStyle={{ paddingVertical: 8 }}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});
