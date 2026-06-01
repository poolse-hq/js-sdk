// MessageRow — one fully-featured row in a message list. Owns its
// own `useReactions` instance so the inline reaction strip AND the
// hover-menu emoji picker share one state — adds land once, the
// realtime echo upserts. Used internally by `<ConversationView>` and
// `<ThreadView>`.
//
// Customers building a custom layout can import this directly to
// reuse the full feature surface (reactions, attachments, hover
// actions, edit/delete, read receipts) without re-wiring.

import type { Attachment, Message, Uuid } from '@poolse/sdk';
import { useReactions } from '@poolse/react';
import { AttachmentPreview } from './AttachmentPreview.js';
import { EditableMessageBubble } from './EditableMessageBubble.js';
import { MessageActions } from './MessageActions.js';
import { MessageBubble } from './MessageBubble.js';
import { PoolseIcon } from './PoolseIcon.js';

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
}: MessageRowProps) {
  const isSelf = meId !== null && msg.sender_id === meId;

  // Single useReactions instance — both the inline strip and the
  // hover-menu emoji picker use addReaction below. Without sharing,
  // the picker button is decorative.
  const reactionsHook = useReactions(reactions ? msg.id : '', {
    conversationId: msg.conversation_id,
    initialReactions: msg.reactions,
    currentUserId: meId,
  });

  const showReactions = reactions && !msg.deleted_at;
  const showAttachments =
    attachments && Array.isArray(msg.attachments) && msg.attachments.length > 0;
  const showActions = actions && !msg.deleted_at && !editing;
  // Thread pill: only show on the root message of an existing thread
  // (i.e. when reply_count > 0 AND this message isn't itself a reply).
  // ThreadView passes threads={false} so the pill won't show inside the
  // thread side-pane.
  const replyCount = msg.reply_count ?? 0;
  const showThreadPill = threads && !msg.deleted_at && !msg.thread_root_id && replyCount > 0;

  const handleSave = onSaveEdit ?? (async () => undefined);
  const handleCancel = onCancelEdit ?? (() => undefined);

  return (
    <div
      className={`poolse-message-row ${isSelf ? 'poolse-message-row--right' : ''}`}
      // data-message-id lets `<ConversationView>`'s scroll-to-original
      // querySelector find this row without an extra wrapper div in
      // between. The wrapper version broke flex alignment because it
      // took 100% width and left an empty band to the right of self
      // bubbles.
      data-message-id={msg.id}
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
        <MessageBubble
          message={msg}
          currentUserId={meId}
          {...(readState ? { readState } : {})}
          {...(labelFor ? { labelFor } : {})}
          {...(onQuotedClick ? { onQuotedClick } : {})}
        />
      )}

      {showAttachments && (
        <div className={`poolse-message-row__attachments ${isSelf ? 'is-self' : ''}`}>
          {msg.attachments!.map((att: Attachment) => (
            <AttachmentPreview key={att.id} attachment={att} />
          ))}
        </div>
      )}

      {showReactions && (
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
      )}

      {showThreadPill && (
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
      )}

      {showActions && (
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
      )}
    </div>
  );
}

// Stripped-down ReactionStrip that uses an external addReaction/
// removeReaction (rather than calling useReactions internally). Lets
// MessageRow share one useReactions across the strip + the hover
// picker. Picker disabled on this internal variant; the hover menu
// handles "add reaction" instead.
function InlineReactions({
  reactions,
  currentUserId,
  onAdd: _onAdd,
  onRemove,
}: {
  reactions: Record<string, string[]>;
  currentUserId: string | null;
  onAdd: (emoji: string) => void;
  onRemove: (emoji: string) => void;
}) {
  const entries = Object.entries(reactions);
  if (entries.length === 0) return null;
  return (
    <div className="poolse-reactions">
      {entries.map(([emoji, users]) => {
        const mine =
          currentUserId !== null && currentUserId !== undefined && users.includes(currentUserId);
        return (
          <button
            key={emoji}
            type="button"
            className={`poolse-reaction-pill${mine ? ' poolse-reaction-pill--mine' : ''}`}
            onClick={() => {
              if (mine) onRemove(emoji);
              else _onAdd(emoji);
            }}
            aria-pressed={mine}
            aria-label={`${emoji} reacted by ${users.length} ${users.length === 1 ? 'user' : 'users'}`}
          >
            <span>{emoji}</span>
            <span className="poolse-reaction-pill__count">{users.length}</span>
          </button>
        );
      })}
    </div>
  );
}
