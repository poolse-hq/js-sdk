import type { Conversation, Uuid } from '@poolse/sdk';
import {
  filterConversations,
  formatCallLogPreview,
  formatRecordingNoticePreview,
  useConversations,
  useMe,
  useUser,
  useUserPresence,
} from '@poolse/react';
import { useCallback, useMemo, type ReactElement, type ReactNode } from 'react';
import { EmptyState } from './EmptyState.js';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  buildConversationSections,
  type ConversationGroupBy,
  type ConversationSection,
} from './internal/conversationSections.js';
import { relativeTime } from './internal/time.js';
import type { ChatDensity } from './layout.js';
import { Avatar } from './primitives/Avatar.js';
import { useTheme } from './theme/PoolseTheme.js';

export type { ConversationGroupBy, ConversationSection };

export interface ConversationListProps {
  selectedId?: string | null;
  onSelect?: (conv: Conversation) => void;
  /** Optional override for each row's rendering. */
  renderItem?: (conv: Conversation, selected: boolean) => ReactNode;
  /**
   * What an empty list shows. Defaults to "No conversations yet" with a
   * hint at the next step.
   */
  emptyState?: ReactNode | string;
  /** Show only conversations matching this text (a search field in `header`). */
  query?: string;
  /** What shows when `query` matches nothing. Receives the query. */
  noResultsState?: ReactNode | ((query: string) => ReactNode);
  /** Controlled-mode: skip `useConversations()` and render from these. */
  conversations?: Conversation[];
  loading?: boolean;
  error?: Error | null;
  /**
   * Controlled mode paging: more conversations exist. Uncontrolled, the
   * list pages through `useConversations()` itself.
   */
  hasMore?: boolean;
  /** Controlled mode paging: a page is loading (a spinner shows at the end). */
  loadingMore?: boolean;
  /** Controlled mode paging: called near the end of the list while `hasMore`. */
  onLoadMore?: () => void;
  /** Per-conversation unread counts rendered as a Pulse Coral pill. */
  unreadCounts?: Record<Uuid, number>;
  /**
   * Explicit overrides for direct-chat names + avatars, keyed by the
   * OTHER member's external_id. When omitted, the row falls back to
   * `PoolseConfig.userResolver` and finally to the external_id.
   */
  labelFor?: (externalId: string) => string;
  avatarFor?: (externalId: string) => string | null;
  /** Scrolls with the list, above the first row (a search field, a title). */
  header?: ReactElement | null;
  /**
   * Split the list into titled sections; each conversation goes to the
   * first section whose `filter` takes it, empty sections are hidden.
   * Overrides `groupBy`.
   */
  sections?: ConversationSection[];
  /** `'type'` → "Channels" (groups), then "Direct messages". */
  groupBy?: ConversationGroupBy;
  /** `'comfortable'` (default) or `'compact'` rows (smaller avatar, one line). */
  density?: ChatDensity;
  /** Presence badges on direct chats' avatars. Defaults to `true`. */
  showPresence?: boolean;
}

export function ConversationList({
  selectedId,
  onSelect,
  renderItem,
  emptyState,
  query = '',
  noResultsState,
  conversations: controlled,
  loading: controlledLoading,
  error: controlledError,
  hasMore: controlledHasMore,
  loadingMore: controlledLoadingMore,
  onLoadMore,
  unreadCounts,
  labelFor,
  avatarFor,
  header = null,
  sections,
  groupBy,
  density = 'comfortable',
  showPresence = true,
}: ConversationListProps) {
  const theme = useTheme();
  const auto = useConversations();
  const { me } = useMe();
  const meExternalId = me?.external_id ?? null;
  const meId = me?.id ?? null;
  const isControlled = controlled !== undefined;
  const allConversations = isControlled ? controlled : auto.conversations;
  const needle = query.trim();
  const conversations = useMemo(
    () =>
      needle
        ? filterConversations(allConversations, needle, {
            meExternalId,
            ...(labelFor ? { labelFor } : {}),
          })
        : allConversations,
    [allConversations, needle, meExternalId, labelFor],
  );
  const loading = isControlled ? (controlledLoading ?? false) : auto.loading;
  const error = isControlled ? (controlledError ?? null) : auto.error;
  const counts = unreadCounts ?? (isControlled ? undefined : auto.unreadCounts);
  const hasMore = isControlled ? (controlledHasMore ?? false) : auto.hasMore;
  const loadingMore = isControlled ? (controlledLoadingMore ?? false) : auto.loadingMore;
  const autoLoadMore = auto.loadMore;
  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    if (isControlled) onLoadMore?.();
    // A failed page keeps its cursor; the next scroll retries.
    else void autoLoadMore().catch(() => undefined);
  }, [hasMore, loadingMore, isControlled, onLoadMore, autoLoadMore]);

  const built = useMemo(
    () => buildConversationSections(conversations, sections, groupBy),
    [conversations, sections, groupBy],
  );

  const renderRow = useCallback(
    (item: Conversation) => {
      const selected = selectedId === item.id;
      if (renderItem) return <>{renderItem(item, selected)}</>;
      return (
        <ConversationRow
          conv={item}
          selected={selected}
          meExternalId={meExternalId}
          meId={meId}
          unread={counts?.[item.id] ?? 0}
          density={density}
          showPresence={showPresence}
          {...(labelFor ? { labelFor } : {})}
          {...(avatarFor ? { avatarFor } : {})}
          {...(onSelect ? { onSelect } : {})}
        />
      );
    },
    [
      selectedId,
      renderItem,
      meExternalId,
      meId,
      counts,
      density,
      showPresence,
      labelFor,
      avatarFor,
      onSelect,
    ],
  );

  const placeholder = (node: ReactNode) => (
    <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
      {header}
      <View style={styles.placeholder}>{node}</View>
    </View>
  );

  if (loading && conversations.length === 0) {
    return placeholder(<ActivityIndicator color={theme.colors.accent} />);
  }

  if (error && conversations.length === 0) {
    return placeholder(
      <Text style={{ color: theme.colors.danger, fontFamily: theme.fonts.body }}>
        Failed to load conversations.
      </Text>,
    );
  }

  if (conversations.length === 0 && needle && allConversations.length > 0) {
    return placeholder(
      typeof noResultsState === 'function' ? (
        noResultsState(needle)
      ) : noResultsState !== undefined ? (
        noResultsState
      ) : (
        <EmptyState
          title={`Nothing matches “${needle}”`}
          hint="Check the spelling, or search by a person's or channel's name."
        />
      ),
    );
  }

  if (conversations.length === 0) {
    return placeholder(
      emptyState == null ? (
        <EmptyState
          title="No conversations yet"
          hint="Start a chat with someone, or join a channel — it shows up here."
        />
      ) : typeof emptyState === 'string' ? (
        <Text style={{ color: theme.colors.textSubtle, fontFamily: theme.fonts.body }}>
          {emptyState}
        </Text>
      ) : (
        emptyState
      ),
    );
  }

  const footer = loadingMore ? (
    <ActivityIndicator color={theme.colors.textSubtle} style={styles.footerSpinner} />
  ) : null;
  const common = {
    style: { backgroundColor: theme.colors.background },
    onEndReached: hasMore ? loadMore : undefined,
    onEndReachedThreshold: 0.5,
    ListHeaderComponent: header,
    ListFooterComponent: footer,
  };

  if (built) {
    return (
      <SectionList
        {...common}
        sections={built}
        keyExtractor={(c) => c.id}
        stickySectionHeadersEnabled={false}
        renderItem={({ item }) => renderRow(item)}
        renderSectionHeader={({ section }) => (
          <Text
            style={[
              styles.sectionTitle,
              density === 'compact' ? styles.sectionTitleDense : null,
              { color: theme.colors.textMuted, fontFamily: theme.fonts.body },
            ]}
            accessibilityRole="header"
          >
            {section.title}
          </Text>
        )}
      />
    );
  }

  return (
    <FlatList
      {...common}
      data={conversations}
      keyExtractor={(c) => c.id}
      renderItem={({ item }) => renderRow(item)}
    />
  );
}

function ConversationRow({
  conv,
  selected,
  meExternalId,
  meId = null,
  unread,
  density,
  showPresence,
  labelFor,
  avatarFor,
  onSelect,
}: {
  conv: Conversation;
  selected: boolean;
  meExternalId: string | null;
  meId?: string | null;
  unread: number;
  density: ChatDensity;
  showPresence: boolean;
  labelFor?: (externalId: string) => string;
  avatarFor?: (externalId: string) => string | null;
  onSelect?: (conv: Conversation) => void;
}) {
  const theme = useTheme();
  const dense = density === 'compact';

  // For direct conversations the row title + avatar come from the OTHER
  // member, NOT the conversation itself (which has `name: null` for
  // directs). Find the counterparty's external_id and resolve via the
  // standard priority: explicit prop > userResolver > external_id.
  const isDirect = conv.type === 'direct';
  const otherExtId =
    isDirect && meExternalId
      ? ((conv.member_external_ids ?? []).find((x) => x !== meExternalId) ?? null)
      : null;
  const resolvedOther = useUser(isDirect ? otherExtId : null);
  const presence = useUserPresence(showPresence && isDirect ? otherExtId : null);

  const title = isDirect
    ? otherExtId
      ? (labelFor?.(otherExtId) ?? resolvedOther.profile?.displayName ?? otherExtId)
      : 'Direct chat'
    : (conv.name ?? 'Untitled conversation');
  const avatarUrl =
    isDirect && otherExtId
      ? (avatarFor?.(otherExtId) ?? resolvedOther.profile?.avatarUrl ?? null)
      : (conv.avatar_url ?? null);
  const avatarSeed = isDirect ? (otherExtId ?? conv.id) : conv.id;
  const preview = conv.last_message_preview
    ? (formatCallLogPreview(conv.last_message_preview, meId) ??
      formatRecordingNoticePreview(conv.last_message_preview, meId) ??
      conv.last_message_preview)
    : null;
  const when = relativeTime(conv.last_message_at, Date.now(), 'short');
  const bold = unread > 0;

  return (
    <Pressable
      onPress={() => onSelect?.(conv)}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={unread > 0 ? `${title}, ${unread} unread` : title}
      style={({ pressed }) => [
        styles.row,
        {
          paddingHorizontal: theme.spacing.md,
          paddingVertical: dense ? theme.spacing.xs + 2 : theme.spacing.sm + 2,
          gap: dense ? theme.spacing.sm : theme.spacing.sm + 2,
          backgroundColor: selected
            ? theme.colors.accentSoft
            : pressed
              ? theme.colors.surfaceAlt
              : 'transparent',
        },
      ]}
    >
      <Avatar
        src={avatarUrl}
        name={title}
        seed={avatarSeed}
        size={dense ? 'sm' : 'md'}
        {...(presence ? { presence: presence.state, doNotDisturb: !!presence.do_not_disturb } : {})}
      />
      <View style={styles.body}>
        <View style={styles.titleLine}>
          <Text
            style={[
              styles.name,
              dense ? styles.nameDense : null,
              {
                color: theme.colors.text,
                fontFamily: theme.fonts.body,
                fontWeight: bold ? '700' : '600',
              },
            ]}
            numberOfLines={1}
          >
            {title}
          </Text>
          {when ? (
            <Text
              style={[
                styles.time,
                { color: bold ? theme.colors.accentStrong : theme.colors.textSubtle },
              ]}
            >
              {when}
            </Text>
          ) : null}
        </View>
        {!dense && preview ? (
          <Text
            style={[
              styles.preview,
              { color: bold ? theme.colors.textMuted : theme.colors.textSubtle },
            ]}
            numberOfLines={1}
          >
            {preview}
          </Text>
        ) : null}
      </View>
      {unread > 0 ? (
        <View style={[styles.unreadPill, { backgroundColor: theme.colors.badge }]}>
          <Text style={[styles.unreadText, { color: theme.colors.badgeText }]}>
            {unread > 99 ? '99+' : String(unread)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  name: {
    flex: 1,
    fontSize: 15,
  },
  nameDense: {
    fontSize: 14,
  },
  time: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  preview: {
    fontSize: 13,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  sectionTitleDense: {
    paddingTop: 10,
    paddingBottom: 4,
  },
  footerSpinner: {
    marginVertical: 12,
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
