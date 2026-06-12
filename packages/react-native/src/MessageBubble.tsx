import type { Message, QuotedMessagePreview, Uuid } from '@poolse/sdk';
import { useUser } from '@poolse/react';
import { useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { AttachmentPreview } from './AttachmentPreview.js';
import { ImageMosaic } from './ImageMosaic.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
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

  // Pixel-based bubble cap pinned to screen width, not to a
  // percentage of an ambiguously-sized parent. Was '88%' on the
  // wrap which resolves to 88% of the bubbleCol — and bubbleCol's
  // width changes with the row's padding, so bumping row padding
  // shrunk multi-line bubbles disproportionately. With a fixed
  // pixel maxWidth + alignSelf:flex-end, single-line and multi-line
  // both hit the same right edge regardless of nesting.
  const bubbleMaxWidth = Math.floor(screenWidth * 0.78);
  // Image / file preview width is bubble width minus the 28px
  // horizontal padding. Use flex '100%' style with a numeric ceiling
  // so the mosaic adapts to the actual rendered bubble.
  const contentMaxWidth = bubbleMaxWidth - 28;

  const sender = useUser(!isSelf ? message.sender_external_id : null);
  const senderFallbackName = message.sender_external_id ?? 'Unknown';
  const senderLabel =
    sender.profile?.displayName ??
    (message.sender_external_id
      ? (labelFor?.(message.sender_external_id) ?? senderFallbackName)
      : senderFallbackName);
  const senderTint = userColor(message.sender_external_id ?? message.sender_id ?? message.id);

  const tailCorner = groupPosition === 'last' || groupPosition === 'standalone';
  const bubbleColor = isSelf ? theme.colors.selfBubble : theme.colors.otherBubble;
  const textColor = isSelf ? theme.colors.selfBubbleText : theme.colors.otherBubbleText;

  const radii = {
    topLeft: theme.radii.bubble,
    topRight: theme.radii.bubble,
    bottomLeft: theme.radii.bubble,
    bottomRight: theme.radii.bubble,
  };
  if (tailCorner) {
    if (isSelf) radii.bottomRight = 4;
    else radii.bottomLeft = 4;
  }

  const body = message.body ?? '';
  const truncated =
    maxBodyLength > 0 && body.length > maxBodyLength && !expanded
      ? body.slice(0, maxBodyLength) + '…'
      : body;

  const time = formatTime(message.inserted_at);
  const isDeleted = !!message.deleted_at;
  const isEdited = !!message.edited_at && !isDeleted;

  const images = (message.attachments ?? []).filter((a) => isImageContentType(a.content_type));
  const files = (message.attachments ?? []).filter((a) => !isImageContentType(a.content_type));
  const renderAttachments = showAttachments && (images.length > 0 || files.length > 0);

  return (
    <View
      style={[
        styles.wrap,
        {
          alignSelf: isSelf ? 'flex-end' : 'flex-start',
          // Pixel maxWidth (not percentage) so single-line and
          // multi-line bubbles land at the same right edge — was
          // 88% of the bubbleCol which produced inconsistent right
          // padding when the row padding changed.
          maxWidth: bubbleMaxWidth,
        },
      ]}
    >
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: bubbleColor,
            borderColor: isSelf ? 'transparent' : theme.colors.border,
            borderWidth: isSelf ? 0 : StyleSheet.hairlineWidth,
            borderTopLeftRadius: radii.topLeft,
            borderTopRightRadius: radii.topRight,
            borderBottomLeftRadius: radii.bottomLeft,
            borderBottomRightRadius: radii.bottomRight,
            // Slightly more breathing room — 14/10 reads tighter and
            // matches the iMessage / WhatsApp bubble density.
            paddingHorizontal: 14,
            paddingVertical: 10,
            // Floor the bubble at a width that always fits the meta row
            // ("edited HH:MM ✓✓" → ~110px). Without this, short bodies
            // like "ok" produce a bubble too narrow for the meta to lay
            // out, and `edited` or the time gets clipped.
            minWidth: isSelf && isEdited ? 130 : 90,
          },
          theme.shadows.sm,
        ]}
      >
        {showSenderName &&
        !isSelf &&
        (groupPosition === 'first' || groupPosition === 'standalone') ? (
          <Text style={[styles.senderName, { color: senderTint, fontFamily: theme.type.fontBody }]}>
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

        {renderAttachments && images.length > 0 ? (
          <ImageMosaic images={images} maxWidth={contentMaxWidth} />
        ) : null}

        {renderAttachments && files.length > 0 ? (
          <View style={{ gap: theme.spacing.xs, marginBottom: theme.spacing.xs }}>
            {files.map((att) => (
              <AttachmentPreview key={att.id} attachment={att} maxWidth={contentMaxWidth} />
            ))}
          </View>
        ) : null}

        {body.length > 0 ? (
          isDeleted ? (
            <Text
              style={[
                styles.body,
                {
                  color: theme.colors.ink3,
                  fontFamily: theme.type.fontBody,
                  fontSize: theme.type.bodySize,
                  lineHeight: theme.type.lineHeight,
                  fontStyle: 'italic',
                },
              ]}
            >
              Message deleted
            </Text>
          ) : markdown ? (
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
              style={[
                styles.body,
                {
                  color: textColor,
                  fontFamily: theme.type.fontBody,
                  fontSize: theme.type.bodySize,
                  lineHeight: theme.type.lineHeight,
                },
              ]}
            >
              {truncated}
            </Text>
          )
        ) : null}

        {maxBodyLength > 0 && body.length > maxBodyLength ? (
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

        <View style={styles.metaRow}>
          {isEdited ? (
            <Text
              style={[
                styles.editedTag,
                {
                  color: isSelf ? theme.colors.onBrand : theme.colors.ink3,
                  opacity: 0.7,
                },
              ]}
            >
              edited
            </Text>
          ) : null}
          <Text
            style={[
              styles.meta,
              {
                color: isSelf ? theme.colors.onBrand : theme.colors.ink3,
                opacity: isSelf ? 0.85 : 1,
              },
            ]}
          >
            {time}
          </Text>
          {isSelf && readState ? (
            <View style={styles.readTick}>
              <PoolseIcon
                name={readState === 'read' ? 'check-double' : 'check'}
                size={13}
                color={theme.colors.onBrand}
              />
            </View>
          ) : null}
        </View>

        {actionsTrigger ? <View style={styles.actionsSlot}>{actionsTrigger}</View> : null}
      </View>
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
  const bg = isSelf ? 'rgba(255,255,255,0.18)' : theme.colors.surface2;
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
      <Text style={[styles.quotedSender, { color: accent }]}>{senderName}</Text>
      <Text style={[styles.quotedBody, { color: txt }]} numberOfLines={2}>
        {quoted.body ?? '…'}
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
  bubble: {
    position: 'relative',
  },
  senderName: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  body: {
    flexShrink: 1,
  },
  readMore: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 6,
    gap: 5,
    flexShrink: 0,
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
    marginLeft: 2,
    marginTop: 1,
  },
  actionsSlot: {
    position: 'absolute',
    top: 4,
    right: 4,
  },
  quoted: {
    borderLeftWidth: 3,
    paddingLeft: 8,
    paddingVertical: 4,
    paddingRight: 6,
    marginBottom: 6,
    borderRadius: 4,
  },
  quotedSender: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  quotedBody: {
    fontSize: 12,
    opacity: 0.85,
  },
});
