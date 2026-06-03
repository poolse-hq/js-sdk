import type { Uuid } from '@poolse/sdk';
import { useConversation, useMe, useMembers, usePresence, useUser } from '@poolse/react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from './primitives/Avatar.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

export interface ChatHeaderProps {
  conversationId: Uuid;
  /**
   * Override the title resolver — useful when you want to derive the
   * direct-chat name from your own user directory instead of going
   * through the SDK's `userResolver`. When omitted, falls back to:
   *   * direct → the other member's display name (via `useUser`)
   *   * group  → `conversation.name`
   */
  labelFor?: (externalId: string) => string;
  /** Optional avatar URL resolver for the other party (direct only). */
  avatarFor?: (externalId: string) => string | null;
  /** Right-side icon button — typically opens a member-list sheet. */
  onMembersPress?: () => void;
  /** Tap on the whole header (title + avatar) — open a profile screen. */
  onPress?: () => void;
}

/**
 * Top-of-chat header bar.
 *   * 1:1 direct  → other user's display name + avatar + presence dot.
 *   * Group       → conversation name + "N members" + group-tile avatar.
 *
 * Sits above `<MessageList>` inside `<ConversationView>` by default;
 * pass `header={false}` to `<ConversationView>` if you mount your own.
 */
export function ChatHeader({
  conversationId,
  labelFor,
  avatarFor,
  onMembersPress,
  onPress,
}: ChatHeaderProps) {
  const theme = usePoolseTheme();
  const { conversation } = useConversation(conversationId);
  const { members } = useMembers(conversationId);
  const { me } = useMe();
  const { online } = usePresence(conversationId);

  const isDirect = conversation?.type === 'direct';
  const otherMember = isDirect ? members.find((m) => m.user_id !== me?.id) : null;
  const otherExtId = otherMember?.external_id ?? null;
  // useUser is safe with null — short-circuits to no-op state. Keeps the
  // hook unconditional regardless of conversation type.
  const otherUser = useUser(otherExtId);

  if (!conversation) {
    return (
      <View
        style={[
          styles.root,
          {
            backgroundColor: theme.colors.surface,
            borderBottomColor: theme.colors.border,
          },
        ]}
      />
    );
  }

  const fallbackName = otherExtId ?? '';
  const directName =
    otherUser.profile?.displayName ??
    (otherExtId ? (labelFor?.(otherExtId) ?? fallbackName) : 'Direct');
  const title = isDirect ? directName : (conversation.name ?? 'Conversation');

  const isOnline = isDirect && otherExtId ? online.has(otherExtId) : false;
  const subtitle = isDirect
    ? isOnline
      ? 'Online'
      : null
    : `${members.length} ${members.length === 1 ? 'member' : 'members'}`;

  const avatarUrl =
    isDirect && otherExtId
      ? (avatarFor?.(otherExtId) ?? otherUser.profile?.avatarUrl ?? null)
      : null;
  const avatarSeed = isDirect ? (otherExtId ?? conversationId) : conversationId;

  const Wrapper: typeof View | typeof Pressable = onPress ? Pressable : View;

  return (
    <Wrapper
      {...(onPress ? { onPress } : {})}
      style={[
        styles.root,
        {
          backgroundColor: theme.colors.surface,
          borderBottomColor: theme.colors.border,
        },
      ]}
    >
      <Avatar src={avatarUrl} name={title} seed={avatarSeed} online={isOnline} size="md" />
      <View style={styles.titleCol}>
        <Text
          style={[styles.title, { color: theme.colors.ink, fontFamily: theme.type.fontDisplay }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: theme.colors.ink3 }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {onMembersPress ? (
        <Pressable
          onPress={onMembersPress}
          hitSlop={12}
          style={styles.actionBtn}
          accessibilityLabel="Show members"
        >
          <PoolseIcon name="users" size={20} color={theme.colors.ink2} />
        </Pressable>
      ) : null}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  titleCol: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '500',
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
