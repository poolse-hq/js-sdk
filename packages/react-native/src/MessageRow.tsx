import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Message, Uuid } from '@poolse/sdk';
import { useMemo, useRef, useState } from 'react';

import { Avatar } from './primitives/Avatar.js';
import { EditableMessageBubble } from './EditableMessageBubble.js';
import { MessageActions } from './MessageActions.js';
import { MessageBubble, type BubbleGroupPosition } from './MessageBubble.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
import { ReactionStrip } from './Reactions.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';
import { useReactions } from '@poolse/react';

// Swipe-to-reply triggers at this much horizontal pull. iOS / WhatsApp
// use 50–60px; the lower bound feels lighter for one-handed thumb use.
const SWIPE_REPLY_THRESHOLD = 50;

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

  readState?: 'sent' | 'read';

  editing?: boolean;
  onStartEdit?: () => void;
  onCancelEdit?: () => void;
  onSaveEdit?: (body: string) => Promise<unknown> | void;
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
}

export function MessageRow({
  msg,
  meId,
  reactions = true,
  attachments = true,
  actions = true,
  threads = true,
  quotations = true,
  readState,
  editing = false,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
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
}: MessageRowProps) {
  const theme = usePoolseTheme();
  const isSelf = meId !== null && msg.sender_id === meId;
  const [actionsOpen, setActionsOpen] = useState(false);

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
  const swipeEnabled = quotations && !!onQuote && !editing;

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
  const avatarUrl = avatarFor && msg.sender_external_id ? avatarFor(msg.sender_external_id) : null;
  const senderLabel =
    msg.sender_external_id && labelFor
      ? labelFor(msg.sender_external_id)
      : (msg.sender_external_id ?? null);

  return (
    <View style={[styles.row, { alignSelf: isSelf ? 'flex-end' : 'flex-start' }]}>
      {showAvatarSlot ? (
        <View style={styles.avatarSlot}>
          {showAvatarRender ? (
            <Avatar
              src={avatarUrl ?? null}
              name={senderLabel}
              seed={msg.sender_external_id ?? null}
              size="sm"
            />
          ) : null}
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
                backgroundColor: theme.colors.surface2,
              },
            ]}
          >
            <PoolseIcon name="reply" size={16} color={theme.colors.brand} />
          </Animated.View>
        ) : null}

        <Animated.View
          {...(swipeEnabled ? panResponder.panHandlers : {})}
          style={{ transform: [{ translateX }] }}
        >
          <Pressable
            onLongPress={() => {
              if (!actions) return;
              setActionsOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Message actions"
          >
            {editing ? (
              <EditableMessageBubble
                message={msg}
                currentUserId={meId}
                onCancel={onCancelEdit ?? (() => undefined)}
                onSave={onSaveEdit ?? (() => undefined)}
              />
            ) : (
              <MessageBubble
                message={msg}
                currentUserId={meId}
                {...(readState ? { readState } : {})}
                {...(labelFor ? { labelFor } : {})}
                {...(onQuotedClick ? { onQuotedClick } : {})}
                groupPosition={groupPosition}
                maxBodyLength={maxBodyLength}
                showSenderName={showSenderName}
                showAttachments={attachments}
                actionsTrigger={
                  actions ? (
                    <Pressable onPress={() => setActionsOpen(true)} hitSlop={8}>
                      <PoolseIcon
                        name="chevron-down"
                        size={14}
                        color={isSelf ? theme.colors.onBrand : theme.colors.ink3}
                      />
                    </Pressable>
                  ) : null
                }
              />
            )}
          </Pressable>
        </Animated.View>

        {threads && (msg.reply_count ?? 0) > 0 && onOpenThread ? (
          <Pressable onPress={onOpenThread} style={styles.threadPill}>
            <Text style={[styles.threadPillText, { color: theme.colors.brand }]}>
              💬 {msg.reply_count} {msg.reply_count === 1 ? 'reply' : 'replies'}
            </Text>
          </Pressable>
        ) : null}

        {reactions ? (
          <View style={[styles.reactionsRow, { alignSelf: isSelf ? 'flex-end' : 'flex-start' }]}>
            <ReactionStrip
              messageId={msg.id}
              conversationId={msg.conversation_id}
              meId={meId}
              {...(msg.reactions ? { initialReactions: msg.reactions } : {})}
            />
          </View>
        ) : null}
      </View>

      {actions && actionsOpen ? (
        <MessageActions
          visible={actionsOpen}
          onClose={() => setActionsOpen(false)}
          isSelf={isSelf}
          {...(reactions
            ? {
                // Inline quick-react row at the top of the sheet —
                // one tap = react + close, no second modal needed.
                onPickReaction: (emoji: string) => {
                  void reactionsApi.addReaction(emoji);
                },
              }
            : {})}
          {...(onStartEdit
            ? {
                onEdit: () => {
                  setActionsOpen(false);
                  onStartEdit();
                },
              }
            : {})}
          {...(onDelete
            ? {
                onDelete: () => {
                  setActionsOpen(false);
                  onDelete();
                },
              }
            : {})}
          {...(onOpenThread
            ? {
                onReplyInThread: () => {
                  setActionsOpen(false);
                  onOpenThread();
                },
              }
            : {})}
          {...(quotations && onQuote
            ? {
                onQuote: () => {
                  setActionsOpen(false);
                  onQuote();
                },
              }
            : {})}
        />
      ) : null}
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
  threadPill: {
    alignSelf: 'flex-start',
    marginTop: 2,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  threadPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  reactionsRow: {
    marginTop: 2,
  },
});
