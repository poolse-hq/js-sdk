// FlatMessageRow — the `list` (Slack-style) and `compact` (Discord /
// IRC-style) layouts. Full-width, left-aligned rows for everyone's
// messages, built from the same slots as the bubble layout:
//
//   list     [avatar] Name  12:04            ← once per run
//            12:05    body …  (later messages: the time, dimmed, in the gutter)
//   compact  12:04 Name  body …              ← every message
//
// Long-press opens the same actions sheet as a bubble (react, reply,
// thread, copy, edit, delete). Reactions, "N replies", quotes,
// attachments, read ticks and the accent bar on messages that mention
// the viewer work the same in both.

import {
  approvalIdOf,
  citationsOf,
  displayNameOf,
  isTombstone,
  partitionAttachments,
  messageAgent,
  useReactions,
  useUser,
} from '@poolse/react';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { AgentBadgeInline } from './AgentBadge.js';
import { MessageApproval, MessageCitations } from './Agents.js';
import { ClipPlayer } from './Meetings.js';
import { AttachmentPreview } from './AttachmentPreview.js';
import { canShowEditHistory } from './EditHistorySheet.js';
import { ImageMosaic } from './ImageMosaic.js';
import { emojiFontSize, emojiOnlyCount, hasMarkdown } from './internal/bubbleText.js';
import { renderMarkdown } from './internal/markdown.js';
import { formatMessageTime, gutterTime, renderSlot, type MessageSlotContext } from './layout.js';
import { LinkPreviewCard } from './LinkPreviewCard.js';
import { QuotedCard } from './MessageBubble.js';
import {
  RowActionsSheet,
  RowSheets,
  type MessageRowProps,
  type MessageUser,
} from './MessageRow.js';
import { Avatar } from './primitives/Avatar.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
import { userColor } from './primitives/userColor.js';
import { ReactionChips } from './Reactions.js';
import { messageA11yLabel } from './internal/a11y.js';
import { SendStatus } from './SendStatus.js';
import { ThreadSummary } from './ThreadSummary.js';
import { ignoreRolledBack } from './internal/errors.js';
import { useTheme } from './theme/PoolseTheme.js';

const GUTTER = 40;

export function FlatMessageRow({
  msg,
  meId,
  layout,
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
  extraActions,
  onOpenThread,
  onQuote,
  labelFor,
  onQuotedClick,
  groupPosition = 'standalone',
  maxBodyLength = 0,
  showAvatar = layout === 'list',
  avatarFor,
  onSenderPress,
  onAvatarPress,
  density = 'comfortable',
  timeFormat,
  slots,
  mentionsMe = false,
  showPresence = false,
  linkPreviews = true,
  onRemoveLinkPreview,
  onMarkUnread,
  editHistory = true,
  onRetrySend,
  onDiscardSend,
}: MessageRowProps & { layout: 'list' | 'compact' }) {
  const theme = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const compact = layout === 'compact';
  const dense = density === 'compact';
  const isSelf = meId !== null && msg.sender_id === meId;
  const [actionsOpen, setActionsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const reactionsApi = useReactions(msg.id, {
    conversationId: msg.conversation_id,
    currentUserId: meId,
    ...(msg.reactions ? { initialReactions: msg.reactions } : {}),
  });

  // Same priority as the bubble row: explicit prop > userResolver > "Unknown user".
  const resolved = useUser(msg.sender_external_id);
  const senderIsAgent = !!resolved.agent || !!messageAgent(msg);
  const ext = msg.sender_external_id;
  const senderName = displayNameOf(ext, {
    labelFor,
    profileName: resolved.profile?.displayName,
    agentName: resolved.agent?.name,
  });
  const avatarUrl = ext ? (avatarFor?.(ext) ?? resolved.profile?.avatarUrl ?? null) : null;
  const sender: MessageUser = {
    userId: msg.sender_id,
    externalId: ext,
    displayName: senderName,
    avatarUrl,
  };
  // Compact repeats the name on every line, so every line starts a run.
  const isRunStart = compact || groupPosition === 'first' || groupPosition === 'standalone';
  const ctx: MessageSlotContext = { message: msg, isSelf, sender, layout, isRunStart };

  const deleted = isTombstone(msg);
  // Unsent (outbox): not on the server yet, so nothing to act on.
  const inert = deleted || !!msg.local_status;
  const time = formatMessageTime(msg.inserted_at, timeFormat);
  const openActions = () => {
    if (actions && !inert) setActionsOpen(true);
  };
  const text = { fontFamily: theme.fonts.body, color: theme.colors.text };

  // Others' avatar / name become tappable when the host asks; your own never do.
  const avatarEl = showAvatar ? (
    <Avatar
      src={avatarUrl}
      name={senderName}
      seed={ext}
      size={compact ? 'xs' : 'md'}
      agent={senderIsAgent}
      {...(showPresence && ext ? { presence: true as const } : {})}
    />
  ) : null;
  const avatar =
    avatarEl && onAvatarPress && !isSelf ? (
      <Pressable
        onPress={() => onAvatarPress(sender)}
        accessibilityRole="button"
        accessibilityLabel={senderName}
        hitSlop={6}
      >
        {avatarEl}
      </Pressable>
    ) : (
      avatarEl
    );

  const name = (
    <Text
      style={[
        styles.name,
        text,
        compact ? { color: userColor(ext ?? msg.sender_id ?? msg.id) } : null,
        compact ? styles.nameCompact : null,
      ]}
      numberOfLines={1}
      {...(onSenderPress && !isSelf
        ? {
            onPress: () => onSenderPress(sender),
            accessibilityRole: 'button' as const,
            suppressHighlighting: true,
          }
        : {})}
    >
      {senderName}
      {senderIsAgent ? '  ' : ''}
      {senderIsAgent ? <AgentBadgeInline /> : null}
    </Text>
  );
  // `dim` is the time in the avatar gutter (later messages of a run): one
  // line, always — "10:00 PM" is wider than the gutter, so the space goes
  // ("10:00PM") and the text shrinks to fit rather than wrapping.
  const timeText = (dim: boolean) => (
    <Text
      style={[
        styles.time,
        { color: theme.colors.textSubtle, fontFamily: theme.fonts.body },
        dim ? styles.timeDim : null,
      ]}
      {...(dim ? { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.6 } : {})}
    >
      {dim ? gutterTime(time) : time}
    </Text>
  );

  const header = compact ? (
    name
  ) : isRunStart ? (
    <View style={styles.header}>
      {name}
      {timeText(false)}
    </View>
  ) : null;

  const { images, files, clips } = partitionAttachments(
    attachments && !deleted ? msg.attachments : [],
  );
  const citations = citationsOf(msg);
  const approvalId = approvalIdOf(msg);
  const mediaWidth = Math.min(screenWidth - GUTTER - 48, 320);
  const attachmentsEl =
    images.length > 0 || files.length > 0 || clips.length > 0 ? (
      <View style={styles.attachments}>
        {images.length > 0 ? (
          <ImageMosaic
            images={images}
            maxWidth={mediaWidth}
            radius={theme.radii.md}
            onLongPress={openActions}
          />
        ) : null}
        {files.map((att) => (
          <AttachmentPreview key={att.id} attachment={att} maxWidth={mediaWidth} />
        ))}
        {clips.map((att) => (
          <ClipPlayer key={att.id} attachment={att} compact />
        ))}
      </View>
    ) : null;

  const raw = msg.body ?? '';
  const trimmable = maxBodyLength > 0 && raw.length > maxBodyLength;
  const shown = trimmable && !expanded ? raw.slice(0, maxBodyLength) + '…' : raw;
  const previews = linkPreviews && !deleted ? (msg.link_previews ?? []) : [];
  const jumbo =
    raw &&
    images.length === 0 &&
    files.length === 0 &&
    previews.length === 0 &&
    !msg.quoted_message_id
      ? emojiOnlyCount(raw)
      : 0;
  const bodyText = {
    ...text,
    fontSize: dense ? theme.fonts.sizeMd - 1 : theme.fonts.sizeMd,
    lineHeight: dense ? theme.fonts.lineHeight - 3 : theme.fonts.lineHeight,
  };

  const edited = !!msg.edited_at && !deleted;
  const meta =
    edited || (isSelf && readState) ? (
      <View style={styles.meta}>
        {edited ? (
          <Text
            style={[styles.edited, { color: theme.colors.textSubtle }]}
            {...(editHistory && canShowEditHistory(msg.id)
              ? {
                  onPress: () => setHistoryOpen(true),
                  suppressHighlighting: true,
                  accessibilityRole: 'button' as const,
                  accessibilityLabel: 'Edited. Show edit history',
                  hitSlop: 8,
                }
              : {})}
          >
            (edited)
          </Text>
        ) : null}
        {isSelf && readState ? (
          <PoolseIcon
            name={readState === 'read' ? 'check-double' : 'check'}
            size={13}
            color={readState === 'read' ? theme.colors.accent : theme.colors.textSubtle}
          />
        ) : null}
      </View>
    ) : null;

  const body = deleted ? (
    <Text style={[bodyText, styles.deleted, { color: theme.colors.textMuted }]}>
      This message was deleted
    </Text>
  ) : raw ? (
    <View>
      {jumbo > 0 ? (
        <Text style={{ fontSize: emojiFontSize(jumbo), lineHeight: emojiFontSize(jumbo) + 8 }}>
          {raw}
        </Text>
      ) : markdown && hasMarkdown(shown) ? (
        renderMarkdown(shown, {
          textColor: bodyText.color,
          linkColor: theme.colors.link,
          fontFamily: theme.fonts.body,
          fontSize: bodyText.fontSize,
          lineHeight: bodyText.lineHeight,
          onLinkPress: (url: string) => {
            void Linking.openURL(url).catch(() => undefined);
            return false;
          },
        })
      ) : (
        <Text style={bodyText}>{shown}</Text>
      )}
      {trimmable ? (
        <Pressable onPress={() => setExpanded((e) => !e)}>
          <Text style={[styles.readMore, { color: theme.colors.link }]}>
            {expanded ? 'Show less' : 'Read more'}
          </Text>
        </Pressable>
      ) : null}
      {previews.length > 0 ? (
        <View style={styles.previews}>
          {previews.map((p) => (
            <LinkPreviewCard
              key={p.url}
              preview={p}
              maxWidth={mediaWidth}
              onLongPress={openActions}
            />
          ))}
        </View>
      ) : null}
      {meta}
    </View>
  ) : (
    meta
  );

  const replyCount = msg.reply_count ?? 0;
  const threadEl =
    // Kept on a deleted root: its replies are still there.
    threads && !msg.thread_root_id && replyCount > 0 && onOpenThread ? (
      <ThreadSummary
        message={msg}
        onPress={onOpenThread}
        {...(labelFor ? { labelFor } : {})}
        {...(avatarFor ? { avatarFor } : {})}
      />
    ) : null;

  const reactionsEl =
    reactions && !inert ? (
      <View style={styles.reactions}>
        <ReactionChips
          reactions={reactionsApi.reactions}
          meId={meId}
          onAdd={reactionsApi.addReaction}
          onRemove={reactionsApi.removeReaction}
          {...(actions ? { onMorePress: () => setEmojiOpen(true) } : {})}
        />
      </View>
    ) : null;

  const quote = msg.quoted_message ? (
    <QuotedCard
      quoted={msg.quoted_message}
      isSelf={false}
      {...(labelFor ? { labelFor } : {})}
      {...(onQuotedClick ? { onPress: () => onQuotedClick(msg.quoted_message!.id) } : {})}
    />
  ) : null;

  const content = (
    <View style={styles.content}>
      {!compact ? renderSlot(slots?.header, ctx, header) : null}
      {quote}
      {renderSlot(slots?.attachments, ctx, attachmentsEl)}
      {renderSlot(slots?.body, ctx, body)}
      {citations.length > 0 ? <MessageCitations message={msg} citations={citations} /> : null}
      {approvalId ? <MessageApproval approvalId={approvalId} agentName={senderName} /> : null}
      {renderSlot(slots?.reactions, ctx, reactionsEl)}
      {renderSlot(slots?.thread, ctx, threadEl)}
      <SendStatus
        message={msg}
        alignEnd={false}
        {...(onRetrySend ? { onRetry: onRetrySend } : {})}
        {...(onDiscardSend ? { onDiscard: onDiscardSend } : {})}
      />
    </View>
  );

  const sheet =
    actions && actionsOpen && !inert ? (
      <RowActionsSheet
        msg={msg}
        isSelf={isSelf}
        close={() => setActionsOpen(false)}
        reactions={reactions}
        addReaction={(emoji) => void reactionsApi.addReaction(emoji).catch(ignoreRolledBack)}
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
        extraActions={extraActions}
      />
    ) : null;

  return (
    <View
      style={[
        styles.row,
        compact ? styles.rowCompact : null,
        dense ? styles.rowDense : null,
        !compact && isRunStart ? (dense ? styles.runStartDense : styles.runStart) : null,
        mentionsMe
          ? { backgroundColor: theme.colors.mention, borderLeftColor: theme.colors.accent }
          : null,
        isEditing ? styles.rowEditing : null,
      ]}
    >
      <Pressable
        onLongPress={openActions}
        style={[styles.line, compact ? styles.lineCompact : null]}
        accessibilityLabel={messageA11yLabel(msg, senderName, isSelf)}
        {...(actions && !inert
          ? {
              accessibilityHint: 'Long press for message actions',
              accessibilityActions: [{ name: 'longpress', label: 'Message actions' }],
              onAccessibilityAction: openActions,
            }
          : {})}
      >
        {compact ? (
          <>
            {timeText(false)}
            {avatar ? <View style={styles.avatarCompact}>{avatar}</View> : null}
            {renderSlot(slots?.header, ctx, header)}
            {content}
          </>
        ) : (
          <>
            <View style={styles.gutter}>{isRunStart ? avatar : timeText(true)}</View>
            {content}
          </>
        )}
      </Pressable>
      {renderSlot(slots?.actions, ctx, sheet)}
      <RowSheets
        msg={msg}
        emojiOpen={emojiOpen}
        onCloseEmoji={() => setEmojiOpen(false)}
        onPickEmoji={(emoji) => void reactionsApi.addReaction(emoji).catch(ignoreRolledBack)}
        historyOpen={historyOpen}
        onCloseHistory={() => setHistoryOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    // 3px left border reserved for the mention accent bar.
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
    paddingLeft: 9,
    paddingRight: 12,
    paddingVertical: 2,
  },
  rowCompact: {
    paddingVertical: 1,
  },
  rowDense: {
    paddingVertical: 0,
  },
  runStart: {
    marginTop: 8,
    paddingTop: 4,
  },
  runStartDense: {
    marginTop: 4,
    paddingTop: 2,
  },
  rowEditing: {
    // Above ConversationView's edit backdrop, like the bubble row.
    zIndex: 10,
    elevation: 10,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  lineCompact: {
    gap: 6,
  },
  gutter: {
    width: GUTTER,
    alignItems: 'center',
  },
  avatarCompact: {
    marginTop: 1,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  name: {
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
  },
  nameCompact: {
    maxWidth: '35%',
    flexShrink: 0,
  },
  time: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    lineHeight: 20,
  },
  timeDim: {
    fontSize: 10,
    opacity: 0.7,
    // Fill the gutter so shrink-to-fit measures against its width.
    width: GUTTER,
    textAlign: 'center',
  },
  attachments: {
    marginVertical: 4,
    gap: 4,
  },
  deleted: {
    fontStyle: 'italic',
  },
  readMore: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  edited: {
    fontSize: 11,
  },
  previews: {
    marginTop: 6,
    gap: 6,
  },
  reactions: {
    marginTop: 4,
    alignSelf: 'flex-start',
  },
});
