// MessageRow — one fully-featured row in a message list. Owns its
// own `useReactions` instance so the inline reaction strip AND the
// hover-menu emoji picker share one state — adds land once, the
// realtime echo upserts. Used internally by `<ConversationView>` and
// `<ThreadView>`.
//
// Customers building a custom layout can import this directly to
// reuse the full feature surface (reactions, attachments, hover
// actions, edit/delete, read receipts) without re-wiring.
//
// `layout` picks the shape: `bubbles` renders here, `list` and
// `compact` in ./FlatMessageRow.tsx. All three take the same props
// and the same `slots`.

import type { Message, Uuid } from '@poolse/sdk';
import { callLogDisplayFor, useReactions, useUser } from '@poolse/react';
import { type ReactNode } from 'react';
import { Avatar } from './Avatar.js';
import { CallLogRow } from './CallLogRow.js';
import { EditableMessageBubble } from './EditableMessageBubble.js';
import { FlatMessageRow } from './FlatMessageRow.js';
import {
  renderSlot,
  type ChatLayout,
  type MessageSlotContext,
  type MessageSlots,
  type TimeFormat,
} from './layout.js';
import { MessageActions } from './MessageActions.js';
import { MessageBubble, type BubbleGroupPosition } from './MessageBubble.js';
import { PoolseIcon } from './PoolseIcon.js';
import { InlineReactions, useRowActions } from './rowParts.js';

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
  /** Current user's id. Drives self-vs-other styling + edit/delete affordances. */
  meId: string | null;

  // Feature toggles — same set as ConversationView's, but per-row.
  reactions?: boolean;
  attachments?: boolean;
  actions?: boolean;
  /** Pass false in ThreadView since nested threads aren't a thing in v1. */
  threads?: boolean;
  /** WhatsApp-style quote-reply. Defaults true on ConversationView. */
  quotations?: boolean;

  /** Set to `'sent' | 'read'` to render the read-receipt glyph on self messages. */
  readState?: 'sent' | 'read';

  /** Inline-edit state — caller controls. */
  editing?: boolean;
  onStartEdit?: () => void;
  onCancelEdit?: () => void;
  onSaveEdit?: (body: string) => Promise<unknown> | void;
  onDelete?: () => void;
  onOpenThread?: () => void;
  /** Quote-reply pressed. Caller stores the message id and renders the composer chip. */
  onQuote?: () => void;
  /** Caller-supplied display-name lookup for the quoted-card sender. */
  labelFor?: (userId: Uuid) => string;
  /** Click on the quoted card — typically scroll-to-original. */
  onQuotedClick?: (quotedMessageId: Uuid) => void;
  /** Where this bubble sits in a same-sender cluster (WhatsApp-style grouping). */
  groupPosition?: BubbleGroupPosition;
  /** Trim threshold for long messages. 0 disables. */
  maxBodyLength?: number;
  /** Render body as GitHub-flavored Markdown. */
  markdown?: boolean;
  /**
   * Show a colored sender label above the bubble body (other-side
   * only, first / standalone bubbles only). Powered by the SDK's
   * `useUser` hook via the customer's `userResolver`.
   */
  showSenderName?: boolean;
  /**
   * Render an avatar to the LEFT of other-side bubbles. The avatar
   * appears on the LAST / STANDALONE bubble of a cluster;
   * continuation bubbles keep an empty slot the same width so the
   * column stays aligned. Self bubbles get no avatar — your own
   * identity is implicit from the bubble color/side.
   */
  showAvatar?: boolean;
  /**
   * Presence badges on the sender avatars (see `showAvatar`). Defaults
   * to `false`.
   */
  showPresence?: boolean;
  /** Makes the sender label a button (other people's messages). */
  onSenderPress?: (user: MessageUser) => void;
  /** Makes the avatar a button (other people's messages). */
  onAvatarPress?: (user: MessageUser) => void;
  /** Call-log rows: offer "Call back" (see `<CallLogRow onCallBack>`). */
  onCallBack?: (media: 'audio' | 'video') => void;
  /** `'bubbles'` (default), `'list'` or `'compact'` — see `ChatLayout`. */
  layout?: ChatLayout;
  /** `'12h'`, `'24h'` or a formatter for timestamps. Defaults to the locale's. */
  timeFormat?: TimeFormat;
  /** Replace or wrap parts of the row — see `MessageSlots`. */
  slots?: MessageSlots;
  /**
   * The message @-mentions the viewer: `list` and `compact` mark it
   * with an accent bar.
   */
  mentionsMe?: boolean;
}

export function MessageRow(props: MessageRowProps) {
  // Call-log system messages render as a centered compact line with
  // no bubble / reactions / actions. `undefined` = not a call log;
  // `null` = a call log hidden for this viewer (someone else's
  // missed-call marker). Split into its own component so the bubble
  // row's hooks never run conditionally.
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
  markdown = false,
  showSenderName = false,
  showAvatar = false,
  showPresence = false,
  onSenderPress,
  onAvatarPress,
  timeFormat,
  slots,
}: MessageRowProps) {
  // Resolve the sender once at the row level so both the avatar slot
  // (rendered here) and the bubble's inline sender label (rendered
  // by `<MessageBubble>` which calls `useUser` itself) hit the same
  // dedup'd cache — keyed, like every resolver lookup, by external id.
  const { profile: senderProfile } = useUser(msg.sender_external_id);
  const senderFallbackName =
    msg.sender_external_id ?? (msg.sender_id ? `User ${msg.sender_id.slice(0, 6)}` : 'Unknown');
  const senderName = senderProfile?.displayName ?? senderFallbackName;
  const isSelf = meId !== null && msg.sender_id === meId;
  const sender: MessageUser = {
    userId: msg.sender_id,
    externalId: msg.sender_external_id,
    displayName: senderName,
    avatarUrl: senderProfile?.avatarUrl ?? null,
  };

  // Single useReactions instance — both the inline strip and the
  // hover-menu emoji picker use addReaction below. Without sharing,
  // the picker button is decorative.
  const reactionsHook = useReactions(reactions ? msg.id : '', {
    conversationId: msg.conversation_id,
    initialReactions: msg.reactions,
    currentUserId: meId,
  });

  const showReactions = reactions && !msg.deleted_at;
  const showActions = actions && !msg.deleted_at && !editing;
  // Thread pill: only show on the root message of an existing thread
  // (i.e. when reply_count > 0 AND this message isn't itself a reply).
  // ThreadView passes threads={false} so the pill won't show inside the
  // thread side-pane. A deleted root keeps it: the replies are still there.
  const replyCount = msg.reply_count ?? 0;
  const showThreadPill = threads && !msg.thread_root_id && replyCount > 0;

  const handleSave = onSaveEdit ?? (async () => undefined);
  const handleCancel = onCancelEdit ?? (() => undefined);

  // Touch reveal: tapping the bubble toggles the action toolbar.
  const { actionsOpen, setActionsOpen, rowRef, onRowClick } = useRowActions();

  const slotContext: MessageSlotContext = {
    message: msg,
    isSelf,
    sender,
    layout: 'bubbles',
    isRunStart: groupPosition === 'first' || groupPosition === 'standalone',
  };

  return (
    <div
      ref={rowRef}
      className={[
        'poolse-message-row',
        isSelf ? 'poolse-message-row--right' : '',
        // Modifier mirrors the bubble's groupPosition so the CSS can
        // tighten the inter-bubble gap inside a cluster (first/middle/
        // last) and widen it between clusters (standalone or the
        // first of a new run).
        `poolse-message-row--${groupPosition}`,
      ]
        .filter(Boolean)
        .join(' ')}
      data-message-id={msg.id}
      data-actions-open={actionsOpen || undefined}
      data-avatar={showAvatar && !isSelf ? true : undefined}
      onClick={onRowClick}
    >
      {editing ? (
        <EditableMessageBubble
          message={msg}
          currentUserId={meId}
          {...(readState ? { readState } : {})}
          editing
          onSave={handleSave}
          onCancel={handleCancel}
        />
      ) : (
        <BubbleWithAvatar
          isSelf={isSelf}
          showAvatar={showAvatar}
          groupPosition={groupPosition}
          senderName={senderName}
          avatarUrl={senderProfile?.avatarUrl ?? null}
          presenceId={showPresence ? msg.sender_external_id : null}
          {...(onAvatarPress ? { onAvatarPress: () => onAvatarPress(sender) } : {})}
        >
          <MessageBubble
            message={msg}
            currentUserId={meId}
            groupPosition={groupPosition}
            maxBodyLength={maxBodyLength}
            markdown={markdown}
            showSenderName={showSenderName}
            {...(onSenderPress ? { onSenderPress: () => onSenderPress(sender) } : {})}
            showAttachments={attachments}
            {...(readState ? { readState } : {})}
            {...(labelFor ? { labelFor } : {})}
            {...(onQuotedClick ? { onQuotedClick } : {})}
            {...(timeFormat ? { timeFormat } : {})}
            {...(slots ? { slots, slotContext } : {})}
            {...(showActions
              ? {
                  actionsTrigger: (
                    <button
                      type="button"
                      className="poolse-message__chevron"
                      aria-label="Show message actions"
                      aria-expanded={actionsOpen}
                      onClick={(e) => {
                        // Chevron is a child of the row but we don't want the
                        // row's tap-to-toggle to also fire on mobile (chevron
                        // is hidden there anyway, but defensive).
                        e.stopPropagation();
                        setActionsOpen((o) => !o);
                      }}
                    >
                      <PoolseIcon name="chevron-down" size={14} label={null} />
                    </button>
                  ),
                }
              : {})}
          />
        </BubbleWithAvatar>
      )}

      {renderSlot(
        slots?.reactions,
        slotContext,
        showReactions ? (
          <div className={`poolse-message-row__reactions ${isSelf ? 'is-self' : ''}`}>
            {/* Render reactions from the shared hook's state directly so
                they update in tandem with the hover-menu picker. */}
            <InlineReactions
              reactions={reactionsHook.reactions}
              currentUserId={meId}
              onAdd={(e) => void reactionsHook.addReaction(e)}
              onRemove={(e) => void reactionsHook.removeReaction(e)}
            />
          </div>
        ) : null,
      )}

      {renderSlot(
        slots?.thread,
        slotContext,
        showThreadPill ? (
          <button
            type="button"
            className={`poolse-thread-pill ${
              isSelf ? 'poolse-thread-pill--right' : 'poolse-thread-pill--left'
            }`}
            onClick={onOpenThread}
            aria-label={`View ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}
          >
            <PoolseIcon name="messages" size={12} label={null} />
            <span>
              {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
            </span>
          </button>
        ) : null,
      )}

      {renderSlot(
        slots?.actions,
        slotContext,
        showActions ? (
          <div
            className={`poolse-message-row__actions ${
              isSelf ? 'poolse-message-row__actions--right' : 'poolse-message-row__actions--left'
            }`}
          >
            <MessageActions
              {...(reactions
                ? {
                    onReact: (emoji) => {
                      void reactionsHook.addReaction(emoji);
                    },
                  }
                : {})}
              {...(threads && onOpenThread ? { onReply: onOpenThread } : {})}
              {...(quotations && onQuote ? { onQuote } : {})}
              {...(msg.body
                ? {
                    onCopy: () => {
                      // Best-effort: navigator.clipboard isn't available in
                      // older browsers / non-HTTPS contexts. Caller can wire
                      // its own toast via the SDK if needed; we just fail
                      // silently here rather than throw inside an onClick.
                      void navigator?.clipboard?.writeText(msg.body ?? '').catch(() => undefined);
                    },
                  }
                : {})}
              {...(isSelf && onStartEdit ? { onEdit: onStartEdit } : {})}
              {...(isSelf && onDelete ? { onDelete } : {})}
            />
          </div>
        ) : null,
      )}
    </div>
  );
}

// Wraps the bubble in a flex row with an avatar slot to the left
// (other-side bubbles only). Self bubbles and group-chat-off
// configurations pass through unchanged.
//
// The slot is ALWAYS the same width (28px + 6px gap) when `showAvatar`
// is on — even on continuation bubbles where the avatar itself is
// hidden — so the column stays aligned across a multi-bubble cluster.
function BubbleWithAvatar({
  isSelf,
  showAvatar,
  groupPosition,
  senderName,
  avatarUrl,
  presenceId,
  onAvatarPress,
  children,
}: {
  isSelf: boolean;
  showAvatar: boolean;
  groupPosition: BubbleGroupPosition;
  senderName: string;
  avatarUrl: string | null;
  presenceId: string | null;
  onAvatarPress?: () => void;
  children: ReactNode;
}) {
  if (isSelf || !showAvatar) return <>{children}</>;

  const isLastOfCluster = groupPosition === 'last' || groupPosition === 'standalone';
  const avatar = (
    <Avatar
      src={avatarUrl}
      name={senderName}
      size="sm"
      {...(presenceId ? { presence: true as const, userId: presenceId } : {})}
    />
  );

  return (
    <div className="poolse-bubble-shell">
      <div className="poolse-bubble-shell__avatar">
        {!isLastOfCluster ? null : onAvatarPress ? (
          <button
            type="button"
            className="poolse-bubble-shell__avatar-button"
            aria-label={senderName}
            onClick={onAvatarPress}
          >
            {avatar}
          </button>
        ) : (
          avatar
        )}
      </div>
      {children}
    </div>
  );
}
