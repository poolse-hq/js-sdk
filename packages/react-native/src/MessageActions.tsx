import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { PoolseIcon, type IconName } from './primitives/PoolseIcon.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

export interface MessageActionsProps {
  visible: boolean;
  onClose: () => void;
  isSelf: boolean;
  onReply?: () => void;
  onReplyInThread?: () => void;
  onQuote?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onCopy?: () => void;
  onReact?: () => void;
}

/**
 * Long-press action menu — rendered as a modal bottom sheet (RN's
 * native equivalent of the web hover popover).
 */
export function MessageActions({
  visible,
  onClose,
  isSelf,
  onReply,
  onReplyInThread,
  onQuote,
  onEdit,
  onDelete,
  onCopy,
  onReact,
}: MessageActionsProps) {
  const theme = usePoolseTheme();
  const items: Array<{ label: string; icon: IconName; onPress: () => void; danger?: boolean }> = [];
  if (onReact) items.push({ label: 'React', icon: 'emoji', onPress: onReact });
  if (onReply) items.push({ label: 'Reply', icon: 'reply', onPress: onReply });
  if (onQuote) items.push({ label: 'Quote reply', icon: 'reply', onPress: onQuote });
  if (onReplyInThread)
    items.push({ label: 'Reply in thread', icon: 'messages', onPress: onReplyInThread });
  if (onCopy) items.push({ label: 'Copy text', icon: 'copy', onPress: onCopy });
  if (isSelf && onEdit) items.push({ label: 'Edit', icon: 'edit', onPress: onEdit });
  if (isSelf && onDelete)
    items.push({ label: 'Delete', icon: 'trash', onPress: onDelete, danger: true });

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
    paddingVertical: 8,
    paddingBottom: 24,
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
