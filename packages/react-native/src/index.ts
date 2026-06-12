// @poolse/react-native — plug-and-play React Native components built
// on @poolse/react hooks. Mirrors the @poolse/react-ui surface for
// web: same component names, same prop shapes, same feature flags —
// just rendered against native primitives (View / Text / FlatList /
// TextInput / Pressable / Image / Modal / KeyboardAvoidingView).
//
// Theming flows through a JS object via <PoolseTheme>; no CSS
// variables. Override any token by passing a partial theme:
//
//     <PoolseTheme theme={{ colors: { brand: '#ff5733' } }}>
//       <ConversationView conversationId={id} />
//     </PoolseTheme>

// ── Inbox (composed list + detail with navigation) ────────────
export {
  PoolseInbox,
  type PoolseInboxProps,
  type PoolseInboxHandle,
  type InboxUser,
} from './PoolseInbox.js';

// ── Chat surface (composed conversation view) ─────────────────
export { ConversationView, type ConversationViewProps } from './ConversationView.js';
export { ChatHeader, type ChatHeaderProps } from './ChatHeader.js';
export { GroupDetailsSheet, type GroupDetailsSheetProps } from './GroupDetailsSheet.js';

// ── Pieces of the chat surface ────────────────────────────────
export { MessageBubble, type MessageBubbleProps } from './MessageBubble.js';
export { MessageRow, type MessageRowProps } from './MessageRow.js';
export { MessageComposer, type MessageComposerProps } from './MessageComposer.js';
export { MessageActions, type MessageActionsProps } from './MessageActions.js';
export { MessageList, type MessageListProps, type MessageListItem } from './MessageList.js';
export { DaySeparator, type DaySeparatorProps } from './DaySeparator.js';
export { TypingIndicator, type TypingIndicatorProps } from './TypingIndicator.js';
export { ThreadView, type ThreadViewProps } from './ThreadView.js';
export { UserName, useDisplayName, type UserNameProps } from './UserName.js';

// ── Conversation + member panels ──────────────────────────────
export { ConversationList, type ConversationListProps } from './ConversationList.js';
export { MemberList, type MemberListProps } from './MemberList.js';

// ── Rich content ──────────────────────────────────────────────
export { AttachmentPreview, type AttachmentPreviewProps } from './AttachmentPreview.js';
export { UploadQueueStrip } from './UploadQueueStrip.js';
export {
  ReactionStrip,
  ReactionPicker,
  type ReactionStripProps,
  type ReactionPickerProps,
} from './Reactions.js';
export { MentionInput, type MentionInputProps } from './MentionInput.js';
export { AttachmentPicker, type AttachmentPickerProps } from './AttachmentPicker.js';
export { ImageMosaic, type ImageMosaicProps } from './ImageMosaic.js';

// ── Brand chrome ──────────────────────────────────────────────
export { primitives as Primitives } from './primitives/index.js';
export { PoolseIcon, type PoolseIconProps, type IconName } from './primitives/PoolseIcon.js';
export {
  PoolseLogo,
  type PoolseLogoProps,
  type PoolseLogoVariant,
} from './primitives/PoolseLogo.js';
export { Avatar, type AvatarProps } from './primitives/Avatar.js';

// ── Theme ─────────────────────────────────────────────────────
export { PoolseTheme, usePoolseTheme, type PoolseThemeProps } from './theme/PoolseTheme.js';
export { defaultLightTheme, defaultDarkTheme } from './theme/default.js';
export type {
  PoolseRNTheme,
  PoolseRNThemeOverrides,
  ThemeColors,
  ThemeType,
  ThemeRadii,
  ThemeSpacing,
  ThemeShadows,
} from './theme/types.js';

// ── Lifecycle ─────────────────────────────────────────────────
export { useAppStateLifecycle } from './lifecycle/useAppStateLifecycle.js';
