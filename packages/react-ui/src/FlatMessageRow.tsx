// FlatMessageRow — the `list` (Slack-style) and `compact` (Discord /
// IRC-style) layouts. Full-width, left-aligned rows for everyone's
// messages, built from the same slots as the bubble layout:
//
//   list     [avatar] Name  12:04            ← once per run
//            [ 12:05] body … (time on hover for the rest of the run)
//   compact  12:04 Name  body …              ← every message
//
// Both share the hover toolbar (React · Reply · Thread · More), the
// "N replies" link, reactions, quotes, attachments, edit and delete,
// read receipts and the accent bar on messages that mention the viewer.

import type { Attachment } from '@poolse/sdk';
import { useReactions, useUser } from '@poolse/react';
import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AttachmentPreview } from './AttachmentPreview.js';
import { hasLinkPreviews, MessageLinkPreviews } from './LinkPreviewCard.js';
import { Avatar } from './Avatar.js';
import { emojiFontSize, emojiOnlyCount, hasMarkdown } from './bubbleText.js';
import { EditableMessageBubble } from './EditableMessageBubble.js';
import { useEditHistory } from './EditedLabel.js';
import { formatMessageTime, renderSlot, type MessageSlotContext } from './layout.js';
import { MessageActions } from './MessageActions.js';
import { ImageMosaic, isImageContentType, QuotedCard, QuotedPlaceholder } from './MessageBubble.js';
import type { MessageRowProps, MessageUser } from './MessageRow.js';
import { PoolseIcon } from './PoolseIcon.js';
import { InlineReactions, useRowActions } from './rowParts.js';
import { ThreadSummary } from './ThreadSummary.js';
import { userColor } from './userColor.js';

const TRIM_BUFFER = 40;

export function FlatMessageRow({
  msg,
  meId,
  layout,
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
  onMarkUnread,
  labelFor,
  onQuotedClick,
  groupPosition = 'standalone',
  maxBodyLength = 0,
  markdown = false,
  showAvatar = layout === 'list',
  showPresence = false,
  linkPreviews = true,
  onSenderPress,
  onAvatarPress,
  timeFormat,
  slots,
  mentionsMe = false,
}: MessageRowProps & { layout: 'list' | 'compact' }) {
  const compact = layout === 'compact';
  const isSelf = meId !== null && msg.sender_id === meId;
  const { profile } = useUser(msg.sender_external_id);
  const senderName =
    profile?.displayName ??
    msg.sender_external_id ??
    (msg.sender_id ? `User ${msg.sender_id.slice(0, 6)}` : 'Unknown');
  const sender: MessageUser = {
    userId: msg.sender_id,
    externalId: msg.sender_external_id,
    displayName: senderName,
    avatarUrl: profile?.avatarUrl ?? null,
  };
  // Compact repeats the name on every line, so every line starts a run.
  const isRunStart = compact || groupPosition === 'first' || groupPosition === 'standalone';
  const ctx: MessageSlotContext = { message: msg, isSelf, sender, layout, isRunStart };

  const reactionsHook = useReactions(reactions ? msg.id : '', {
    conversationId: msg.conversation_id,
    initialReactions: msg.reactions,
    currentUserId: meId,
  });
  const { actionsOpen, rowRef, onRowClick } = useRowActions();

  const deleted = !!msg.deleted_at;
  const time = formatMessageTime(msg.inserted_at, timeFormat);
  const replyCount = msg.reply_count ?? 0;
  // A deleted root keeps its thread link: the replies are still there.
  const showThreadLink = threads && !msg.thread_root_id && replyCount > 0;
  const showActions = actions && !deleted && !editing;

  const timeEl = (className: string) => (
    <time className={className} dateTime={msg.inserted_at}>
      {time}
    </time>
  );

  // Others' avatar / name become buttons when the host asks; your own never do.
  const avatarSize = compact ? 'sm' : 'md';
  const avatarEl = (
    <Avatar
      src={sender.avatarUrl}
      name={senderName}
      size={avatarSize}
      {...(showPresence && msg.sender_external_id
        ? { presence: true as const, userId: msg.sender_external_id }
        : {})}
    />
  );
  const avatar = !showAvatar ? null : onAvatarPress && !isSelf ? (
    <button
      type="button"
      className="poolse-row__avatar-button"
      aria-label={senderName}
      onClick={() => onAvatarPress(sender)}
    >
      {avatarEl}
    </button>
  ) : (
    avatarEl
  );

  const nameStyle = compact
    ? { color: userColor(msg.sender_external_id ?? msg.sender_id ?? '') }
    : undefined;
  const name =
    onSenderPress && !isSelf ? (
      <button
        type="button"
        className="poolse-row__name poolse-row__name--button"
        style={nameStyle}
        onClick={() => onSenderPress(sender)}
      >
        {senderName}
      </button>
    ) : (
      <span className="poolse-row__name" style={nameStyle}>
        {senderName}
      </span>
    );

  const header = compact ? (
    name
  ) : isRunStart ? (
    <div className="poolse-row__header">
      {name}
      {timeEl('poolse-row__time')}
    </div>
  ) : null;

  const quote = deleted ? null : msg.quoted_message !== undefined && msg.quoted_message !== null ? (
    <QuotedCard
      quoted={msg.quoted_message}
      isSelf={false}
      {...(labelFor ? { labelFor } : {})}
      {...(onQuotedClick ? { onClick: onQuotedClick } : {})}
    />
  ) : msg.quoted_message_id ? (
    <QuotedPlaceholder isSelf={false} quotedMessageId={msg.quoted_message_id} />
  ) : null;

  const attachmentList: Attachment[] =
    attachments && !deleted && Array.isArray(msg.attachments) ? msg.attachments : [];
  const images = attachmentList.filter((a) => isImageContentType(a.content_type));
  const files = attachmentList.filter((a) => !isImageContentType(a.content_type));
  const attachmentsEl =
    images.length > 0 || files.length > 0 ? (
      <div className="poolse-row__attachments">
        {images.length > 0 && <ImageMosaic images={images} />}
        {files.length > 0 && (
          <div className="poolse-message__files">
            {files.map((att) => (
              <AttachmentPreview key={att.id} attachment={att} />
            ))}
          </div>
        )}
      </div>
    ) : null;

  const editHistory = useEditHistory(msg.id);
  const meta = (
    <>
      {msg.edited_at && !deleted ? (
        <span className="poolse-row__edited">({editHistory.label()})</span>
      ) : null}
      {editHistory.popover}
      {isSelf && readState ? (
        <span className="poolse-row__receipt">
          <PoolseIcon
            name={readState === 'read' ? 'check-double' : 'check'}
            size={14}
            label={readState === 'read' ? 'Read' : 'Sent'}
          />
        </span>
      ) : null}
    </>
  );

  const body = editing ? (
    // `currentUserId={null}` styles the editor as a neutral card rather
    // than an own-message bubble, which would look out of place in a row.
    <EditableMessageBubble
      message={msg}
      currentUserId={null}
      editing
      onSave={onSaveEdit ?? (async () => undefined)}
      onCancel={onCancelEdit ?? (() => undefined)}
    />
  ) : (
    <FlatBody
      message={msg}
      markdown={markdown}
      maxBodyLength={maxBodyLength}
      hasAttachments={attachmentList.length > 0}
      meta={meta}
    />
  );

  const reactionsEl =
    reactions && !deleted ? (
      <InlineReactions
        reactions={reactionsHook.reactions}
        currentUserId={meId}
        onAdd={(e) => void reactionsHook.addReaction(e)}
        onRemove={(e) => void reactionsHook.removeReaction(e)}
      />
    ) : null;

  const threadEl = showThreadLink ? (
    <ThreadSummary
      message={msg}
      className="poolse-row__thread"
      {...(onOpenThread ? { onOpen: onOpenThread } : {})}
    />
  ) : null;

  const toolbar = showActions ? (
    <div className="poolse-row__toolbar">
      <MessageActions
        moreMenu
        {...(reactions ? { onReact: (emoji) => void reactionsHook.addReaction(emoji) } : {})}
        {...(quotations && onQuote ? { onQuote } : {})}
        {...(threads && onOpenThread ? { onReply: onOpenThread } : {})}
        {...(msg.body
          ? {
              onCopy: () => {
                void navigator?.clipboard?.writeText(msg.body ?? '').catch(() => undefined);
              },
            }
          : {})}
        {...(!isSelf && onMarkUnread ? { onMarkUnread } : {})}
        {...(isSelf && onStartEdit ? { onEdit: onStartEdit } : {})}
        {...(isSelf && onDelete ? { onDelete } : {})}
      />
    </div>
  ) : null;

  const content = (
    <div className="poolse-row__content">
      {!compact && renderSlot(slots?.header, ctx, header)}
      {quote}
      {renderSlot(slots?.attachments, ctx, attachmentsEl)}
      {renderSlot(slots?.body, ctx, body)}
      {linkPreviews && !editing && hasLinkPreviews(msg) ? (
        <MessageLinkPreviews message={msg} canRemove={isSelf} />
      ) : null}
      {renderSlot(slots?.reactions, ctx, reactionsEl)}
      {renderSlot(slots?.thread, ctx, threadEl)}
    </div>
  );

  return (
    <div
      ref={rowRef}
      className={[
        'poolse-row',
        `poolse-row--${layout}`,
        isRunStart ? 'poolse-row--run-start' : 'poolse-row--continued',
        isSelf ? 'poolse-row--self' : '',
        mentionsMe ? 'poolse-row--mention' : '',
        editing ? 'poolse-row--editing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-message-id={msg.id}
      data-actions-open={actionsOpen || undefined}
      onClick={onRowClick}
    >
      {compact ? (
        <>
          {timeEl('poolse-row__time')}
          {avatar ? <span className="poolse-row__avatar">{avatar}</span> : null}
          {renderSlot(slots?.header, ctx, header)}
          {content}
        </>
      ) : (
        <>
          <div className="poolse-row__gutter">
            {isRunStart ? avatar : timeEl('poolse-row__gutter-time')}
          </div>
          {content}
        </>
      )}
      {renderSlot(slots?.actions, ctx, toolbar)}
    </div>
  );
}

// The text of a flat row: markdown (or plain), "Read more" trimming,
// big emoji, "Message deleted", with the edited / read meta inline at
// the end.
function FlatBody({
  message,
  markdown,
  maxBodyLength,
  hasAttachments,
  meta,
}: {
  message: MessageRowProps['msg'];
  markdown: boolean;
  maxBodyLength: number;
  hasAttachments: boolean;
  meta: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  if (message.deleted_at) {
    return (
      <div className="poolse-message__body poolse-row__body">
        <span className="poolse-message__body--deleted">This message was deleted</span>
      </div>
    );
  }
  const raw = message.body ?? '';
  if (!raw) {
    return <div className="poolse-row__meta-only">{meta}</div>;
  }
  const long = maxBodyLength > 0 && raw.length > maxBodyLength + TRIM_BUFFER;
  const shown = long && !expanded ? raw.slice(0, maxBodyLength).trimEnd() + '…' : raw;
  const jumbo = !hasAttachments && !message.quoted_message_id ? emojiOnlyCount(raw) : 0;
  const md = markdown && jumbo === 0 && hasMarkdown(shown);

  return (
    <div
      className={
        md
          ? 'poolse-message__body poolse-message__body--md poolse-row__body'
          : 'poolse-message__body poolse-row__body'
      }
    >
      {jumbo > 0 ? (
        <span className="poolse-message__body--jumbo" style={{ fontSize: emojiFontSize(jumbo) }}>
          {shown}
        </span>
      ) : md ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ node: _node, ...props }) => (
              <a {...props} target="_blank" rel="noopener noreferrer nofollow" />
            ),
          }}
        >
          {shown}
        </ReactMarkdown>
      ) : (
        <span>{shown}</span>
      )}
      {long && (
        <button
          type="button"
          className="poolse-message__read-more"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((x) => !x);
          }}
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}
      {meta}
    </div>
  );
}
