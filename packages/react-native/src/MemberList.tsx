import type { MemberRole, Membership, Uuid } from '@poolse/sdk';
import { useMembers, usePresence, useUser } from '@poolse/react';
import { type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from './primitives/Avatar.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
import { useTheme } from './theme/PoolseTheme.js';

export interface MemberListProps {
  conversationId: Uuid;
  labelFor?: (externalId: string) => string;
  avatarFor?: (externalId: string) => string | null;
  onlineExternalIds?: Set<string>;
  canRemove?: (m: Membership) => boolean;
  renderItem?: (m: Membership) => ReactNode;
  emptyState?: ReactNode | string;
}

export function MemberList({
  conversationId,
  labelFor,
  avatarFor,
  onlineExternalIds,
  canRemove,
  renderItem,
  emptyState,
}: MemberListProps) {
  const theme = useTheme();
  const { members, loading, error, removeMember } = useMembers(conversationId);
  const { online: presenceOnline } = usePresence(
    onlineExternalIds === undefined ? conversationId : '',
  );
  const effectiveOnline = onlineExternalIds ?? presenceOnline;

  if (loading && members.length === 0) {
    return (
      <View style={[styles.placeholder, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.placeholder, { backgroundColor: theme.colors.background }]}>
        <Text style={{ color: theme.colors.danger, fontFamily: theme.fonts.body }}>
          Failed to load members.
        </Text>
        {error.message ? (
          <Text style={[styles.errorDetail, { color: theme.colors.textSubtle }]}>
            {error.message}
          </Text>
        ) : null}
      </View>
    );
  }

  if (members.length === 0) {
    return (
      <View style={[styles.placeholder, { backgroundColor: theme.colors.background }]}>
        {typeof emptyState === 'string' || emptyState == null ? (
          <Text style={{ color: theme.colors.textSubtle, fontFamily: theme.fonts.body }}>
            {(emptyState as string) ?? 'No members.'}
          </Text>
        ) : (
          emptyState
        )}
      </View>
    );
  }

  return (
    <FlatList
      data={members}
      keyExtractor={(m) => m.user_id}
      style={{ backgroundColor: theme.colors.background }}
      renderItem={({ item }) => {
        if (renderItem) return <>{renderItem(item)}</>;
        const isOnline = effectiveOnline.has(item.external_id);
        const showRemove = canRemove?.(item) ?? false;
        return (
          <MemberRow
            externalId={item.external_id}
            role={item.role}
            online={isOnline}
            {...(labelFor ? { labelFor } : {})}
            {...(avatarFor ? { avatarFor } : {})}
            {...(showRemove ? { onRemove: () => removeMember(item.external_id) } : {})}
          />
        );
      }}
    />
  );
}

function MemberRow({
  externalId,
  role,
  online,
  labelFor,
  avatarFor,
  onRemove,
}: {
  externalId: string;
  role: MemberRole;
  online: boolean;
  labelFor?: (externalId: string) => string;
  avatarFor?: (externalId: string) => string | null;
  onRemove?: () => void;
}) {
  const theme = useTheme();
  // Priority: explicit prop > SDK userResolver > externalId fallback.
  // The previous version used `labelFor?.(id) ?? id` and skipped the
  // resolver entirely when labelFor wasn't passed, defeating the
  // PoolseConfig.userResolver contract for consumers who configured
  // one and expected names + avatars to flow through automatically.
  const resolved = useUser(externalId);
  const name = labelFor?.(externalId) ?? resolved.profile?.displayName ?? externalId;
  const avatarUrl = avatarFor?.(externalId) ?? resolved.profile?.avatarUrl ?? null;
  return (
    <View style={styles.row}>
      <Avatar src={avatarUrl} name={name} seed={externalId} online={online} size="md" />
      <View style={styles.body}>
        <Text
          style={[styles.name, { color: theme.colors.text, fontFamily: theme.fonts.body }]}
          numberOfLines={1}
        >
          {name}
        </Text>
        <Text style={[styles.role, { color: theme.colors.textSubtle }]}>{role}</Text>
      </View>
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={8} style={styles.removeBtn}>
          <PoolseIcon name="close" size={16} color={theme.colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorDetail: {
    marginTop: 6,
    fontSize: 11,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  body: {
    flex: 1,
    gap: 1,
  },
  name: {
    fontSize: 14,
    fontWeight: '500',
  },
  role: {
    fontSize: 11,
    textTransform: 'capitalize',
  },
  removeBtn: {
    padding: 6,
  },
});
