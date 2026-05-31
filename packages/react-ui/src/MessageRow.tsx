// MessageRow — one fully-featured row in a message list. Owns its
// own `useReactions` instance so the inline reaction strip AND the
// hover-menu emoji picker share one state — adds land once, the
// realtime echo upserts. Used internally by `<ConversationView>` and
// `<ThreadView>`.
//
// Customers building a custom layout can import this directly to
// reuse the full feature surface (reactions, attachments, hover
// actions, edit/delete, read receipts) without re-wiring.

import type { Attachment, Message } from '@poolse/sdk';
import { useReactions } from '@poolse/react';
import { type ReactNode } from 'react';
import { AttachmentPreview } from './AttachmentPreview.js';
import { EditableMessageBubble } from './EditableMessageBubble.js';
import { MessageActions } from './MessageActions.js';
import { MessageBubble } from './MessageBubble.js';
import { ReactionStrip } from './Reactions.js';

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

  /** Set to `'sent' | 'read'` to render the read-receipt glyph on self messages. */
  readState?: 'sent' | 'read';

  /** Inline-edit state — caller controls. */
  editing?: boolean;
  onStartEdit?: () => void;
  onCancelEdit?: () => void;
  onSaveEdit?: (body: string) => Promise<unknown> | void;
  onDelete?: () => void;
  onOpenThread?: () => void;
}

export function MessageRow({
  msg,
  meId,
  reactions = true,
  attachments = true,
  actions = true,
  threads = true,
  readState,
  editing = false,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onOpenThread,
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

  const handleSave = onSaveEdit ?? (async () => undefined);
  const handleCancel = onCancelEdit ?? (() => undefined);

  return (
    <div className={`poolse-message-row ${isSelf ? 'poolse-message-row--right' : ''}`}>
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
        <MessageBubble message={msg} currentUserId={meId} {...(readState ? { readState } : {})} />
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
