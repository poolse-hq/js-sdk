import type { Attachment, Message, QuotedMessagePreview, Uuid } from '@poolse/sdk';
import { useUser } from '@poolse/react';
import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AttachmentPreview } from './AttachmentPreview.js';
import { PoolseIcon } from './PoolseIcon.js';
import { userColor } from './userColor.js';

/**
 * Position of this bubble within a same-sender, same-day, ≤5-min
 * cluster. Drives the tail-corner rendering: only `last` and
 * `standalone` get the asymmetric tail, matching the WhatsApp /
 * iMessage convention where consecutive bursts read as a single
 * unit with one trailing tail.
 */
export type BubbleGroupPosition = 'first' | 'middle' | 'last' | 'standalone';

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
   * as `<MemberList labelFor>` — `(externalId) => string` looking up a
   * display name from the local member roster.
   */
  labelFor?: (externalId: string) => string;
  /**
   * Called when the user clicks the quoted card. Typically used to
   * scroll the chat to the original message + flash a highlight.
   * No-op when omitted.
   */
  onQuotedClick?: (quotedMessageId: Uuid) => void;
  /**
   * Where this bubble sits within a same-sender cluster (see
   * BubbleGroupPosition). Defaults to `standalone`.
   */
  groupPosition?: BubbleGroupPosition;
  /**
   * When > 0, truncates the body at this many characters and shows a
   * "Read more" toggle to expand. Defaults to 0 (no truncation).
   */
  maxBodyLength?: number;
  /**
   * Render the body as GitHub-flavored Markdown (bold, italic, lists,
   * fenced code, blockquotes, strikethrough, autolinks). Defaults to
   * `false`. `<ConversationView>` flips this on by default.
   */
  markdown?: boolean;
  /**
   * Show a colored sender label above the body for other-side
   * bubbles. Only meaningful in group chats (3+ participants) and
   * only on the FIRST / STANDALONE bubble of a cluster (continuation
   * bubbles share the cluster's identity). The label name comes
   * from the SDK's `useUser` hook via the customer's
   * `userResolver` config.
   */
  showSenderName?: boolean;
  /**
   * Slot for a "show actions" affordance — typically a chevron
   * rendered by `<MessageRow>` that toggles the actions popover on
   * desktop click. Positioned absolutely at the top-trailing corner
   * inside the bubble so it overlays the message border; hidden by
   * CSS until the row is hovered.
   */
  actionsTrigger?: ReactNode;
  /**
   * Render the message's attachments INSIDE the bubble (WhatsApp-
   * style): images mosaic at the top, file cards below, then the
   * message body. Defaults to `true`. Pass `false` if you're rendering
   * attachments yourself outside the bubble.
   */
  showAttachments?: boolean;
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
  groupPosition = 'standalone',
  maxBodyLength = 0,
  markdown = false,
  showSenderName = false,
  actionsTrigger,
  showAttachments = true,
}: MessageBubbleProps) {
  const isSelf = currentUserId !== null && message.sender_id === currentUserId;
  const [expanded, setExpanded] = useState(false);

  // Resolve the sender's display name + avatar via the customer's
  // `userResolver`. For self bubbles we don't bother — you know who
  // you are; pass null to short-circuit the hook. The resolver is keyed
  // by `external_id` (the tenant's own user id), not the poolse uuid,
  // so customers never need a `poolse_user_id` column on their side.
  const { profile: sender } = useUser(!isSelf ? message.sender_external_id : null);
  const senderFallbackName = message.sender_external_id ?? 'Unknown';
  const senderName = sender?.displayName ?? senderFallbackName;
  const senderColorKey = message.sender_external_id ?? message.sender_id ?? '';
  const senderColorHex = senderColorKey ? userColor(senderColorKey) : 'currentColor';

  // First-of-cluster / standalone get the sender label.
  const renderSenderName =
    showSenderName && !isSelf && (groupPosition === 'first' || groupPosition === 'standalone');

  // Long-message trim. Only kicks in when (a) caller opts in via
  // `maxBodyLength > 0`, (b) the body is actually longer than the
  // threshold (with a small buffer so we don't truncate by 5 chars
  // for no gain), and (c) the user hasn't expanded.
  const rawBody = message.body ?? '';
  const TRIM_BUFFER = 40;
  const shouldTrim = !expanded && maxBodyLength > 0 && rawBody.length > maxBodyLength + TRIM_BUFFER;
  const displayBody = shouldTrim ? rawBody.slice(0, maxBodyLength).trimEnd() + '…' : rawBody;

  // Attachment partitioning — images go into the mosaic; files
  // stack as cards below the mosaic. Both groups still live INSIDE
  // the bubble (the WhatsApp convention), with the message body
  // rendered underneath.
  const attachmentList: Attachment[] =
    showAttachments && !message.deleted_at && Array.isArray(message.attachments)
      ? message.attachments
      : [];
  const imageAttachments = attachmentList.filter((a) => isImageContentType(a.content_type));
  const fileAttachments = attachmentList.filter((a) => !isImageContentType(a.content_type));
  const hasAnyAttachment = imageAttachments.length > 0 || fileAttachments.length > 0;
  const hasVisibleBody = !message.deleted_at && rawBody.length > 0;
  // Image-only (no body, no file cards) → meta floats over the
  // bottom-right of the last image as a pill overlay (WhatsApp style).
  const metaOverlay =
    hasAnyAttachment &&
    imageAttachments.length > 0 &&
    !hasVisibleBody &&
    fileAttachments.length === 0;

  const className = [
    'poolse-message',
    isSelf ? 'poolse-message--self' : 'poolse-message--other',
    // Group-position modifier — CSS uses it to toggle which corners
    // get the asymmetric tail vs. fully-rounded treatment.
    `poolse-message--${groupPosition}`,
    // Tells the CSS to round the image mosaic's bottom corners to
    // match the bubble's outer corner when nothing follows the media.
    hasAnyAttachment ? 'poolse-message--has-media' : '',
    metaOverlay ? 'poolse-message--media-only' : '',
  ]
    .filter(Boolean)
    .join(' ');

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
      {actionsTrigger}
      {renderSenderName && (
        <div className="poolse-message__sender" style={{ color: senderColorHex }}>
          {senderName}
        </div>
      )}
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
      {imageAttachments.length > 0 && <ImageMosaic images={imageAttachments} />}
      {fileAttachments.length > 0 && (
        <div className="poolse-message__files">
          {fileAttachments.map((att) => (
            <AttachmentPreview key={att.id} attachment={att} />
          ))}
        </div>
      )}
      {message.deleted_at ? (
        <span className="poolse-message__body--deleted">[deleted]</span>
      ) : hasVisibleBody ? (
        <div className="poolse-message__body">
          {markdown ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // Force links to a new tab + no opener — chat content
                // is user-supplied so security defaults matter.
                a: ({ node: _node, ...props }) => (
                  <a {...props} target="_blank" rel="noopener noreferrer nofollow" />
                ),
              }}
            >
              {displayBody}
            </ReactMarkdown>
          ) : (
            <span>{displayBody}</span>
          )}
          {shouldTrim && (
            <button
              type="button"
              className="poolse-message__read-more"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(true);
              }}
            >
              Read more
            </button>
          )}
          {!shouldTrim && expanded && rawBody.length > maxBodyLength + TRIM_BUFFER && (
            <button
              type="button"
              className="poolse-message__read-more"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(false);
              }}
            >
              Show less
            </button>
          )}
        </div>
      ) : null}
      <span
        className={
          metaOverlay
            ? 'poolse-message__meta poolse-message__meta--overlay'
            : 'poolse-message__meta'
        }
      >
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

// Whether a content-type string represents an image. The Attachment
// row always carries `content_type` from the server — for messages
// authored on older clients (or partially-populated rows during a
// realtime echo race) we fall back to "treat as file" which is the
// safer of the two paths.
function isImageContentType(ct: string | null | undefined): boolean {
  return typeof ct === 'string' && ct.toLowerCase().startsWith('image/');
}

// Image mosaic — WhatsApp-style layout for one or more images inside
// the bubble. Picks a grid template by count:
//   1  → single full-bleed tile (image keeps its natural aspect, capped)
//   2  → two equal squares side-by-side
//   3  → one wide tile on top, two equal squares beneath
//   4+ → 2×2 grid; the 4th tile shows a "+N more" overlay when there
//        are more than four images.
function ImageMosaic({ images }: { images: Attachment[] }) {
  const total = images.length;
  // Cap the visible tiles at 4; anything past that surfaces via the
  // overflow badge on the last tile.
  const visible = images.slice(0, 4);
  const layout = Math.min(total, 4); // 1 | 2 | 3 | 4
  const overflow = Math.max(0, total - 4);
  return (
    <div
      className={`poolse-message__media poolse-message__media--n${layout}`}
      aria-label={total === 1 ? 'Image' : `${total} images`}
    >
      {visible.map((att, i) => {
        const isOverflowTile = i === visible.length - 1 && overflow > 0;
        return (
          <div className="poolse-message__media-tile" key={att.id}>
            <AttachmentPreview attachment={att} />
            {isOverflowTile && (
              <div className="poolse-message__media-overflow" aria-hidden="true">
                +{overflow}
              </div>
            )}
          </div>
        );
      })}
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
  labelFor?: (externalId: string) => string;
  onClick?: (quotedMessageId: Uuid) => void;
}) {
  const senderLabel = quoted.sender_external_id
    ? (labelFor?.(quoted.sender_external_id) ?? quoted.sender_external_id)
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
