import type { Message, QuotedMessagePreview, Uuid } from '@poolse/sdk';
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
  /**
   * Optional friendly label for a quoted message's sender. Same shape
   * as `<MemberList labelFor>` — usually a `(userId) => string` that
   * looks up a display name from the local member roster.
   */
  labelFor?: (userId: Uuid) => string;
  /**
   * Called when the user clicks the quoted card. Typically used to
   * scroll the chat to the original message + flash a highlight.
   * No-op when omitted.
   */
  onQuotedClick?: (quotedMessageId: Uuid) => void;
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
export function MessageBubble({
  message,
  currentUserId,
  readState,
  labelFor,
  onQuotedClick,
}: MessageBubbleProps) {
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

  // Show the quote card whenever the message HAS a quote, even if the
  // preview hasn't landed yet (e.g., the optimistic temp before the
  // server echo, or a message quoting something paginated out of the
  // current window). The fallback variant just says "Replying to a
  // message" — better than rendering nothing and confusing the sender.
  const showQuoteCard =
    message.quoted_message !== undefined && message.quoted_message !== null
      ? 'full'
      : message.quoted_message_id
        ? 'placeholder'
        : null;

  return (
    <div className={className}>
      {showQuoteCard === 'full' && (
        <QuotedCard
          quoted={message.quoted_message!}
          isSelf={isSelf}
          {...(labelFor ? { labelFor } : {})}
          {...(onQuotedClick ? { onClick: onQuotedClick } : {})}
        />
      )}
      {showQuoteCard === 'placeholder' && (
        <QuotedPlaceholder isSelf={isSelf} quotedMessageId={message.quoted_message_id!} />
      )}
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

// Minimal placeholder rendered when we know a message IS a quote
// (quoted_message_id is set) but the preview body/sender isn't
// available yet. Happens optimistically before the server echo for
// quote-replies where the original is paginated outside the loaded
// window. The host's `useMembers`/`useMessages` will usually fill in
// the preview within ~100ms; until then this keeps the bubble's
// "this is a quote" affordance visible.
function QuotedPlaceholder({
  isSelf,
  quotedMessageId: _quotedMessageId,
}: {
  isSelf: boolean;
  quotedMessageId: Uuid;
}) {
  return (
    <div
      className={`poolse-quote poolse-quote--placeholder ${
        isSelf ? 'poolse-quote--self' : 'poolse-quote--other'
      }`}
      aria-label="Quoted message"
    >
      <span className="poolse-quote__sender">Replying to a message</span>
      <span className="poolse-quote__body">Loading preview…</span>
    </div>
  );
}

function QuotedCard({
  quoted,
  isSelf,
  labelFor,
  onClick,
}: {
  quoted: QuotedMessagePreview;
  isSelf: boolean;
  labelFor?: (userId: Uuid) => string;
  onClick?: (quotedMessageId: Uuid) => void;
}) {
  const senderLabel = quoted.sender_id
    ? (labelFor?.(quoted.sender_id) ?? `User ${quoted.sender_id.slice(0, 6)}`)
    : 'Unknown';
  const isDeleted = !!quoted.deleted_at;
  const handleClick = onClick ? () => onClick(quoted.id) : undefined;

  return (
    <button
      type="button"
      className={`poolse-quote ${isSelf ? 'poolse-quote--self' : 'poolse-quote--other'}`}
      onClick={handleClick}
      // No tabbing / click affordance when the host doesn't wire a
      // scroll-to-original handler — keeps the card static rather than
      // misleading the user with a pressable look.
      disabled={!handleClick}
      aria-label={`Quoted message from ${senderLabel}`}
    >
      <span className="poolse-quote__sender">{senderLabel}</span>
      <span className="poolse-quote__body">
        {isDeleted ? 'Original message deleted' : (quoted.body ?? '')}
      </span>
    </button>
  );
}
