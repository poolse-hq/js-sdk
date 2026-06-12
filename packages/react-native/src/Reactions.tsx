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
                borderWidth: meReacted ? 1.5 : 1,
                transform: meReacted ? [{ scale: 1.04 }] : undefined,
              },
            ]}
          >
            <Text style={styles.emoji}>{emoji}</Text>
            <Text
              style={[
                styles.count,
                {
                  color: meReacted ? theme.colors.brand : theme.colors.ink2,
                  fontWeight: meReacted ? '700' : '600',
                },
              ]}
            >
              {userArr.length}
            </Text>
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
    marginTop: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 14,
    gap: 5,
    minHeight: 26,
    // Subtle elevation so chips lift off the surface
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  emoji: {
    fontSize: 15,
    lineHeight: 18,
  },
  count: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  sheet: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 4,
    alignItems: 'center',
  },
  emojiBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigEmoji: {
    fontSize: 32,
    lineHeight: 38,
  },
});
