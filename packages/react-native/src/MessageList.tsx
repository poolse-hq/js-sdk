import type { Message } from '@poolse/sdk';
import {
  ActivityIndicator,
  FlatList,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import { PoolseIcon } from './primitives/PoolseIcon.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

/**
 * Either a real message or a day-separator row. ConversationView
 * builds the list of items (interleaving separators where the day
 * changes) and hands it to MessageList; MessageList just renders.
 */
export type MessageListItem =
  | { kind: 'msg'; msg: Message }
  | { kind: 'separator'; id: string; node: ReactElement };

export interface MessageListProps {
  messages: Message[];
  /**
   * Optional pre-built item list (with day separators interleaved).
   * When omitted, a list with `{ kind: 'msg' }` items is derived
   * from `messages` and rendered without separators.
   */
  items?: MessageListItem[];
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
  /**
   * The current user's id. When provided, MessageList will show a
   * "↓ N new messages" jump button at the bottom of the chat
   * whenever new messages from OTHER users arrive while the user is
   * scrolled away from the bottom. Tapping scrolls to the latest.
   */
  meId?: string | null;
}

// How far above the bottom (in pixels — the list is inverted, so
// this is contentOffset.y) before we consider the user "scrolled
// up" and start counting new messages.
const AT_BOTTOM_THRESHOLD = 32;

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
  items,
  loading = false,
  hasMore = false,
  onLoadMore,
  renderItem,
  ListHeader = null,
  ListFooter = null,
  emptyState,
  meId = null,
}: MessageListProps) {
  const theme = usePoolseTheme();
  const flatListRef = useRef<FlatList<MessageListItem>>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const lastTailIdRef = useRef<string | null>(null);

  // Build the FlatList data — either the caller's prebuilt items
  // (with separators) or a plain msg-only list. FlatList is
  // inverted, so we reverse to put the newest item at the top of
  // `data` (which renders at the visual bottom).
  const sourceItems: MessageListItem[] =
    items ?? messages.map((msg) => ({ kind: 'msg' as const, msg }));
  const data = [...sourceItems].reverse();

  // Track tail-message changes to maintain the "new messages" badge
  // when the user is scrolled up.
  useEffect(() => {
    const tail = messages[messages.length - 1];
    if (!tail) return;
    const tailId = tail.id;
    if (tailId === lastTailIdRef.current) return;
    const isFirstSet = lastTailIdRef.current === null;
    lastTailIdRef.current = tailId;
    if (atBottom || isFirstSet) {
      setNewCount(0);
      return;
    }
    // Only count incoming messages from other users — self messages
    // would have already triggered a scroll-to-bottom in normal flow.
    if (meId !== null && tail.sender_id === meId) return;
    setNewCount((n) => n + 1);
  }, [messages, atBottom, meId]);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const next = y <= AT_BOTTOM_THRESHOLD;
    setAtBottom((prev) => (prev === next ? prev : next));
    if (next) setNewCount(0);
  }, []);

  const scrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    setNewCount(0);
  }, []);

  const handleRender: ListRenderItem<MessageListItem> = useCallback(
    ({ item, index }) => {
      if (item.kind === 'separator') return item.node;
      // Index in the original (newest-last) source order. Used by
      // ConversationView's renderItem to pick neighbours for
      // grouping when it doesn't pre-compute groupPosition itself.
      const sourceIndex = data.length - 1 - index;
      return renderItem(item.msg, sourceIndex);
    },
    [renderItem, data.length],
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
    <View style={styles.root}>
      <FlatList
        ref={flatListRef}
        inverted
        data={data}
        keyExtractor={(item) => (item.kind === 'msg' ? item.msg.id : item.id)}
        renderItem={handleRender}
        onEndReached={hasMore ? onLoadMore : undefined}
        onEndReachedThreshold={0.3}
        onScroll={handleScroll}
        scrollEventThrottle={32}
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

      {!atBottom && newCount > 0 ? (
        <Pressable
          onPress={scrollToBottom}
          style={[
            styles.jumpButton,
            {
              backgroundColor: theme.colors.brand,
            },
            theme.shadows.sm,
          ]}
          accessibilityLabel={`${newCount} new ${newCount === 1 ? 'message' : 'messages'}, jump to latest`}
        >
          <PoolseIcon name="chevron-down" size={14} color={theme.colors.onBrand} />
          <Text style={[styles.jumpText, { color: theme.colors.onBrand }]}>
            {newCount} new {newCount === 1 ? 'message' : 'messages'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  jumpButton: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  jumpText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
