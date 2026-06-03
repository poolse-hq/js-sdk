import type { Message, Uuid } from '@poolse/sdk';
import { useMe, useThread } from '@poolse/react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { MessageBubble } from './MessageBubble.js';
import { MessageComposer } from './MessageComposer.js';
import { MessageList } from './MessageList.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
import { useSafeInsets } from './lifecycle/safeArea.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

export interface ThreadViewProps {
  visible: boolean;
  onClose: () => void;
  conversationId: Uuid;
  rootMessage: Message;
  labelFor?: (externalId: string) => string;
}

/**
 * Modal screen for thread replies. Mirrors the web `<ThreadView>` —
 * root message preview at the top, oldest-first reply list, composer
 * at the bottom.
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
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: theme.colors.paper }]}>
        <View
          style={[
            styles.header,
            {
              borderBottomColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
            },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
            <PoolseIcon name="close" size={18} color={theme.colors.ink} />
          </Pressable>
          <Text
            style={[styles.title, { color: theme.colors.ink, fontFamily: theme.type.fontDisplay }]}
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
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
    // paddingTop set inline so it can compose with the safe-area inset.
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
