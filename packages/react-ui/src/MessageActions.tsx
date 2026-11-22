// MessageActions — hover-triggered popover with react / reply /
// edit / delete affordances. Lives positioned absolutely next to the
// message bubble; the parent (e.g. ConversationView) decides which
// actions to enable per message based on ownership / capabilities.

import { useState, type ReactNode } from 'react';
import type { CustomEmoji } from '@poolse/react';
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
  /** "Mark unread" — others' messages: the read position moves back to this one. */
  onMarkUnread?: () => void;
  /** Triggered when the user wants to edit. Only show on own messages. */
  onEdit?: () => void;
  /** Triggered when the user wants to delete. Only show on own messages. */
  onDelete?: () => void;
  /** Pin or unpin (MS13); `pinned` says which the button does. */
  onTogglePin?: () => void;
  pinned?: boolean;
  /** Forward to other conversations (MS13): open your target picker (`<ForwardDialog>`). */
  onForward?: () => void;
  /** Translate (MS21), or back to the original when `translated`. */
  onTranslate?: () => void;
  translated?: boolean;
  /** The workspace's own emoji for the reaction picker (MS10). */
  customEmoji?: readonly CustomEmoji[];
  /**
   * Slack-style toolbar: React, Reply, Thread, then a "More" button
   * whose menu holds Copy / Edit / Delete. Defaults to `false` (every
   * action as its own button).
   */
  moreMenu?: boolean;
  /** Render any extra trailing action buttons (e.g. "Pin"). */
  children?: ReactNode;
}

export function MessageActions({
  onReact,
  onReply,
  onQuote,
  onCopy,
  onMarkUnread,
  onEdit,
  onDelete,
  moreMenu = false,
  onTogglePin,
  pinned = false,
  onForward,
  onTranslate,
  translated = false,
  customEmoji,
  children,
}: MessageActionsProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const hasMore = !!(
    onCopy ||
    onMarkUnread ||
    onEdit ||
    onDelete ||
    onTogglePin ||
    onForward ||
    onTranslate
  );
  const pinLabel = pinned ? 'Unpin' : 'Pin';
  const translateLabel = translated ? 'Show original' : 'Translate';

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
                {...(customEmoji ? { customEmoji } : {})}
              />
            </div>
          )}
        </>
      )}
      {moreMenu ? (
        <>
          {onQuote && <ActionButton label="Reply" icon="reply" onClick={onQuote} />}
          {onReply && <ActionButton label="Reply in thread" icon="messages" onClick={onReply} />}
          {children}
          {hasMore && (
            <>
              <ActionButton
                label="More actions"
                icon="more-h"
                onClick={() => setMenuOpen((o) => !o)}
                active={menuOpen}
              />
              {menuOpen && (
                <div
                  className="poolse-msg-actions__menu"
                  role="menu"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setMenuOpen(false);
                  }}
                >
                  {[
                    onCopy && { label: 'Copy', icon: 'copy' as const, run: onCopy },
                    onForward && { label: 'Forward', icon: 'send' as const, run: onForward },
                    onTogglePin && { label: pinLabel, icon: 'pin' as const, run: onTogglePin },
                    onTranslate && {
                      label: translateLabel,
                      icon: 'messages' as const,
                      run: onTranslate,
                    },
                    onMarkUnread && {
                      label: 'Mark unread',
                      icon: 'message' as const,
                      run: onMarkUnread,
                    },
                    onEdit && { label: 'Edit', icon: 'edit' as const, run: onEdit },
                    onDelete && { label: 'Delete', icon: 'trash' as const, run: onDelete },
                  ]
                    .filter((item) => !!item)
                    .map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        role="menuitem"
                        className={`poolse-msg-actions__menu-item${
                          item.label === 'Delete' ? ' poolse-msg-actions__menu-item--danger' : ''
                        }`}
                        onClick={() => {
                          setMenuOpen(false);
                          item.run();
                        }}
                      >
                        <PoolseIcon name={item.icon} size={15} label={null} />
                        <span>{item.label}</span>
                      </button>
                    ))}
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          {onReply && <ActionButton label="Reply in thread" icon="messages" onClick={onReply} />}
          {onQuote && <ActionButton label="Reply" icon="reply" onClick={onQuote} />}
          {onCopy && <ActionButton label="Copy" icon="copy" onClick={onCopy} />}
          {onForward && <ActionButton label="Forward" icon="send" onClick={onForward} />}
          {onTogglePin && (
            <ActionButton label={pinLabel} icon="pin" onClick={onTogglePin} active={pinned} />
          )}
          {onTranslate && (
            <ActionButton
              label={translateLabel}
              icon="messages"
              onClick={onTranslate}
              active={translated}
            />
          )}
          {onMarkUnread && (
            <ActionButton label="Mark unread" icon="message" onClick={onMarkUnread} />
          )}
          {onEdit && <ActionButton label="Edit" icon="edit" onClick={onEdit} />}
          {onDelete && <ActionButton label="Delete" icon="trash" danger onClick={onDelete} />}
          {children}
        </>
      )}
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
  icon:
    | 'emoji'
    | 'reply'
    | 'messages'
    | 'message'
    | 'edit'
    | 'trash'
    | 'more-h'
    | 'pin'
    | 'copy'
    | 'send';
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
