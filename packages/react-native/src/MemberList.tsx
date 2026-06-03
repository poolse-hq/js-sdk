import type { MemberRole, Membership, Uuid } from '@poolse/sdk';
import { useMembers, usePresence } from '@poolse/react';
import { type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from './primitives/Avatar.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

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
  const theme = usePoolseTheme();
  const { members, loading, error, removeMember } = useMembers(conversationId);
  const { online: presenceOnline } = usePresence(
    onlineExternalIds === undefined ? conversationId : '',
  );
  const effectiveOnline = onlineExternalIds ?? presenceOnline;

  if (loading && members.length === 0) {
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
          Failed to load members.
        </Text>
        {error.message ? (
          <Text style={[styles.errorDetail, { color: theme.colors.ink3 }]}>{error.message}</Text>
        ) : null}
      </View>
    );
  }

  if (members.length === 0) {
    return (
      <View style={[styles.placeholder, { backgroundColor: theme.colors.paper }]}>
        {typeof emptyState === 'string' || emptyState == null ? (
          <Text style={{ color: theme.colors.ink3, fontFamily: theme.type.fontBody }}>
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
      style={{ backgroundColor: theme.colors.paper }}
      renderItem={({ item }) => {
        if (renderItem) return <>{renderItem(item)}</>;
        const name = labelFor?.(item.external_id) ?? item.external_id;
        const avatarUrl = avatarFor?.(item.external_id) ?? null;
        const isOnline = effectiveOnline.has(item.external_id);
        const showRemove = canRemove?.(item) ?? false;
        return (
          <MemberRow
            name={name}
            externalId={item.external_id}
            avatarUrl={avatarUrl}
            role={item.role}
            online={isOnline}
            {...(showRemove ? { onRemove: () => removeMember(item.external_id) } : {})}
          />
        );
      }}
    />
  );
}

function MemberRow({
  name,
  externalId,
  avatarUrl,
  role,
  online,
  onRemove,
}: {
  name: string;
  externalId: string;
  avatarUrl: string | null;
  role: MemberRole;
  online: boolean;
  onRemove?: () => void;
}) {
  const theme = usePoolseTheme();
  // `name` is already labelFor()'d by the parent (or falls back to
  // externalId when no labelFor was passed). Use it directly — don't
  // round-trip through useDisplayName, which would otherwise force
  // the SDK's userResolver and ignore the labelFor we already have.
  return (
    <View style={styles.row}>
      <Avatar src={avatarUrl} name={name} seed={externalId} online={online} size="md" />
      <View style={styles.body}>
        <Text
          style={[styles.name, { color: theme.colors.ink, fontFamily: theme.type.fontBody }]}
          numberOfLines={1}
        >
          {name}
        </Text>
        <Text style={[styles.role, { color: theme.colors.ink3 }]}>{role}</Text>
      </View>
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={8} style={styles.removeBtn}>
          <PoolseIcon name="close" size={16} color={theme.colors.ink2} />
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
