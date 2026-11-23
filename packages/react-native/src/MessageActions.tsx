import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { PoolseIcon, type IconName } from './primitives/PoolseIcon.js';
import { EDGE_TO_EDGE_MODAL } from './internal/edgeToEdge.js';
import { useSafeInsets } from './internal/safeArea.js';
import { useTheme } from './theme/PoolseTheme.js';

const DEFAULT_REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '🙏', '🔥'];

/** An app's own entry in the long-press menu (`extraActions`). */
export interface MessageExtraAction {
  label: string;
  /** Defaults to `more-h`. */
  icon?: IconName;
  /** Called after the menu closes. */
  onPress: () => void;
  /** Red, like Delete. */
  danger?: boolean;
}

export interface MessageActionsProps {
  visible: boolean;
  onClose: () => void;
  isSelf: boolean;
  /**
   * Quick-reaction emoji row rendered at the top of the sheet. Tap
   * one to fire `onPickReaction(emoji)` and immediately close. When
   * omitted (or `onPickReaction` is omitted) the row is hidden.
   */
  emojis?: string[];
  onPickReaction?: (emoji: string) => void;
  onReply?: () => void;
  onReplyInThread?: () => void;
  onQuote?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onCopy?: () => void;
  /** "Mark unread" — offered on other people's messages. */
  onMarkUnread?: () => void;
  /**
   * "Remove preview" (one per link when there are several) — offered to
   * the sender. Receives the preview's `url`.
   */
  onRemovePreview?: (url: string) => void;
  /** The message's link-preview urls, for `onRemovePreview`. */
  previewUrls?: string[];
  /**
   * A "+" after the quick reactions that opens the full emoji picker.
   * Called after the sheet closes.
   */
  onMoreReactions?: () => void;
  /** Pin or unpin (MS13); `pinned` picks the label. */
  onTogglePin?: () => void;
  pinned?: boolean;
  /** Forward to other conversations (MS13): open your target picker (`<ForwardSheet>`). */
  onForward?: () => void;
  /** Translate (MS21), or back to the original when `translated`. */
  onTranslate?: () => void;
  translated?: boolean;
  /** The app's own actions, listed before Edit / Delete. */
  extraActions?: readonly MessageExtraAction[];
}

/**
 * Long-press action menu — modal bottom sheet. Renders a row of
 * quick-react emojis at the top (one tap reacts + closes) plus the
 * action items below. Matches WhatsApp / iMessage's "long-press
 * shows everything inline" pattern.
 */
export function MessageActions({
  visible,
  onClose,
  isSelf,
  emojis = DEFAULT_REACTION_EMOJIS,
  onPickReaction,
  onReply,
  onReplyInThread,
  onQuote,
  onEdit,
  onDelete,
  onCopy,
  onMarkUnread,
  onRemovePreview,
  previewUrls = [],
  onMoreReactions,
  onTogglePin,
  pinned = false,
  onForward,
  onTranslate,
  translated = false,
  extraActions = [],
}: MessageActionsProps) {
  const theme = useTheme();
  const insets = useSafeInsets();
  const items: Array<{ label: string; icon: IconName; onPress: () => void; danger?: boolean }> = [];
  if (onReply) items.push({ label: 'Reply', icon: 'reply', onPress: onReply });
  if (onQuote) items.push({ label: 'Quote reply', icon: 'reply', onPress: onQuote });
  if (onReplyInThread)
    items.push({ label: 'Reply in thread', icon: 'messages', onPress: onReplyInThread });
  if (onCopy) items.push({ label: 'Copy text', icon: 'copy', onPress: onCopy });
  if (onForward) items.push({ label: 'Forward', icon: 'send', onPress: onForward });
  if (onTogglePin)
    items.push({ label: pinned ? 'Unpin' : 'Pin', icon: 'pin', onPress: onTogglePin });
  if (onTranslate)
    items.push({
      label: translated ? 'Show original' : 'Translate',
      icon: 'messages',
      onPress: onTranslate,
    });
  if (!isSelf && onMarkUnread)
    items.push({ label: 'Mark unread', icon: 'bell', onPress: onMarkUnread });
  if (isSelf && onRemovePreview) {
    for (const url of previewUrls) {
      items.push({
        label: previewUrls.length > 1 ? `Remove preview (${hostOf(url)})` : 'Remove preview',
        icon: 'link',
        onPress: () => onRemovePreview(url),
      });
    }
  }
  for (const a of extraActions) {
    items.push({
      label: a.label,
      icon: a.icon ?? 'more-h',
      onPress: a.onPress,
      ...(a.danger ? { danger: true } : {}),
    });
  }
  if (isSelf && onEdit) items.push({ label: 'Edit', icon: 'edit', onPress: onEdit });
  if (isSelf && onDelete)
    items.push({ label: 'Delete', icon: 'trash', onPress: onDelete, danger: true });

  const showEmojiRow = !!onPickReaction && emojis.length > 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      // Edge-to-edge on Android like the host app, so the sheet's
      // bottom padding below is what actually clears the nav bar.
      {...EDGE_TO_EDGE_MODAL}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          // Taps on the sheet itself must not reach the backdrop.
          onPress={() => undefined}
          accessible={false}
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radii.lg,
              borderTopRightRadius: theme.radii.lg,
              // Last action row must sit above the nav bar / home indicator.
              paddingBottom: 24 + insets.bottom,
              paddingLeft: insets.left,
              paddingRight: insets.right,
            },
            theme.shadows.lg,
          ]}
        >
          {showEmojiRow ? (
            <View style={[styles.emojiRow, { borderBottomColor: theme.colors.border }]}>
              {emojis.map((emoji) => (
                <Pressable
                  key={emoji}
                  onPress={() => {
                    onPickReaction(emoji);
                    onClose();
                  }}
                  style={styles.emojiBtn}
                  hitSlop={6}
                  accessibilityLabel={`React with ${emoji}`}
                >
                  <Text style={styles.emoji}>{emoji}</Text>
                </Pressable>
              ))}
              {onMoreReactions ? (
                <Pressable
                  onPress={() => {
                    onClose();
                    onMoreReactions();
                  }}
                  style={[styles.moreBtn, { backgroundColor: theme.colors.surfaceAlt }]}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="More reactions"
                >
                  <PoolseIcon name="plus" size={20} color={theme.colors.textMuted} label={null} />
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {items.map((item) => (
            <Pressable key={item.label} onPress={item.onPress} style={styles.item}>
              <PoolseIcon
                name={item.icon}
                size={18}
                color={item.danger ? theme.colors.danger : theme.colors.textMuted}
              />
              <Text
                style={[
                  styles.itemText,
                  {
                    color: item.danger ? theme.colors.danger : theme.colors.text,
                    fontFamily: theme.fonts.body,
                  },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function hostOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url);
  return (m?.[1] ?? url).replace(/^www\./, '');
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    paddingTop: 8,
    paddingBottom: 24,
  },
  emojiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 6,
  },
  emojiBtn: {
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 30,
    lineHeight: 36,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 14,
  },
  itemText: {
    fontSize: 15,
    fontWeight: '500',
  },
});
