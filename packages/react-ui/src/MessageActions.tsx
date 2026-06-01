// MessageActions — hover-triggered popover with react / reply /
// edit / delete affordances. Lives positioned absolutely next to the
// message bubble; the parent (e.g. ConversationView) decides which
// actions to enable per message based on ownership / capabilities.

import { useState, type ReactNode } from 'react';
import { PoolseIcon } from './PoolseIcon.js';
import { ReactionPicker } from './Reactions.js';

export interface MessageActionsProps {
  /** Triggered when the user picks an emoji. */
  onReact?: (emoji: string) => void;
  /** Triggered when the user wants to reply in thread (opens side-pane). */
  onReply?: () => void;
  /**
   * Triggered when the user wants to quote-reply (WhatsApp-style).
   * Distinct from `onReply`: quote replies stay in the main feed,
   * threads open a side-pane.
   */
  onQuote?: () => void;
  /** Triggered when the user wants to copy the message body to the clipboard. */
  onCopy?: () => void;
  /** Triggered when the user wants to edit. Only show on own messages. */
  onEdit?: () => void;
  /** Triggered when the user wants to delete. Only show on own messages. */
  onDelete?: () => void;
  /** Render any extra trailing action buttons (e.g. "Pin"). */
  children?: ReactNode;
}

export function MessageActions({
  onReact,
  onReply,
  onQuote,
  onCopy,
  onEdit,
  onDelete,
  children,
}: MessageActionsProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="poolse-msg-actions" role="toolbar" aria-label="Message actions">
      {onReact && (
        <>
          <ActionButton
            label="React"
            icon="emoji"
            onClick={() => setPickerOpen((o) => !o)}
            active={pickerOpen}
          />
          {pickerOpen && (
            <div className="poolse-msg-actions__picker">
              <ReactionPicker
                onPick={(emoji) => {
                  setPickerOpen(false);
                  onReact(emoji);
                }}
                onClose={() => setPickerOpen(false)}
              />
            </div>
          )}
        </>
      )}
      {onReply && <ActionButton label="Reply in thread" icon="messages" onClick={onReply} />}
      {onQuote && <ActionButton label="Reply" icon="reply" onClick={onQuote} />}
      {onCopy && <ActionButton label="Copy" icon="copy" onClick={onCopy} />}
      {onEdit && <ActionButton label="Edit" icon="edit" onClick={onEdit} />}
      {onDelete && <ActionButton label="Delete" icon="trash" danger onClick={onDelete} />}
      {children}
    </div>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
  active,
  danger,
}: {
  label: string;
  // Restrict to the iconography we actually use here so the type stays useful.
  icon: 'emoji' | 'reply' | 'messages' | 'edit' | 'trash' | 'more-h' | 'pin' | 'copy';
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  const classes = [
    'poolse-msg-actions__btn',
    active ? 'poolse-msg-actions__btn--active' : null,
    danger ? 'poolse-msg-actions__btn--danger' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type="button" className={classes} aria-label={label} title={label} onClick={onClick}>
      <PoolseIcon name={icon} size={16} label={null} />
    </button>
  );
}
