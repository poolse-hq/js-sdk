import type { Message, QuotedMessagePreview, Uuid } from '@poolse/sdk';
import { useUser } from '@poolse/react';
import { useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { AttachmentPreview } from './AttachmentPreview.js';
import { ImageMosaic } from './ImageMosaic.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
import { emojiFontSize, emojiOnlyCount, hasMarkdown } from './internal/bubbleText.js';
import { renderMarkdown } from './internal/markdown.js';
import { userColor } from './primitives/userColor.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

export type BubbleGroupPosition = 'first' | 'middle' | 'last' | 'standalone';

export interface MessageBubbleProps {
  message: Message;
  /** Used to decide left/right alignment, color, and read-receipt visibility. */
  currentUserId: string | null;
  /** `'sent'` → single tick, `'read'` → double tick (theme.colors.brand). */
  readState?: 'sent' | 'read';
  /** Label resolver keyed by `external_id` — falls back to the externalId itself. */
  labelFor?: (externalId: string) => string;
  /** Quoted-card tap handler. Typically used to scroll the list to the original message. */
  onQuotedClick?: (quotedMessageId: Uuid) => void;
  /** Position in a same-sender cluster — drives tail-corner rendering. */
  groupPosition?: BubbleGroupPosition;
  /** Truncate at this many chars and show a "Read more" toggle. Defaults to 0 (off). */
  maxBodyLength?: number;
  /** Show a colored sender label above other-side bubbles. Only meaningful in group chats. */
  showSenderName?: boolean;
  /** Slot for an actions trigger — typically a chevron rendered by `<MessageRow>`. */
  actionsTrigger?: ReactNode;
  /** Render in-bubble attachments (images, file cards). Defaults to true. */
  showAttachments?: boolean;
  /**
   * Render the body as Markdown (bold, italic, code, lists, links).
   * Links open via `Linking.openURL`. Requires
   * `react-native-markdown-display` to be installed in the host app;
   * without it we fall back to plain text. Defaults to true.
   */
  markdown?: boolean;
}

/**
 * One message bubble, structured as stacked sections rather than one
 * padded box: media bleeds to a 3px frame, text carries its own
 * padding, and the timestamp lives ON the last text line (reserved by
 * an invisible twin) instead of a full-width row of its own — which
 * is what makes "ok" a one-line bubble instead of a squat rectangle.
 */
export function MessageBubble({
  message,
  currentUserId,
  readState,
  labelFor,
  onQuotedClick,
  groupPosition = 'standalone',
  maxBodyLength = 0,
  showSenderName = false,
  actionsTrigger,
  showAttachments = true,
  markdown = true,
}: MessageBubbleProps) {
  const theme = usePoolseTheme();
  const { width: screenWidth } = useWindowDimensions();
  const isSelf = currentUserId !== null && message.sender_id === currentUserId;
  const [expanded, setExpanded] = useState(false);

  // Pixel cap pinned to screen width so single-line and multi-line
  // bubbles hit the same edge regardless of row padding.
  const bubbleMaxWidth = Math.floor(screenWidth * 0.78);
  // Media caps tighter than text — a photo at 78% of an iPad is a
  // poster, not a message. 420 matches the web stylesheet's cap.
  const mediaWidth = Math.min(bubbleMaxWidth - 6, 420);

  const sender = useUser(!isSelf ? message.sender_external_id : null);
  const senderFallbackName = message.sender_external_id ?? 'Unknown';
  const senderLabel =
    sender.profile?.displayName ??
    (message.sender_external_id
      ? (labelFor?.(message.sender_external_id) ?? senderFallbackName)
      : senderFallbackName);
  const senderTint = userColor(message.sender_external_id ?? message.sender_id ?? message.id);

  const tailCorner = groupPosition === 'last' || groupPosition === 'standalone';
  const bubbleRadius = theme.radii.bubble;
  const textColor = isSelf ? theme.colors.selfBubbleText : theme.colors.otherBubbleText;
  const mutedOnBubble = isSelf ? theme.colors.onBrand : theme.colors.ink3;

  const radii = {
    topLeft: bubbleRadius,
    topRight: bubbleRadius,
    bottomLeft: bubbleRadius,
    bottomRight: bubbleRadius,
  };
  if (tailCorner) {
    if (isSelf) radii.bottomRight = 5;
    else radii.bottomLeft = 5;
  }

  const body = message.body ?? '';
  const isDeleted = !!message.deleted_at;
  const isEdited = !!message.edited_at && !isDeleted;
  const trimmable = maxBodyLength > 0 && body.length > maxBodyLength;
  const truncated = trimmable && !expanded ? body.slice(0, maxBodyLength) + '…' : body;
  const time = formatTime(message.inserted_at);

  const images =
    showAttachments && !isDeleted
      ? (message.attachments ?? []).filter((a) => isImageContentType(a.content_type))
      : [];
  const files =
    showAttachments && !isDeleted
      ? (message.attachments ?? []).filter((a) => !isImageContentType(a.content_type))
      : [];
  const hasMedia = images.length > 0;
  const hasFiles = files.length > 0;
  const hasBody = !isDeleted && body.length > 0;

  // Image-only bubble → the meta floats over the picture on a scrim
  // pill, WhatsApp-style, and the bubble is nothing but the frame.
  const metaOverlay = hasMedia && !hasBody && !hasFiles;

  // 1–3 emoji and nothing else → no bubble chrome, big glyphs.
  const jumboCount =
    hasBody && !hasMedia && !hasFiles && !message.quoted_message_id ? emojiOnlyCount(body) : 0;

  // Timestamp shares the last text line via the ghost-reservation
  // trick — but only on the plain-text path; markdown blocks and the
  // Read-more toggle own their last line, so those keep the meta row.
  const inlineMeta =
    hasBody && jumboCount === 0 && !trimmable && (!markdown || !hasMarkdown(truncated));

  const sectionAbove = hasMedia || hasFiles || !!message.quoted_message || isDeleted;

  // What the invisible twin reserves: approximately the meta's
  // rendered footprint at fontSize 11 — "edited", the time, and two
  // tick-glyph widths when a receipt will show.
  const ghost = `   ${isEdited ? 'edited ' : ''}${time}${isSelf && readState ? ' ✓✓' : ''}`;

  const metaRow = (variant: 'inline' | 'block' | 'overlay' | 'jumbo') => {
    const color =
      variant === 'overlay' ? '#FFFFFF' : variant === 'jumbo' ? theme.colors.ink3 : mutedOnBubble;
    return (
      <View
        style={[
          styles.metaRow,
          variant === 'inline' && styles.metaInline,
          variant === 'overlay' && styles.metaOverlay,
          variant === 'block' && styles.metaBlock,
          // File-only bubble: the meta row follows the cards directly —
          // give it air so the time doesn't sit glued to the card.
          variant === 'block' && hasFiles && !hasBody && styles.metaBlockAfterFiles,
          variant === 'jumbo' && styles.metaJumbo,
        ]}
        pointerEvents="none"
      >
        {isEdited ? (
          <Text style={[styles.editedTag, { color, opacity: 0.8 }]}>edited</Text>
        ) : null}
        <Text style={[styles.meta, { color, opacity: variant === 'overlay' ? 1 : 0.75 }]}>
          {time}
        </Text>
        {isSelf && readState ? (
          <View style={styles.readTick}>
            <PoolseIcon
              name={readState === 'read' ? 'check-double' : 'check'}
              size={13}
              color={color}
            />
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={[styles.wrap, { alignSelf: isSelf ? 'flex-end' : 'flex-start', maxWidth: bubbleMaxWidth }]}>
      <View
        style={[
          jumboCount === 0 && {
            backgroundColor: isSelf ? theme.colors.selfBubble : theme.colors.otherBubble,
            borderColor: isSelf ? 'transparent' : theme.colors.border,
            borderWidth: isSelf ? 0 : StyleSheet.hairlineWidth,
            borderTopLeftRadius: radii.topLeft,
            borderTopRightRadius: radii.topRight,
            borderBottomLeftRadius: radii.bottomLeft,
            borderBottomRightRadius: radii.bottomRight,
          },
          jumboCount === 0 && theme.shadows.sm,
        ]}
      >
        {showSenderName &&
        !isSelf &&
        jumboCount === 0 &&
        (groupPosition === 'first' || groupPosition === 'standalone') ? (
          <Text
            style={[styles.senderName, { color: senderTint, fontFamily: theme.type.fontBody }]}
          >
            {senderLabel}
          </Text>
        ) : null}

        {message.quoted_message ? (
          <QuotedCard
            quoted={message.quoted_message}
            isSelf={isSelf}
            {...(labelFor ? { labelFor } : {})}
            {...(onQuotedClick ? { onPress: () => onQuotedClick(message.quoted_message!.id) } : {})}
          />
        ) : null}

        {hasMedia ? (
          // 3px of bubble color framing the picture; the mosaic clips
          // itself 3px tighter than the bubble so the curves stay
          // concentric.
          <View style={styles.mediaFrame}>
            <ImageMosaic
              images={images}
              maxWidth={mediaWidth}
              radius={Math.max(bubbleRadius - 3, 8)}
              squareBottom={!metaOverlay}
            />
            {metaOverlay ? metaRow('overlay') : null}
          </View>
        ) : null}

        {hasFiles ? (
          <View style={styles.filesBlock}>
            {files.map((att) => (
              <AttachmentPreview
                key={att.id}
                attachment={att}
                maxWidth={bubbleMaxWidth - 12}
                tone={isSelf ? 'onBrand' : 'default'}
              />
            ))}
          </View>
        ) : null}

        {isDeleted ? (
          <View style={[styles.textBlock, sectionAbove && styles.textBlockAfter]}>
            <Text
              style={{
                color: mutedOnBubble,
                opacity: 0.7,
                fontFamily: theme.type.fontBody,
                fontSize: theme.type.bodySize,
                lineHeight: theme.type.lineHeight,
                fontStyle: 'italic',
              }}
            >
              Message deleted
            </Text>
          </View>
        ) : null}

        {hasBody && jumboCount > 0 ? (
          <View style={styles.jumboBlock}>
            <Text
              style={{ fontSize: emojiFontSize(jumboCount), lineHeight: emojiFontSize(jumboCount) + 8 }}
            >
              {body}
            </Text>
          </View>
        ) : null}

        {hasBody && jumboCount === 0 ? (
          <View style={[styles.textBlock, sectionAbove && styles.textBlockAfter]}>
            {markdown && !inlineMeta ? (
              renderMarkdown(truncated, {
                textColor,
                linkColor: isSelf ? theme.colors.onBrand : theme.colors.brand,
                fontFamily: theme.type.fontBody,
                fontSize: theme.type.bodySize,
                lineHeight: theme.type.lineHeight,
                onLinkPress: (url: string) => {
                  void Linking.openURL(url).catch(() => undefined);
                  return false;
                },
              })
            ) : (
              <Text
                style={{
                  color: textColor,
                  fontFamily: theme.type.fontBody,
                  fontSize: theme.type.bodySize,
                  lineHeight: theme.type.lineHeight,
                }}
              >
                {truncated}
                {inlineMeta ? (
                  // The invisible twin: reserves the meta's footprint
                  // at the end of the last line so the absolutely-
                  // positioned real meta never covers a glyph — and
                  // when the line is full, the reservation wraps and
                  // the meta drops down, flush right.
                  <Text style={styles.ghost}>{ghost}</Text>
                ) : null}
              </Text>
            )}

            {trimmable ? (
              <Pressable onPress={() => setExpanded((e) => !e)}>
                <Text
                  style={[
                    styles.readMore,
                    { color: isSelf ? theme.colors.onBrand : theme.colors.brand },
                  ]}
                >
                  {expanded ? 'Show less' : 'Read more'}
                </Text>
              </Pressable>
            ) : null}

            {inlineMeta ? metaRow('inline') : null}
          </View>
        ) : null}

        {/* Fallback meta row for everything that couldn't inline or
            overlay it: markdown bodies, file bubbles, deleted rows. */}
        {!inlineMeta && !metaOverlay && jumboCount === 0 ? metaRow('block') : null}

        {actionsTrigger ? <View style={styles.actionsSlot}>{actionsTrigger}</View> : null}
      </View>

      {jumboCount > 0 ? (
        <View style={{ alignSelf: isSelf ? 'flex-end' : 'flex-start' }}>{metaRow('jumbo')}</View>
      ) : null}
    </View>
  );
}

function QuotedCard({
  quoted,
  isSelf,
  labelFor,
  onPress,
}: {
  quoted: QuotedMessagePreview;
  isSelf: boolean;
  labelFor?: (externalId: string) => string;
  onPress?: () => void;
}) {
  const theme = usePoolseTheme();
  // Priority: explicit prop > SDK userResolver > externalId fallback.
  const resolved = useUser(quoted.sender_external_id);
  const senderName = quoted.sender_external_id
    ? (labelFor?.(quoted.sender_external_id) ??
      resolved.profile?.displayName ??
      quoted.sender_external_id)
    : 'Unknown';
  // Darker than the bubble on both sides, so the quote reads as
  // something the message sits on top of.
  const bg = isSelf ? 'rgba(0,0,0,0.16)' : theme.colors.surface2;
  const accent = isSelf ? theme.colors.onBrand : theme.colors.brand;
  const txt = isSelf ? theme.colors.onBrand : theme.colors.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[
        styles.quoted,
        {
          backgroundColor: bg,
          borderLeftColor: accent,
        },
      ]}
    >
      <Text style={[styles.quotedSender, { color: accent }]} numberOfLines={1}>
        {senderName}
      </Text>
      <Text style={[styles.quotedBody, { color: txt }]} numberOfLines={2}>
        {quoted.deleted_at ? 'Original message deleted' : (quoted.body ?? '…')}
      </Text>
    </Pressable>
  );
}

function isImageContentType(ct: string | null | undefined): boolean {
  if (!ct) return false;
  return ct.startsWith('image/');
}

// HH:MM if same calendar day, "Yesterday HH:MM" if yesterday, "Mon DD"
// if older than a week, otherwise weekday abbreviation. Matches the
// WhatsApp / iMessage convention — short enough to fit in the meta
// row, long enough to be useful at a glance.
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = isSameDay(d, now);
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (sameDay) return time;

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (isSameDay(d, yesterday)) return `Yesterday ${time}`;

    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86_400_000);
    if (diffDays < 7) {
      return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 2,
  },
  senderName: {
    fontSize: 12,
    fontWeight: '700',
    paddingTop: 7,
    paddingHorizontal: 12,
  },
  mediaFrame: {
    margin: 3,
  },
  filesBlock: {
    paddingHorizontal: 6,
    paddingTop: 6,
    gap: 4,
  },
  textBlock: {
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  // A hair less air when media / files / a quote already sit above.
  textBlockAfter: {
    paddingTop: 6,
  },
  jumboBlock: {
    paddingVertical: 2,
  },
  ghost: {
    color: 'transparent',
    fontSize: 11,
  },
  readMore: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaInline: {
    position: 'absolute',
    right: 12,
    // Optically centers the meta against the body's last line (22px
    // line over the 7px bottom padding): 7 + (22 - 14) / 2. At 8 it
    // sat visibly low beside a one-line message.
    bottom: 11,
  },
  metaOverlay: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  metaBlock: {
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingBottom: 6,
    marginTop: -2,
  },
  metaBlockAfterFiles: {
    marginTop: 6,
  },
  metaJumbo: {
    paddingTop: 2,
  },
  meta: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  editedTag: {
    fontSize: 10,
    fontStyle: 'italic',
    letterSpacing: 0.1,
  },
  readTick: {
    marginLeft: 1,
    marginTop: 1,
  },
  actionsSlot: {
    position: 'absolute',
    top: 4,
    right: 4,
  },
  quoted: {
    borderLeftWidth: 3,
    paddingLeft: 9,
    paddingVertical: 5,
    paddingRight: 8,
    margin: 4,
    marginBottom: 0,
    borderRadius: 10,
  },
  quotedSender: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 1,
  },
  quotedBody: {
    fontSize: 12.5,
    opacity: 0.8,
  },
});
