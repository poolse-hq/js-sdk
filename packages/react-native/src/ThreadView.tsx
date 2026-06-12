import type { Message, Uuid } from '@poolse/sdk';
import { useMe, useThread } from '@poolse/react';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { AttachmentPicker } from './AttachmentPicker.js';
import { MessageComposer } from './MessageComposer.js';
import { MessageList } from './MessageList.js';
import { MessageRow } from './MessageRow.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
import { UploadProvider } from './internal/uploadContext.js';
import { useDismissableSheet } from './internal/useDismissableSheet.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

export interface ThreadViewProps {
  visible: boolean;
  onClose: () => void;
  conversationId: Uuid;
  rootMessage: Message;
  labelFor?: (externalId: string) => string;
  avatarFor?: (externalId: string) => string | null;
}

// Sheet covers the bottom 88% of the screen. The remaining 12% is the
// pull-down gutter (also the keyboardVerticalOffset for iOS).
const SHEET_HEIGHT_FRACTION = 0.88;

/**
 * Bottom-sheet modal for thread replies. Pull the drag handle / header
 * down to dismiss; tap the backdrop or close button too. The composer
 * inside the sheet supports attachments (paperclip → picker, shared
 * upload queue) and the reply rows support reactions, swipe-to-reply,
 * long-press actions, edit, delete — same surface as ConversationView.
 *
 * Keyboard handling: inside a Modal the OS doesn't auto-resize the
 * sheet's children, so the composer needs its own KeyboardAvoidingView
 * with `keyboardVerticalOffset` set to the distance between the screen
 * top and the sheet top (the gutter above the sheet).
 */
export function ThreadView({
  visible,
  onClose,
  conversationId,
  rootMessage,
  labelFor,
  avatarFor,
}: ThreadViewProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Each open of the thread gets its own UploadProvider so the
          composer's queue is isolated from the parent ConversationView's
          composer queue. */}
      <UploadProvider>
        <ThreadSheet
          onClose={onClose}
          conversationId={conversationId}
          rootMessage={rootMessage}
          {...(labelFor ? { labelFor } : {})}
          {...(avatarFor ? { avatarFor } : {})}
        />
      </UploadProvider>
    </Modal>
  );
}

function ThreadSheet({
  onClose,
  conversationId,
  rootMessage,
  labelFor,
  avatarFor,
}: {
  onClose: () => void;
  conversationId: Uuid;
  rootMessage: Message;
  labelFor?: (externalId: string) => string;
  avatarFor?: (externalId: string) => string | null;
}) {
  const theme = usePoolseTheme();
  const { me } = useMe();
  const meId = me?.id ?? null;
  const {
    replies,
    sendReply,
    edit,
    delete: deleteReply,
    loadMore,
    hasMore,
  } = useThread(conversationId, rootMessage.id);
  const { height: screenHeight } = useWindowDimensions();
  const sheetHeight = Math.round(screenHeight * SHEET_HEIGHT_FRACTION);
  const gutter = screenHeight - sheetHeight;
  const { translateY, panHandlers } = useDismissableSheet({ onClose, sheetHeight });

  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const renderReply = useCallback(
    (msg: Message): ReactElement => {
      const isSelf = meId !== null && msg.sender_id === meId;
      const canEdit = isSelf && !msg.deleted_at;
      return (
        <MessageRow
          msg={msg}
          meId={meId}
          // Reactions + actions on by default; nested threads off (you
          // can't thread inside a thread in v1).
          reactions
          attachments
          actions
          threads={false}
          // Quote-to-reply doesn't make sense inside a single-root thread.
          quotations={false}
          isEditing={editingId === msg.id}
          {...(canEdit ? { onStartEdit: () => setEditingId(msg.id) } : {})}
          onDelete={() => {
            void deleteReply(msg.id);
          }}
          {...(labelFor ? { labelFor } : {})}
          {...(avatarFor ? { avatarFor } : {})}
        />
      );
    },
    [meId, editingId, deleteReply, labelFor, avatarFor],
  );

  const editingMessage = useMemo(
    () => (editingId ? (replies.find((m) => m.id === editingId) ?? null) : null),
    [editingId, replies],
  );

  const rootRow = useMemo(
    () => (
      <MessageRow
        msg={rootMessage}
        meId={meId}
        reactions
        attachments
        actions={false}
        threads={false}
        quotations={false}
        {...(labelFor ? { labelFor } : {})}
        {...(avatarFor ? { avatarFor } : {})}
      />
    ),
    [rootMessage, meId, labelFor, avatarFor],
  );

  return (
    <View style={styles.modalRoot}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close thread" />

      <Animated.View
        style={[
          styles.sheet,
          {
            height: sheetHeight,
            backgroundColor: theme.colors.paper,
            borderTopLeftRadius: theme.radii.xl,
            borderTopRightRadius: theme.radii.xl,
            transform: [{ translateY }],
          },
          theme.shadows.lg,
        ]}
      >
        {/* Wrap the header + drag pill in the pan handler so users can
            pull from a comfortable 60-pt-tall strip — the bare 16-pt
            pill on its own was nearly invisible to fingers. */}
        <View {...panHandlers}>
          <View style={styles.dragHandle}>
            <View style={[styles.dragPill, { backgroundColor: theme.colors.ink3 }]} />
          </View>

          <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
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
        </View>

        {/* KAV scope: just the scrolling area + composer. Keyboard pushes
            the composer up by the keyboard height minus the gutter
            (since the gutter is already "free" space above the sheet
            top). On Android we use `height` behavior — works inside a
            Modal because the modal window itself responds to adjustResize. */}
        <KeyboardAvoidingView
          style={styles.kavBody}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? gutter : 0}
        >
          <View style={[styles.rootPreview, { backgroundColor: theme.colors.surface2 }]}>
            {rootRow}
          </View>

          <View style={styles.listWrap}>
            <MessageList
              messages={replies}
              hasMore={hasMore}
              onLoadMore={loadMore}
              renderItem={renderReply}
            />
          </View>

          <MessageComposer
            onSend={async (body, opts) => {
              await sendReply({ body, ...opts });
            }}
            placeholder="Reply to thread…"
            attachments
            onAttachPress={() => setPickerOpen(true)}
            editingMessage={editingMessage}
            onCancelEdit={() => setEditingId(null)}
            onSaveEdit={async (body) => {
              if (!editingId) return;
              await edit(editingId, body);
              setEditingId(null);
            }}
          />
        </KeyboardAvoidingView>

        <AttachmentPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} />
      </Animated.View>
    </View>
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
  kavBody: {
    flex: 1,
  },
  listWrap: {
    flex: 1,
  },
});
