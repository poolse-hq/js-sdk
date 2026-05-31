import type { Message } from '@poolse/sdk';
import { PoolseIcon } from './PoolseIcon.js';

export interface MessageBubbleProps {
  message: Message;
  /** Used to decide left/right alignment + color, and whether to show the read-receipt glyph. */
  currentUserId: string | null;
  /**
   * Show the read-receipt check-double on self-sent messages. Pass
   * `true` when at least one other member's `last_read_message_id`
   * is >= this message's sequence. Single-tick + double-tick variants
   * map to "sent" and "read" respectively per brand conventions.
   */
  readState?: 'sent' | 'read';
}

/**
 * One message bubble. The default renderer for `<ConversationView>` —
 * customers swap it out via `renderMessage` for full visual control
 * without rebuilding the rest of the chat.
 *
 * Styling: 16px radius bubble with a 5px tail on the sender's side
 * (coral for self, surface-with-border for others), matching the
 * brand-kit chat showcase.
 */
export function MessageBubble({ message, currentUserId, readState }: MessageBubbleProps) {
  const isSelf = currentUserId !== null && message.sender_id === currentUserId;

  const className = [
    'poolse-message',
    isSelf ? 'poolse-message--self' : 'poolse-message--other',
  ].join(' ');

  const time = message.inserted_at
    ? new Date(message.inserted_at).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  return (
    <div className={className}>
      {message.deleted_at ? (
        <span className="poolse-message__body--deleted">[deleted]</span>
      ) : (
        <span>{message.body ?? ''}</span>
      )}
      <span className="poolse-message__meta">
        <span>{time}</span>
        {message.edited_at ? <span> · edited</span> : null}
        {/* Read-receipt glyph — only meaningful for self-sent rows.
            Single check = delivered, double = at least one recipient
            has advanced their read cursor past this message. */}
        {isSelf && readState ? (
          <PoolseIcon
            name={readState === 'read' ? 'check-double' : 'check'}
            size={14}
            label={readState === 'read' ? 'Read' : 'Sent'}
          />
        ) : null}
      </span>
    </div>
  );
}
