import type { Uuid } from '@poolse/sdk';
import { useReactions } from '@poolse/react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { usePoolseTheme } from './theme/PoolseTheme.js';

const DEFAULT_EMOJIS = ['👍', '❤️', '😂', '🎉', '🙏', '🔥'];

export interface ReactionStripProps {
  messageId: Uuid;
  conversationId: Uuid;
  meId: string | null;
  /** Seed map from a known message (e.g. `useMessages`). */
  initialReactions?: Record<string, Uuid[]>;
}

export function ReactionStrip({
  messageId,
  conversationId,
  meId,
  initialReactions,
}: ReactionStripProps) {
  const theme = usePoolseTheme();
  const { reactions, addReaction, removeReaction } = useReactions(messageId, {
    conversationId,
    currentUserId: meId,
    ...(initialReactions ? { initialReactions } : {}),
  });
  const entries = Object.entries(reactions);
  if (entries.length === 0) return null;

  return (
    <View style={styles.strip}>
      {entries.map(([emoji, userIds]) => {
        const userArr = Array.isArray(userIds) ? userIds : [];
        const meReacted = meId !== null && userArr.includes(meId);
        return (
          <Pressable
            key={emoji}
            onPress={() => (meReacted ? removeReaction(emoji) : addReaction(emoji))}
            style={[
              styles.chip,
              {
                backgroundColor: meReacted ? theme.colors.brandSoft : theme.colors.surface2,
                borderColor: meReacted ? theme.colors.brand : theme.colors.border,
              },
            ]}
          >
            <Text style={styles.emoji}>{emoji}</Text>
            <Text style={[styles.count, { color: theme.colors.ink2 }]}>{userArr.length}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface ReactionPickerProps {
  visible: boolean;
  onClose: () => void;
  onPick: (emoji: string) => void;
  /** Override the default 6-emoji set. */
  emojis?: string[];
}

export function ReactionPicker({
  visible,
  onClose,
  onPick,
  emojis = DEFAULT_EMOJIS,
}: ReactionPickerProps) {
  const theme = usePoolseTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.lg,
            },
            theme.shadows.lg,
          ]}
        >
          {emojis.map((emoji) => (
            <Pressable
              key={emoji}
              style={styles.emojiBtn}
              onPress={() => {
                onPick(emoji);
                onClose();
              }}
            >
              <Text style={styles.bigEmoji}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  emoji: {
    fontSize: 14,
  },
  count: {
    fontSize: 11,
    fontWeight: '600',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheet: {
    flexDirection: 'row',
    padding: 8,
    gap: 4,
  },
  emojiBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  bigEmoji: {
    fontSize: 28,
  },
});
