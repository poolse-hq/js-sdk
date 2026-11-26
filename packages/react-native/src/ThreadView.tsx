import type { Message, MessageCreateRequest, Uuid } from '@poolse/sdk';
import { useMe, usePoolse, useThread, useThreadFollow } from '@poolse/react';
import { useCallback, useMemo, useState, type ReactElement, type ReactNode, type Ref } from 'react';
import { EmptyState } from './EmptyState.js';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { AttachmentPicker } from './AttachmentPicker.js';
import {
  MessageComposer,
  type BeforeSend,
  type ComposerPassThroughProps,
  type MessageComposerHandle,
} from './MessageComposer.js';
import type { MessageExtraAction } from './MessageActions.js';
import { alertConfirmDelete } from './internal/alertConfirmDelete.js';
import { confirmThenDelete, type ConfirmDelete } from './internal/confirmDelete.js';
import { MessageList } from './MessageList.js';
import { MessageRow } from './MessageRow.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
import { EDGE_TO_EDGE_MODAL } from './internal/edgeToEdge.js';
import { useSafeInsets } from './internal/safeArea.js';
import { UploadProvider } from './internal/uploadContext.js';
import { useDismissableSheet } from './internal/useDismissableSheet.js';
import type { ChatDensity, ChatLayout, TimeFormat } from './layout.js';
import { useTheme } from './theme/PoolseTheme.js';

export interface ThreadViewProps {
  visible: boolean;
  onClose: () => void;
  conversationId: Uuid;
  rootMessage: Message;
  labelFor?: (externalId: string) => string;
  avatarFor?: (externalId: string) => string | null;
  /** Row layout for the root and replies — see `ChatLayout`. Defaults to `'bubbles'`. */
  layout?: ChatLayout;
  timeFormat?: TimeFormat;
  /** Row spacing for the root and replies, as on `ConversationView`. */
  density?: ChatDensity;
  /** Presence badges on reply avatars. Defaults to `false`. */
  showPresence?: boolean;
  /** Link previews under replies. Defaults to `true`. */
  linkPreviews?: boolean;
  /** A Follow / Following button in the header (MS19). Default `true`. */
  follow?: boolean;
  /** An "Also send to channel" switch above the composer (MS19). Default `true`; off in DMs. */
  alsoSendToChannel?: boolean;
  /** Passed through to the composer, as `ConversationView`'s `composerProps`. */
  composerProps?: ComposerPassThroughProps;
  /** Rendered above the composer. */
  composerAccessory?: ReactNode;
  /** The composer's handle, as `ConversationView`'s `composerHandle`. */
  composerHandle?: Ref<MessageComposerHandle>;
  /** Runs before every reply: return it (changed or not), or `false` to cancel. */
  beforeSend?: BeforeSend;
  /** The app's own entries in a reply's long-press menu. */
  extraActions?: (msg: Message) => readonly MessageExtraAction[];
  /** Asked before a reply is deleted. Defaults to a native "Delete message?" alert. */
  confirmDelete?: ConfirmDelete;
  /** Largest attachment accepted, in bytes, as `ConversationView`'s. */
  maxFileSize?: number;
  /** Accepted attachment types, as `ConversationView`'s `acceptedFileTypes`. */
  acceptedFileTypes?: string[];
}

type ThreadHooks = Pick<
  ThreadViewProps,
  | 'composerProps'
  | 'composerAccessory'
  | 'composerHandle'
  | 'beforeSend'
  | 'extraActions'
  | 'confirmDelete'
  | 'maxFileSize'
  | 'acceptedFileTypes'
>;

// Sheet covers the bottom 88% of the screen. The remaining 12% is the
// pull-down gutter (also the KeyboardAvoidingView's vertical offset).
const SHEET_HEIGHT_FRACTION = 0.88;

/**
 * Bottom-sheet modal for thread replies. Pull the drag handle / header
 * down to dismiss; tap the backdrop or close button too. The composer
 * inside the sheet supports attachments (paperclip → picker, shared
 * upload queue) and the reply rows support reactions, swipe-to-reply,
 * long-press actions, edit, delete — same surface as ConversationView.
 *
 * Keyboard handling: the modal is translucent (edge-to-edge) on both
 * platforms, so nothing resizes it for the keyboard — Android's
 * `adjustResize` doesn't reach an edge-to-edge window. The composer
 * needs its own `padding` KeyboardAvoidingView with
 * `keyboardVerticalOffset` = the distance from the screen top to the
 * sheet top (the gutter), since KAV measures its frame relative to
 * its parent (the sheet), not the screen.
 */
export function ThreadView({
  visible,
  onClose,
  conversationId,
  rootMessage,
  labelFor,
  avatarFor,
  layout,
  timeFormat,
  density,
  showPresence = false,
  linkPreviews = true,
  follow = true,
  alsoSendToChannel = true,
  ...hooks
}: ThreadViewProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      // Edge-to-edge on Android like the host app, so the modal covers
      // the whole screen and the keyboard overlap is the same maths as
      // on iOS. The composer pads itself for the nav bar.
      {...EDGE_TO_EDGE_MODAL}
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
          {...(layout ? { layout } : {})}
          {...(timeFormat ? { timeFormat } : {})}
          {...(density ? { density } : {})}
          showPresence={showPresence}
          linkPreviews={linkPreviews}
          follow={follow}
          alsoSendToChannel={alsoSendToChannel}
          hooks={hooks}
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
  layout,
  timeFormat,
  density,
  showPresence,
  linkPreviews,
  follow,
  alsoSendToChannel,
  hooks,
}: {
  hooks: ThreadHooks;
  onClose: () => void;
  conversationId: Uuid;
  rootMessage: Message;
  labelFor?: (externalId: string) => string;
  avatarFor?: (externalId: string) => string | null;
  layout?: ChatLayout;
  timeFormat?: TimeFormat;
  density?: ChatDensity;
  showPresence: boolean;
  linkPreviews: boolean;
  follow: boolean;
  alsoSendToChannel: boolean;
}) {
  const theme = useTheme();
  const followState = useThreadFollow(follow ? rootMessage.id : null);
  const [alsoToChannel, setAlsoToChannel] = useState(false);
  // A refused attachment (too large, a type not accepted), said in the sheet.
  const [attachError, setAttachError] = useState<string | null>(null);
  const { me } = useMe();
  const chat = usePoolse();
  const meId = me?.id ?? null;
  const {
    replies,
    sendReply,
    edit,
    delete: deleteReply,
    loadMore,
    hasMore,
  } = useThread(conversationId, rootMessage.id);
  const insets = useSafeInsets();
  const { height: windowHeight } = useWindowDimensions();
  // Measured modal height — on some Android builds the window
  // dimensions exclude the nav bar while the translucent modal draws
  // under it, which would skew the keyboard offset by that much.
  const [rootHeight, setRootHeight] = useState(0);
  const screenHeight = rootHeight || windowHeight;
  // Never let the sheet's header slide under the status bar.
  const sheetHeight = Math.min(
    Math.round(screenHeight * SHEET_HEIGHT_FRACTION),
    screenHeight - insets.top - 8,
  );
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
          onDelete={() =>
            void confirmThenDelete(msg, hooks.confirmDelete ?? alertConfirmDelete, deleteReply)
          }
          {...(hooks.extraActions ? { extraActions: hooks.extraActions(msg) } : {})}
          {...(labelFor ? { labelFor } : {})}
          {...(avatarFor ? { avatarFor } : {})}
          {...(layout ? { layout } : {})}
          {...(timeFormat ? { timeFormat } : {})}
          {...(density ? { density } : {})}
          showPresence={showPresence}
          linkPreviews={linkPreviews}
          {...(linkPreviews && isSelf && !msg.deleted_at && (msg.link_previews?.length ?? 0) > 0
            ? {
                onRemoveLinkPreview: (url: string) =>
                  void chat.messages
                    .update(msg.id, { remove_link_previews: [url] })
                    .catch(() => undefined),
              }
            : {})}
        />
      );
    },
    [
      meId,
      editingId,
      deleteReply,
      hooks,
      labelFor,
      avatarFor,
      layout,
      timeFormat,
      density,
      showPresence,
      linkPreviews,
      chat,
    ],
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
        {...(layout ? { layout } : {})}
        {...(timeFormat ? { timeFormat } : {})}
        {...(density ? { density } : {})}
        linkPreviews={linkPreviews}
      />
    ),
    [rootMessage, meId, labelFor, avatarFor, layout, timeFormat, density, linkPreviews],
  );

  return (
    <View
      style={styles.modalRoot}
      onLayout={(e) => setRootHeight(Math.round(e.nativeEvent.layout.height))}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close thread" />

      <Animated.View
        style={[
          styles.sheet,
          {
            height: sheetHeight,
            backgroundColor: theme.colors.background,
            borderTopLeftRadius: theme.radii.xl,
            borderTopRightRadius: theme.radii.xl,
            paddingLeft: insets.left,
            paddingRight: insets.right,
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
            <View style={[styles.dragPill, { backgroundColor: theme.colors.textSubtle }]} />
          </View>

          <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
            <Pressable
              onPress={onClose}
              hitSlop={16}
              style={[styles.closeBtn, { backgroundColor: theme.colors.surfaceAlt }]}
              accessibilityLabel="Close thread"
            >
              <PoolseIcon name="close" size={18} color={theme.colors.text} />
            </Pressable>
            <Text
              style={[styles.title, { color: theme.colors.text, fontFamily: theme.fonts.display }]}
            >
              Thread
            </Text>
            {follow && followState.following !== null ? (
              <Pressable
                onPress={() => void followState.setFollowing(!followState.following)}
                style={[
                  styles.followBtn,
                  {
                    backgroundColor: followState.following
                      ? theme.colors.accentSoft
                      : 'transparent',
                    borderColor: followState.following ? 'transparent' : theme.colors.border,
                  },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: followState.following }}
                accessibilityLabel={followState.following ? 'Following thread' : 'Follow thread'}
                hitSlop={8}
              >
                <Text
                  style={[
                    styles.followText,
                    {
                      color: followState.following
                        ? theme.colors.accentStrong
                        : theme.colors.textMuted,
                    },
                  ]}
                >
                  {followState.following ? 'Following' : 'Follow'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* KAV scope: just the scrolling area + composer. `padding` on
            both platforms: the modal is full-screen and never resized,
            so the overlap is exactly the keyboard's height over the
            sheet bottom. The composer drops its nav-bar inset while the
            keyboard is up, so there's no gap above the keyboard. */}
        <KeyboardAvoidingView
          style={styles.kavBody}
          behavior="padding"
          keyboardVerticalOffset={gutter}
        >
          <View style={[styles.rootPreview, { backgroundColor: theme.colors.surfaceAlt }]}>
            {rootRow}
          </View>

          <View style={styles.listWrap}>
            <MessageList
              messages={replies}
              hasMore={hasMore}
              onLoadMore={loadMore}
              renderItem={renderReply}
              emptyState={
                <EmptyState
                  title="No replies yet"
                  hint="Write a reply below to start the thread."
                />
              }
            />
          </View>

          {alsoSendToChannel && !editingMessage ? (
            <View style={styles.alsoRow}>
              <Text style={[styles.alsoText, { color: theme.colors.textMuted }]}>
                Also send to channel
              </Text>
              <Switch
                value={alsoToChannel}
                onValueChange={setAlsoToChannel}
                accessibilityLabel="Also send to channel"
              />
            </View>
          ) : null}
          {attachError ? (
            <Text
              style={[styles.attachError, { color: theme.colors.danger }]}
              accessibilityLiveRegion="polite"
              onPress={() => setAttachError(null)}
            >
              {attachError}
            </Text>
          ) : null}
          {hooks.composerAccessory}
          <MessageComposer
            ref={hooks.composerHandle ?? null}
            onSend={async (body, opts) => {
              let draft: MessageCreateRequest = {
                body,
                ...opts,
                ...(alsoSendToChannel && alsoToChannel ? { also_send_to_channel: true } : {}),
              };
              if (hooks.beforeSend) {
                const changed = await hooks.beforeSend(draft);
                if (changed === false) return false;
                draft = changed;
              }
              await sendReply(draft);
              setAlsoToChannel(false);
              return undefined;
            }}
            placeholder="Reply to thread…"
            attachments
            onAttachPress={() => {
              setAttachError(null);
              setPickerOpen(true);
            }}
            {...hooks.composerProps}
            editingMessage={editingMessage}
            onCancelEdit={() => setEditingId(null)}
            onSaveEdit={async (body) => {
              if (!editingId) return;
              await edit(editingId, body);
              setEditingId(null);
            }}
          />
        </KeyboardAvoidingView>

        <AttachmentPicker
          visible={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onError={setAttachError}
          {...(hooks.maxFileSize !== undefined ? { maxFileSize: hooks.maxFileSize } : {})}
          {...(hooks.acceptedFileTypes ? { acceptedTypes: hooks.acceptedFileTypes } : {})}
        />
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
  followBtn: {
    marginLeft: 'auto',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  followText: { fontSize: 13, fontWeight: '600' },
  alsoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  alsoText: { fontSize: 13 },
  attachError: { fontSize: 13, paddingHorizontal: 16, paddingTop: 6 },
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
