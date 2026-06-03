import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { PoolseIcon, type IconName } from './primitives/PoolseIcon.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

const DEFAULT_REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '🙏', '🔥'];

export interface MessageActionsProps {
  visible: boolean;
  onClose: () => void;
  isSelf: boolean;
  /**
   * Quick-reaction emoji row rendered at the top of the sheet. Tap
   * one to fire `onPickReaction(emoji)` and immediately close. When
   * omitted (or `onPickReaction` is omitted) the row is hidden.
   */
  emojis?: string[];
  onPickReaction?: (emoji: string) => void;
  onReply?: () => void;
  onReplyInThread?: () => void;
  onQuote?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onCopy?: () => void;
}

/**
 * Long-press action menu — modal bottom sheet. Renders a row of
 * quick-react emojis at the top (one tap reacts + closes) plus the
 * action items below. Matches WhatsApp / iMessage's "long-press
 * shows everything inline" pattern.
 */
export function MessageActions({
  visible,
  onClose,
  isSelf,
  emojis = DEFAULT_REACTION_EMOJIS,
  onPickReaction,
  onReply,
  onReplyInThread,
  onQuote,
  onEdit,
  onDelete,
  onCopy,
}: MessageActionsProps) {
  const theme = usePoolseTheme();
  const items: Array<{ label: string; icon: IconName; onPress: () => void; danger?: boolean }> = [];
  if (onReply) items.push({ label: 'Reply', icon: 'reply', onPress: onReply });
  if (onQuote) items.push({ label: 'Quote reply', icon: 'reply', onPress: onQuote });
  if (onReplyInThread)
    items.push({ label: 'Reply in thread', icon: 'messages', onPress: onReplyInThread });
  if (onCopy) items.push({ label: 'Copy text', icon: 'copy', onPress: onCopy });
  if (isSelf && onEdit) items.push({ label: 'Edit', icon: 'edit', onPress: onEdit });
  if (isSelf && onDelete)
    items.push({ label: 'Delete', icon: 'trash', onPress: onDelete, danger: true });

  const showEmojiRow = !!onPickReaction && emojis.length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radii.lg,
              borderTopRightRadius: theme.radii.lg,
            },
            theme.shadows.lg,
          ]}
        >
          {showEmojiRow ? (
            <View style={[styles.emojiRow, { borderBottomColor: theme.colors.border }]}>
              {emojis.map((emoji) => (
                <Pressable
                  key={emoji}
                  onPress={() => {
                    onPickReaction(emoji);
                    onClose();
                  }}
                  style={styles.emojiBtn}
                  hitSlop={6}
                  accessibilityLabel={`React with ${emoji}`}
                >
                  <Text style={styles.emoji}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {items.map((item) => (
            <Pressable key={item.label} onPress={item.onPress} style={styles.item}>
              <PoolseIcon
                name={item.icon}
                size={18}
                color={item.danger ? theme.colors.error : theme.colors.ink2}
              />
              <Text
                style={[
                  styles.itemText,
                  {
                    color: item.danger ? theme.colors.error : theme.colors.ink,
                    fontFamily: theme.type.fontBody,
                  },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    paddingTop: 8,
    paddingBottom: 24,
  },
  emojiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 6,
  },
  emojiBtn: {
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 30,
    lineHeight: 36,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 14,
  },
  itemText: {
    fontSize: 15,
    fontWeight: '500',
  },
});
