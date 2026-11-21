import { Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import type { Message, Uuid } from '@poolse/sdk';
import { useMemo, useRef, useState } from 'react';
// Static import — Metro's bundle graph can only trace literal
// `import` / `require` calls. See ./internal/markdown.ts for the
// full reasoning. `expo-clipboard` is a required peer dep; consumers
// who don't want copy can omit the Copy action by not enabling
// `actions` on <ConversationView>.
import * as Clipboard from 'expo-clipboard';

import { Avatar } from './primitives/Avatar.js';
import { CallLogRow } from './CallLogRow.js';
import { RecordingNoticeRow } from './Recording.js';
import { canShowEditHistory, EditHistorySheet } from './EditHistorySheet.js';
import { EmojiPicker } from './EmojiPicker.js';
import { FlatMessageRow } from './FlatMessageRow.js';
import {
  renderSlot,
  type ChatDensity,
  type ChatLayout,
  type MessageSlotContext,
  type MessageSlots,
  type TimeFormat,
} from './layout.js';
import { MessageActions } from './MessageActions.js';
import { MessageBubble, type BubbleGroupPosition } from './MessageBubble.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
import { ReactionStrip } from './Reactions.js';
import { messageA11yLabel } from './internal/a11y.js';
import { SendStatus } from './SendStatus.js';
import { ThreadSummary } from './ThreadSummary.js';
import { useTheme } from './theme/PoolseTheme.js';
import {
  callLogDisplayFor,
  isTombstone,
  recordingNoticeDisplayFor,
  useReactions,
  useUser,
} from '@poolse/react';

// Swipe-to-reply triggers at this much horizontal pull. iOS / WhatsApp
// use 50–60px; the lower bound feels lighter for one-handed thumb use.
const SWIPE_REPLY_THRESHOLD = 50;

/** Who sent a message — what `onSenderPress` / `onAvatarPress` receive. */
export interface MessageUser {
  /** poolse user id. */
  userId: Uuid | null;
  /** Your own user id (`external_id`) — what `userResolver` takes. */
  externalId: string | null;
  /** Resolved name, or the fallback shown in its place. */
  displayName: string;
  avatarUrl: string | null;
}

export interface MessageRowProps {
  msg: Message;
  meId: string | null;

  // Feature toggles — same set as ConversationView's, but per-row.
  reactions?: boolean;
  attachments?: boolean;
  actions?: boolean;
  /** Pass false in ThreadView since nested threads aren't a thing in v1. */
  threads?: boolean;
  /** WhatsApp-style quote-reply. Defaults true on ConversationView. */
  quotations?: boolean;
  /** Forwarded to `<MessageBubble markdown>`. Defaults true. */
  markdown?: boolean;

  readState?: 'sent' | 'read';

  /**
   * Whether this row's message is the one currently being edited.
   * Editing happens in the composer (see MessageComposer's
   * `editingMessage` prop); this flag is only used to elevate the
   * row above the dim backdrop ConversationView renders during
   * edit mode.
   */
  isEditing?: boolean;
  /**
   * Long-press → "Edit". Omitted entirely (no Edit option in the
   * menu) when the parent has decided this message isn't editable
   * (someone read it, it's deleted, it isn't yours).
   */
  onStartEdit?: () => void;
  onDelete?: () => void;
  onOpenThread?: () => void;
  onQuote?: () => void;
  labelFor?: (externalId: string) => string;
  onQuotedClick?: (quotedMessageId: Uuid) => void;
  groupPosition?: BubbleGroupPosition;
  maxBodyLength?: number;
  /** Show a colored sender label above other-side bubbles. */
  showSenderName?: boolean;
  /** Render an avatar to the LEFT of other-side bubbles. */
  showAvatar?: boolean;
  /** Avatar resolver — same signature as `<MemberList avatarFor>`. */
  avatarFor?: (externalId: string) => string | null;
  /** Makes the sender label tappable (other people's messages). */
  onSenderPress?: (user: MessageUser) => void;
  /** Makes the avatar tappable (other people's messages). */
  onAvatarPress?: (user: MessageUser) => void;
  /** Call-log rows: offer "Call back" (see `<CallLogRow onCallBack>`). */
  onCallBack?: (media: 'audio' | 'video') => void;
  /**
   * A poolse user id → display name, for system lines that name people
   * by internal id (the recording notice). Unknown: the name is left out.
   */
  nameForUserId?: (userId: string) => string | null | undefined;
  /** `'bubbles'` (default), `'list'` or `'compact'` — see `ChatLayout`. */
  layout?: ChatLayout;
  /** `'comfortable'` (default) or `'compact'` spacing. */
  density?: ChatDensity;
  /** `'12h'`, `'24h'` or a formatter for timestamps. Defaults to the locale's. */
  timeFormat?: TimeFormat;
  /** Replace or wrap parts of the row — see `MessageSlots`. */
  slots?: MessageSlots;
  /**
   * The message @-mentions the viewer: `list` and `compact` mark it
   * with an accent bar.
   */
  mentionsMe?: boolean;
  /** Presence badge on the sender's avatar (needs `showAvatar`). */
  showPresence?: boolean;
  /** Show the message's link previews as cards under the text. Defaults to true. */
  linkPreviews?: boolean;
  /**
   * Long-press → "Remove preview" on your own message (one per link).
   * Receives the preview's url — `chat.messages.update(id, { remove_link_previews: [url] })`.
   */
  onRemoveLinkPreview?: (url: string) => void;
  /** Long-press → "Mark unread" on other people's messages. */
  onMarkUnread?: () => void;
  /** The "edited" label opens the edit history (`chat.messages.edits`). Defaults to true. */
  editHistory?: boolean;
  /** Unsent message (queued or failed in the outbox): the Retry under it. */
  onRetrySend?: () => void;
  /** Unsent message: the Delete under it. */
  onDiscardSend?: () => void;
}

/**
 * The long-press sheet both row layouts open: same items, same order.
 * Exported for FlatMessageRow.
 */
export function RowActionsSheet({
  msg,
  isSelf,
  close,
  reactions,
  addReaction,
  onMoreReactions,
  threads,
  quotations,
  onStartEdit,
  onDelete,
  onOpenThread,
  onQuote,
  onMarkUnread,
  onRemoveLinkPreview,
  linkPreviews,
}: {
  msg: Message;
  isSelf: boolean;
  close: () => void;
  reactions: boolean;
  addReaction: (emoji: string) => void;
  onMoreReactions: () => void;
  threads: boolean;
  quotations: boolean;
  onStartEdit: (() => void) | undefined;
  onDelete: (() => void) | undefined;
  onOpenThread: (() => void) | undefined;
  onQuote: (() => void) | undefined;
  onMarkUnread: (() => void) | undefined;
  onRemoveLinkPreview: ((url: string) => void) | undefined;
  linkPreviews: boolean;
}) {
  const then = (fn: () => void) => () => {
    close();
    fn();
  };
  const previewUrls = linkPreviews ? (msg.link_previews ?? []).map((p) => p.url) : [];
  return (
    <MessageActions
      visible
      onClose={close}
      isSelf={isSelf}
      {...(reactions ? { onPickReaction: addReaction, onMoreReactions } : {})}
      {...(msg.body ? { onCopy: then(() => void Clipboard.setStringAsync(msg.body ?? '')) } : {})}
      {...(onStartEdit ? { onEdit: then(onStartEdit) } : {})}
      {...(onDelete ? { onDelete: then(onDelete) } : {})}
      {...(threads && onOpenThread ? { onReplyInThread: then(onOpenThread) } : {})}
      {...(quotations && onQuote ? { onQuote: then(onQuote) } : {})}
      {...(onMarkUnread ? { onMarkUnread: then(onMarkUnread) } : {})}
      {...(onRemoveLinkPreview && previewUrls.length > 0
        ? {
            previewUrls,
            onRemovePreview: (url: string) => {
              close();
              onRemoveLinkPreview(url);
            },
          }
        : {})}
    />
  );
}

/** The emoji picker and edit-history sheets a row opens. Exported for FlatMessageRow. */
export function RowSheets({
  msg,
  emojiOpen,
  onCloseEmoji,
  onPickEmoji,
  historyOpen,
  onCloseHistory,
}: {
  msg: Message;
  emojiOpen: boolean;
  onCloseEmoji: () => void;
  onPickEmoji: (emoji: string) => void;
  historyOpen: boolean;
  onCloseHistory: () => void;
}) {
  return (
    <>
      {emojiOpen ? (
        <EmojiPicker visible onClose={onCloseEmoji} onPick={onPickEmoji} title="Add a reaction" />
      ) : null}
      {historyOpen ? (
        <EditHistorySheet
          visible
          onClose={onCloseHistory}
          messageId={msg.id}
          currentBody={msg.body}
        />
      ) : null}
    </>
  );
}

export function MessageRow(props: MessageRowProps) {
  // Call-log system messages render as a centered compact line with
  // no bubble / swipe / long-press / reactions. `undefined` = not a
  // call log; `null` = a call log hidden for this viewer (someone
  // else's missed-call marker). Split into its own component so the
  // bubble row's hooks never run conditionally.
  // Recording notices (`{"kind":"recording"}`): the same compact line.
  if (recordingNoticeDisplayFor(props.msg, props.meId)) {
    return (
      <RecordingNoticeRow
        msg={props.msg}
        meId={props.meId}
        {...(props.nameForUserId ? { nameFor: props.nameForUserId } : {})}
      />
    );
  }
  const callLog = callLogDisplayFor(props.msg, props.meId);
  if (callLog !== undefined) {
    return callLog ? (
      <CallLogRow
        msg={props.msg}
        meId={props.meId}
        {...(props.onCallBack ? { onCallBack: props.onCallBack } : {})}
      />
    ) : null;
  }
  if (props.layout === 'list' || props.layout === 'compact') {
    return <FlatMessageRow {...props} layout={props.layout} />;
  }
  return <BubbleMessageRow {...props} />;
}

function BubbleMessageRow({
  msg,
  meId,
  reactions = true,
  attachments = true,
  actions = true,
  threads = true,
  quotations = true,
  markdown = true,
  readState,
  isEditing = false,
  onStartEdit,
  onDelete,
  onOpenThread,
  onQuote,
  labelFor,
  onQuotedClick,
  groupPosition = 'standalone',
  maxBodyLength = 0,
  showSenderName = false,
  showAvatar = false,
  avatarFor,
  onSenderPress,
  onAvatarPress,
  density = 'comfortable',
  timeFormat,
  slots,
  showPresence = false,
  linkPreviews = true,
  onRemoveLinkPreview,
  onMarkUnread,
  editHistory = true,
  onRetrySend,
  onDiscardSend,
}: MessageRowProps) {
  const theme = useTheme();
  const isSelf = meId !== null && msg.sender_id === meId;
  // A deleted message: "This message was deleted", nothing to act on,
  // react to or quote — only its thread stays reachable. An unsent one
  // (outbox) isn't on the server yet: nothing to act on either.
  const tombstone = isTombstone(msg) || !!msg.local_status;
  const [actionsOpen, setActionsOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Per-row useReactions subscription so the long-press → React picker
  // and the inline ReactionStrip share the same realtime state. Adds
  // one realtime listener per visible row, which is fine — they're
  // server-filtered by messageId and the FlatList only mounts rows in
  // view. Initial seed comes from msg.reactions so the strip renders
  // immediately without waiting for the first echo.
  const reactionsApi = useReactions(msg.id, {
    conversationId: msg.conversation_id,
    currentUserId: meId,
    ...(msg.reactions ? { initialReactions: msg.reactions } : {}),
  });

  // Swipe-to-reply state. The bubble's translateX is driven by a pan
  // gesture; when the user releases past SWIPE_REPLY_THRESHOLD we fire
  // onQuote (which the parent wires to setReplyingTo on the composer).
  // Animation runs on the JS thread because we need to read the value
  // synchronously on release — native driver would prevent that.
  const translateX = useRef(new Animated.Value(0)).current;
  const swipeEnabled = quotations && !!onQuote && !isEditing && !tombstone;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Tap / long-press still go to the inner Pressable.
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        // Capture-phase claim: we intercept the gesture BEFORE the
        // child Pressable as soon as the move shows clear horizontal
        // intent. Without capture-phase, the Pressable's touch handling
        // wins first and the pan never starts (this is why self-bubble
        // left swipes felt totally dead — the Pressable was attached
        // to a touch that started with the user's finger over the
        // bubble center, and we never got a turn).
        onMoveShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: (_, g) => {
          if (!swipeEnabled) return false;
          // 4px is plenty to disambiguate from an accidental jitter
          // during a tap. `dx > dy` (not `dx > dy * 2`) so a slightly
          // diagonal pull still counts as horizontal — the user isn't
          // going to hold their finger to a perfect axis.
          return Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy);
        },
        // Don't surrender the gesture mid-swipe (e.g. parent FlatList
        // asking for it back) — once we're translating the bubble we
        // hold on until release.
        onPanResponderTerminationRequest: () => false,
        // 1:1 finger-follow up to the threshold, then square-root
        // damping past it so the bubble never slides off-screen.
        // Matches iMessage / WhatsApp — feels weightless during the
        // committed range and stiffens once you've already triggered.
        onPanResponderMove: (_, g) => {
          const dx = isSelf ? Math.min(0, g.dx) : Math.max(0, g.dx);
          const abs = Math.abs(dx);
          let translated: number;
          if (abs <= SWIPE_REPLY_THRESHOLD) {
            translated = dx;
          } else {
            const excess = abs - SWIPE_REPLY_THRESHOLD;
            const dampened = SWIPE_REPLY_THRESHOLD + Math.sqrt(excess * 6);
            translated = dx < 0 ? -dampened : dampened;
          }
          translateX.setValue(translated);
        },
        onPanResponderRelease: (_, g) => {
          const past = Math.abs(g.dx) >= SWIPE_REPLY_THRESHOLD;
          if (past && onQuote) onQuote();
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: false,
            speed: 28,
            bounciness: 4,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: false,
            speed: 28,
            bounciness: 4,
          }).start();
        },
      }),
    [swipeEnabled, isSelf, onQuote, translateX],
  );

  // Reply icon fades + scales in as the bubble drags past ~half the
  // threshold. Sits on the SAME side the swipe is coming FROM (so
  // it's revealed behind the bubble as the bubble slides away).
  const replyIconOpacity = translateX.interpolate({
    inputRange: isSelf
      ? [-SWIPE_REPLY_THRESHOLD, -SWIPE_REPLY_THRESHOLD / 2, 0]
      : [0, SWIPE_REPLY_THRESHOLD / 2, SWIPE_REPLY_THRESHOLD],
    outputRange: isSelf ? [1, 0.3, 0] : [0, 0.3, 1],
    extrapolate: 'clamp',
  });
  const replyIconScale = translateX.interpolate({
    inputRange: isSelf ? [-SWIPE_REPLY_THRESHOLD, 0] : [0, SWIPE_REPLY_THRESHOLD],
    outputRange: isSelf ? [1, 0.5] : [0.5, 1],
    extrapolate: 'clamp',
  });

  const showAvatarSlot = showAvatar && !isSelf;
  const showAvatarRender =
    showAvatarSlot && (groupPosition === 'last' || groupPosition === 'standalone');
  // Resolve avatar / label with the same priority as MessageBubble /
  // ChatHeader: explicit prop > SDK userResolver > externalId fallback.
  // Without the useUser fallback, omitting `avatarFor` / `labelFor` on
  // <ConversationView> bypassed the resolver at the row level even
  // when `PoolseConfig.userResolver` was configured.
  // Always resolved: the row's screen-reader label names the sender.
  const rowSender = useUser(msg.sender_external_id);
  const avatarUrl = msg.sender_external_id
    ? (avatarFor?.(msg.sender_external_id) ?? rowSender.profile?.avatarUrl ?? null)
    : null;
  const senderLabel = msg.sender_external_id
    ? (labelFor?.(msg.sender_external_id) ??
      rowSender.profile?.displayName ??
      msg.sender_external_id)
    : null;
  const sender: MessageUser = {
    userId: msg.sender_id,
    externalId: msg.sender_external_id,
    displayName: senderLabel ?? 'Unknown',
    avatarUrl,
  };
  const slotContext: MessageSlotContext = {
    message: msg,
    isSelf,
    sender,
    layout: 'bubbles',
    isRunStart: groupPosition === 'first' || groupPosition === 'standalone',
  };
  const avatar = (
    <Avatar
      src={avatarUrl ?? null}
      name={senderLabel}
      seed={msg.sender_external_id ?? null}
      size="sm"
      {...(showPresence && msg.sender_external_id ? { presence: true as const } : {})}
    />
  );

  return (
    <View
      style={[
        styles.row,
        { alignSelf: isSelf ? 'flex-end' : 'flex-start' },
        density === 'compact' ? styles.rowDense : null,
        // Lift this row above the dim backdrop the parent renders
        // during edit mode. zIndex covers iOS / web; elevation does
        // the equivalent on Android.
        isEditing ? styles.rowEditing : null,
      ]}
    >
      {showAvatarSlot ? (
        <View style={styles.avatarSlot}>
          {!showAvatarRender ? null : onAvatarPress ? (
            <Pressable
              onPress={() => onAvatarPress(sender)}
              accessibilityRole="button"
              accessibilityLabel={sender.displayName}
              hitSlop={6}
            >
              {avatar}
            </Pressable>
          ) : (
            avatar
          )}
        </View>
      ) : null}

      <View style={styles.bubbleCol}>
        {swipeEnabled ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.replyHint,
              isSelf ? styles.replyHintRight : styles.replyHintLeft,
              {
                opacity: replyIconOpacity,
                transform: [{ scale: replyIconScale }],
                backgroundColor: theme.colors.surfaceAlt,
              },
            ]}
          >
            <PoolseIcon name="reply" size={16} color={theme.colors.accent} />
          </Animated.View>
        ) : null}

        <Animated.View
          {...(swipeEnabled ? panResponder.panHandlers : {})}
          style={{ transform: [{ translateX }] }}
        >
          <Pressable
            onLongPress={() => {
              if (!actions || tombstone) return;
              setActionsOpen(true);
            }}
            accessibilityLabel={messageA11yLabel(msg, senderLabel ?? 'Unknown', isSelf)}
            {...(actions && !tombstone
              ? {
                  accessibilityHint: 'Long press for message actions',
                  accessibilityActions: [{ name: 'longpress', label: 'Message actions' }],
                  onAccessibilityAction: () => setActionsOpen(true),
                }
              : {})}
          >
            <MessageBubble
              message={msg}
              currentUserId={meId}
              {...(readState ? { readState } : {})}
              {...(labelFor ? { labelFor } : {})}
              {...(onQuotedClick ? { onQuotedClick } : {})}
              groupPosition={groupPosition}
              maxBodyLength={maxBodyLength}
              showSenderName={showSenderName}
              {...(onSenderPress ? { onSenderPress: () => onSenderPress(sender) } : {})}
              showAttachments={attachments}
              markdown={markdown}
              density={density}
              {...(timeFormat ? { timeFormat } : {})}
              {...(slots ? { slots, slotContext } : {})}
              // No actionsTrigger: the always-visible chevron stamped
              // into the bubble corner fought the bubble shape and
              // duplicated affordances a phone already has — long-press
              // opens the same sheet, swipe quotes. Touch conventions,
              // not desktop ones.
              //
              // The long-press is ALSO threaded into the bubble so the
              // image tiles — Pressables of their own, which win the
              // gesture — still open the sheet on an image-only message.
              onLongPress={() => {
                if (actions && !tombstone) setActionsOpen(true);
              }}
              linkPreviews={linkPreviews}
              {...(editHistory && canShowEditHistory(msg.id)
                ? { onEditedPress: () => setHistoryOpen(true) }
                : {})}
            />
          </Pressable>
        </Animated.View>

        <SendStatus
          message={msg}
          alignEnd={isSelf}
          {...(onRetrySend ? { onRetry: onRetrySend } : {})}
          {...(onDiscardSend ? { onDiscard: onDiscardSend } : {})}
        />

        {renderSlot(
          slots?.thread,
          slotContext,
          threads && !msg.thread_root_id && (msg.reply_count ?? 0) > 0 && onOpenThread ? (
            <ThreadSummary
              message={msg}
              onPress={onOpenThread}
              alignEnd={isSelf}
              {...(labelFor ? { labelFor } : {})}
              {...(avatarFor ? { avatarFor } : {})}
            />
          ) : null,
        )}

        {renderSlot(
          slots?.reactions,
          slotContext,
          reactions && !tombstone ? (
            <View style={[styles.reactionsRow, { alignSelf: isSelf ? 'flex-end' : 'flex-start' }]}>
              <ReactionStrip
                messageId={msg.id}
                conversationId={msg.conversation_id}
                meId={meId}
                {...(msg.reactions ? { initialReactions: msg.reactions } : {})}
                {...(actions ? { onMorePress: () => setEmojiOpen(true) } : {})}
              />
            </View>
          ) : null,
        )}
      </View>

      {renderSlot(
        slots?.actions,
        slotContext,
        actions && actionsOpen && !tombstone ? (
          <RowActionsSheet
            msg={msg}
            isSelf={isSelf}
            close={() => setActionsOpen(false)}
            reactions={reactions}
            addReaction={(emoji) => void reactionsApi.addReaction(emoji)}
            onMoreReactions={() => setEmojiOpen(true)}
            threads={threads}
            quotations={quotations}
            onStartEdit={onStartEdit}
            onDelete={onDelete}
            onOpenThread={onOpenThread}
            onQuote={onQuote}
            onMarkUnread={onMarkUnread}
            onRemoveLinkPreview={onRemoveLinkPreview}
            linkPreviews={linkPreviews}
          />
        ) : null,
      )}
      <RowSheets
        msg={msg}
        emojiOpen={emojiOpen}
        onCloseEmoji={() => setEmojiOpen(false)}
        onPickEmoji={(emoji) => void reactionsApi.addReaction(emoji)}
        historyOpen={historyOpen}
        onCloseHistory={() => setHistoryOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    // Tighter vertical rhythm — was 2px each side (4px between rows)
    // plus the bubble's 4px marginBottom = 8px. Now 1+1+2 = 4px,
    // closer to iMessage / WhatsApp density.
    marginVertical: 1,
    // 10px on each side — tight enough to use the available width
    // for content, loose enough to keep bubbles off the screen edge
    // on every device.
    paddingHorizontal: 10,
    maxWidth: '95%',
  },
  rowDense: {
    marginVertical: 0,
  },
  rowEditing: {
    // Above ConversationView's editBackdrop (zIndex 5). Elevation
    // does the equivalent stacking on Android.
    zIndex: 10,
    elevation: 10,
  },
  avatarSlot: {
    width: 36,
    marginRight: 6,
  },
  bubbleCol: {
    flexShrink: 1,
    position: 'relative',
  },
  replyHint: {
    position: 'absolute',
    top: '50%',
    marginTop: -16,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: -1,
  },
  replyHintLeft: {
    left: -44,
  },
  replyHintRight: {
    right: -44,
  },
  reactionsRow: {
    marginTop: 2,
  },
});
