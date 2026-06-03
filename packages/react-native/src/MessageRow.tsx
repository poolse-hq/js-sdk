import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Message, Uuid } from '@poolse/sdk';
import { useState, type ReactNode } from 'react';

import { Avatar } from './primitives/Avatar.js';
import { EditableMessageBubble } from './EditableMessageBubble.js';
import { MessageActions } from './MessageActions.js';
import { MessageBubble, type BubbleGroupPosition } from './MessageBubble.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

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
        <Pressable
          onLongPress={() => actions && setActionsOpen(true)}
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
