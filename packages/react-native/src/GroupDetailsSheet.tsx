import type { Uuid } from '@poolse/sdk';
import { useConversation, useMembers } from '@poolse/react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { Avatar } from './primitives/Avatar.js';
import { MemberList } from './MemberList.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
import { useDismissableSheet } from './internal/useDismissableSheet.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

export interface GroupDetailsSheetProps {
  visible: boolean;
  onClose: () => void;
  conversationId: Uuid;
  /** Resolve external_id → display name. Same shape as MemberList. */
  labelFor?: (externalId: string) => string;
  /** Resolve external_id → avatar URL. Same shape as MemberList. */
  avatarFor?: (externalId: string) => string | null;
  /**
   * Predicate for the per-row remove button. Defaults to "never show"
   * — wire it on the parent for owners/admins. Receives the
   * Membership row so you can scope to roles or exclude self.
   */
  canRemoveMember?: (m: { user_id: string; external_id: string; role: string }) => boolean;
}

/**
 * Bottom-sheet (85% of screen) that opens when the user taps the
 * group chat header. Shows group name + member count at the top,
 * then a scrollable roster with avatars, display names (resolved
 * through `labelFor` / `userResolver`), role badges, and live
 * presence dots (driven by `MemberList` internally).
 */
export function GroupDetailsSheet({
  visible,
  onClose,
  conversationId,
  labelFor,
  avatarFor,
  canRemoveMember,
}: GroupDetailsSheetProps) {
  const theme = usePoolseTheme();
  const { conversation } = useConversation(conversationId);
  const { members } = useMembers(conversationId);
  const { height: screenHeight } = useWindowDimensions();
  const { translateY, panHandlers } = useDismissableSheet({
    onClose,
    sheetHeight: screenHeight * 0.85,
  });

  const title = conversation?.name ?? 'Conversation';
  const subtitle = `${members.length} ${members.length === 1 ? 'member' : 'members'}`;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.modalRoot}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityLabel="Close group details"
        />

        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.paper,
              borderTopLeftRadius: theme.radii.xl,
              borderTopRightRadius: theme.radii.xl,
              transform: [{ translateY }],
            },
            theme.shadows.lg,
          ]}
        >
          {/* Pan handlers spread on the drag-pill region so list
              scrolling underneath isn't affected. */}
          <View {...panHandlers} style={styles.dragHandle}>
            <View style={[styles.dragPill, { backgroundColor: theme.colors.ink3 }]} />
          </View>

          <View style={styles.headerRow}>
            <Pressable
              onPress={onClose}
              hitSlop={16}
              style={[styles.closeBtn, { backgroundColor: theme.colors.surface2 }]}
              accessibilityLabel="Close"
            >
              <PoolseIcon name="close" size={18} color={theme.colors.ink} />
            </Pressable>
            <Text
              style={[
                styles.headerTitle,
                { color: theme.colors.ink, fontFamily: theme.type.fontDisplay },
              ]}
            >
              Group details
            </Text>
          </View>

          <View style={styles.summary}>
            <Avatar src={null} name={title} seed={conversationId} size="lg" />
            <Text
              style={[
                styles.title,
                { color: theme.colors.ink, fontFamily: theme.type.fontDisplay },
              ]}
              numberOfLines={1}
            >
              {title}
            </Text>
            <Text style={[styles.subtitle, { color: theme.colors.ink3 }]}>{subtitle}</Text>
          </View>

          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />

          <View style={styles.sectionLabelRow}>
            <Text
              style={[
                styles.sectionLabel,
                { color: theme.colors.ink2, fontFamily: theme.type.fontBody },
              ]}
            >
              Members
            </Text>
          </View>

          <View style={{ flex: 1 }}>
            <MemberList
              conversationId={conversationId}
              {...(labelFor ? { labelFor } : {})}
              {...(avatarFor ? { avatarFor } : {})}
              {...(canRemoveMember ? { canRemove: canRemoveMember } : {})}
              emptyState="No members yet."
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    height: '85%',
    overflow: 'hidden',
  },
  dragHandle: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  dragPill: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 12,
    gap: 10,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  summary: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  sectionLabelRow: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
