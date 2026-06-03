import type { Message, QuotedMessagePreview, Uuid } from '@poolse/sdk';
import { useUser } from '@poolse/react';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AttachmentPreview } from './AttachmentPreview.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
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
}: MessageBubbleProps) {
  const theme = usePoolseTheme();
  const isSelf = currentUserId !== null && message.sender_id === currentUserId;
  const [expanded, setExpanded] = useState(false);

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
          maxWidth: '80%',
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
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
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
          <View style={{ gap: theme.spacing.xs, marginBottom: theme.spacing.xs }}>
            {images.map((att) => (
              <AttachmentPreview key={att.id} attachment={att} />
            ))}
          </View>
        ) : null}

        {renderAttachments && files.length > 0 ? (
          <View style={{ gap: theme.spacing.xs, marginBottom: theme.spacing.xs }}>
            {files.map((att) => (
              <AttachmentPreview key={att.id} attachment={att} />
            ))}
          </View>
        ) : null}

        {body.length > 0 ? (
          <Text
            style={[
              styles.body,
              {
                color: isDeleted ? theme.colors.ink3 : textColor,
                fontFamily: theme.type.fontBody,
                fontSize: theme.type.bodySize,
                lineHeight: theme.type.lineHeight,
                fontStyle: isDeleted ? 'italic' : 'normal',
              },
            ]}
          >
            {isDeleted ? 'Message deleted' : truncated}
          </Text>
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
              style={[styles.meta, { color: isSelf ? theme.colors.onBrand : theme.colors.ink3 }]}
            >
              edited ·{' '}
            </Text>
          ) : null}
          <Text style={[styles.meta, { color: isSelf ? theme.colors.onBrand : theme.colors.ink3 }]}>
            {time}
          </Text>
          {isSelf && readState ? (
            <View style={{ marginLeft: 4 }}>
              <PoolseIcon
                name={readState === 'read' ? 'check-double' : 'check'}
                size={12}
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
  const senderName = quoted.sender_external_id
    ? (labelFor?.(quoted.sender_external_id) ?? quoted.sender_external_id)
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

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 4,
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
    marginTop: 4,
  },
  meta: {
    fontSize: 10,
    opacity: 0.7,
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
