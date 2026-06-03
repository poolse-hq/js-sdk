import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import type { Message, Uuid } from '@poolse/sdk';
import { useMemo, useRef, useState, type ReactNode } from 'react';

import { Avatar } from './primitives/Avatar.js';
import { EditableMessageBubble } from './EditableMessageBubble.js';
import { MessageActions } from './MessageActions.js';
import { MessageBubble, type BubbleGroupPosition } from './MessageBubble.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

// Swipe-to-reply triggers at this many pixels of horizontal pull.
// WhatsApp uses ~70; iMessage ~60. 60 feels right on the iPhone 14
// pro — short enough for a thumb-only one-handed motion, long enough
// not to fire on accidental scroll-margin drift.
const SWIPE_REPLY_THRESHOLD = 60;
// Soft 8ms tap to confirm "you crossed the threshold, releasing will
// open the reply chip." Mirrors WhatsApp; short enough to not trigger
// iOS's audible vibration thud.
function quietHaptic() {
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    Vibration.vibrate(8);
  }
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

  // Swipe-to-reply state. The bubble's translateX is driven by a pan
  // gesture; when the user releases past SWIPE_REPLY_THRESHOLD we fire
  // onQuote (which the parent wires to setReplyingTo on the composer).
  // Animation runs on the JS thread because we need to read the value
  // synchronously on release — native driver would prevent that.
  const translateX = useRef(new Animated.Value(0)).current;
  const hapticFiredRef = useRef(false);
  const swipeEnabled = quotations && !!onQuote && !editing;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => {
          if (!swipeEnabled) return false;
          // Only claim the gesture for clear horizontal pulls — let
          // vertical scrolls flow through to the FlatList.
          return Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 2;
        },
        onPanResponderMove: (_, g) => {
          // Other-side bubbles swipe right; self bubbles swipe left.
          // Multiply by 0.6 so the drag feels rubber-banded.
          const raw = isSelf ? Math.min(0, g.dx) : Math.max(0, g.dx);
          translateX.setValue(raw * 0.6);
          // Haptic the moment we cross the threshold (once per drag).
          if (!hapticFiredRef.current && Math.abs(raw) >= SWIPE_REPLY_THRESHOLD) {
            hapticFiredRef.current = true;
            try {
              quietHaptic();
            } catch {
              /* no-op */
            }
          }
        },
        onPanResponderRelease: (_, g) => {
          const past = Math.abs(g.dx) >= SWIPE_REPLY_THRESHOLD;
          hapticFiredRef.current = false;
          if (past && onQuote) onQuote();
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: false,
            speed: 18,
            bounciness: 6,
          }).start();
        },
        onPanResponderTerminate: () => {
          hapticFiredRef.current = false;
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: false,
            speed: 18,
            bounciness: 6,
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

        {reactions && msg.reactions && Object.keys(msg.reactions).length > 0 ? (
          <View style={styles.reactionsRow}>
            {Object.entries(msg.reactions).map(([emoji, userIds]) => (
              <View
                key={emoji}
                style={[
                  styles.reactionChip,
                  {
                    backgroundColor: theme.colors.surface2,
                    borderColor: theme.colors.border,
                  },
                ]}
              >
                <Text style={styles.reactionEmoji}>{emoji}</Text>
                <Text style={[styles.reactionCount, { color: theme.colors.ink2 }]}>
                  {Array.isArray(userIds) ? userIds.length : 0}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {actions && actionsOpen ? (
        <MessageActions
          visible={actionsOpen}
          onClose={() => setActionsOpen(false)}
          isSelf={isSelf}
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
    marginVertical: 2,
    paddingHorizontal: 8,
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
    gap: 4,
  },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  reactionEmoji: {
    fontSize: 13,
    marginRight: 3,
  },
  reactionCount: {
    fontSize: 11,
    fontWeight: '600',
  },
});
