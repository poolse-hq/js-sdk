import type { Message, Uuid } from '@poolse/sdk';
import { useMe, useThread } from '@poolse/react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { MessageBubble } from './MessageBubble.js';
import { MessageComposer } from './MessageComposer.js';
import { MessageList } from './MessageList.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

export interface ThreadViewProps {
  visible: boolean;
  onClose: () => void;
  conversationId: Uuid;
  rootMessage: Message;
  labelFor?: (externalId: string) => string;
}

/**
 * Bottom-sheet modal for thread replies. Sits at the bottom 85% of
 * the screen with a translucent backdrop above; tap the backdrop or
 * the close button to dismiss. Drag handle pill at the top is
 * decorative — drag-to-dismiss isn't implemented yet (would need
 * react-native-gesture-handler). Reply composer sits at the bottom
 * of the sheet with its own KeyboardAvoidingView.
 */
export function ThreadView({
  visible,
  onClose,
  conversationId,
  rootMessage,
  labelFor,
}: ThreadViewProps) {
  const theme = usePoolseTheme();
  const { me } = useMe();
  const meId = me?.id ?? null;
  const { replies, sendReply, loadMore, hasMore } = useThread(conversationId, rootMessage.id);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close thread" />

        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.paper,
              borderTopLeftRadius: theme.radii.xl,
              borderTopRightRadius: theme.radii.xl,
            },
            theme.shadows.lg,
          ]}
        >
          <View style={styles.dragHandle}>
            <View style={[styles.dragPill, { backgroundColor: theme.colors.ink3 }]} />
          </View>

          <View
            style={[
              styles.header,
              {
                borderBottomColor: theme.colors.border,
              },
            ]}
          >
            <Pressable
              onPress={onClose}
              hitSlop={16}
              style={[styles.closeBtn, { backgroundColor: theme.colors.surface2 }]}
              accessibilityLabel="Close thread"
            >
              <PoolseIcon name="close" size={18} color={theme.colors.ink} />
            </Pressable>
            <Text
              style={[
                styles.title,
                { color: theme.colors.ink, fontFamily: theme.type.fontDisplay },
              ]}
            >
              Thread
            </Text>
          </View>

          <View style={[styles.rootPreview, { backgroundColor: theme.colors.surface2 }]}>
            <MessageBubble
              message={rootMessage}
              currentUserId={meId}
              {...(labelFor ? { labelFor } : {})}
            />
          </View>

          <View style={{ flex: 1 }}>
            <MessageList
              messages={replies}
              hasMore={hasMore}
              onLoadMore={loadMore}
              renderItem={(msg) => (
                <View key={msg.id} style={{ paddingHorizontal: 8 }}>
                  <MessageBubble
                    message={msg}
                    currentUserId={meId}
                    {...(labelFor ? { labelFor } : {})}
                  />
                </View>
              )}
            />
          </View>

          <MessageComposer
            onSend={async (body, opts) => {
              await sendReply({ body, ...opts });
            }}
            placeholder="Reply to thread…"
          />
        </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
  },
  rootPreview: {
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
});
