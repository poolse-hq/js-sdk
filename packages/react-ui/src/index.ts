export { CallVideoGrid, type CallVideoGridProps } from './CallVideoGrid.js';
export {
  CallControlButton,
  CallDeviceMenu,
  type CallControlButtonProps,
  type CallDeviceMenuProps,
} from './CallControls.js';
// @poolse/react-ui — plug-and-play React components built on
// @poolse/react hooks. Drop in once for instant chat; eject to
// individual pieces (or the raw hooks) when you need more control.
//
// Don't forget to import the styles:
//
//     import '@poolse/react-ui/styles.css';
//
// Theming flows through CSS variables defined in styles.css — see
// the brand kit (`tokens.css`) for the full --poolse-* surface.
// Override at any level: redefine the variables in your own
// stylesheet, or set `[data-theme="dark"]` on any ancestor to
// switch to the warm dark theme. Or wrap the UI in
// `<PoolseTheme theme="ocean" colorScheme="system">` for one of the
// @poolse/theme themes.

// ── Chat surface (composed conversation view) ─────────────────
export { ConversationView, type ConversationViewProps } from './ConversationView.js';
export type { MessageUser } from './MessageRow.js';
export type {
  ChatDensity,
  ChatLayout,
  MessageSlot,
  MessageSlotProps,
  MessageSlots,
  RenderMessageContext,
  TimeFormat,
} from './layout.js';
export { ChatHeader, type ChatHeaderProps } from './ChatHeader.js';
export {
  localDraftStorage,
  draftsOf,
  DraftScope,
  type ConversationDraft,
  type DraftStorage,
} from './drafts.js';
export { EmptyState, type EmptyStateProps } from './EmptyState.js';
export { SendStatus, type SendStatusProps } from './SendStatus.js';
export {
  DEFAULT_KEYMAP,
  MOD_ENTER_COMPOSER,
  matchesKey,
  matchesAny,
  resolveKeymap,
  type ComposerKeymap,
  type KeyBinding,
  type MessageListKeymap,
  type PoolseKeymap,
  type PoolseKeymapOverrides,
} from './keymap.js';

// ── Inbox shell (composed list + detail) ──────────────────────
export { PoolseInbox, type PoolseInboxProps, type PoolseInboxHandle } from './PoolseInbox.js';
export { UserPickerSheet, type UserPickerSheetProps, type InboxUser } from './UserPickerSheet.js';
export { GroupDetailsSheet, type GroupDetailsSheetProps } from './GroupDetailsSheet.js';

// ── Pieces of the chat surface ────────────────────────────────
export { MessageBubble, type MessageBubbleProps } from './MessageBubble.js';
export { CallLogRow, type CallLogRowProps } from './CallLogRow.js';
export { LiveCallBanner, type LiveCallBannerProps } from './LiveCallBanner.js';
export { RoomJoinBar, RoomStage, type RoomJoinBarProps, type RoomStageProps } from './Room.js';
// Recording, consent and transcripts.
export {
  ConsentPrompt,
  RecordingBanner,
  RecordingIndicator,
  RecordingNoticeRow,
  type ConsentPromptProps,
  type RecordingBannerProps,
  type RecordingIndicatorProps,
  type RecordingNoticeRowProps,
} from './Recording.js';
export {
  LiveTranscriptPanel,
  TranscriptViewer,
  type LiveTranscriptPanelProps,
  type TranscriptViewerProps,
} from './Transcript.js';
// Agents (AG1, AG4, AG5) and meetings (RT6, RT8, RT9, RT13).
export { AgentBadge, type AgentBadgeProps } from './AgentBadge.js';
export {
  ApprovalCard,
  ApprovalList,
  ApprovalMessageRow,
  MessageCitations,
  type ApprovalCardProps,
  type ApprovalListProps,
  type ApprovalMessageRowProps,
  type MessageCitationsProps,
} from './Agents.js';
export {
  AskMeetings,
  ClipPlayer,
  RecordingPlayer,
  SummaryCard,
  SummaryMessageRow,
  type AskMeetingsProps,
  type ClipPlayerProps,
  type RecordingPlayerHandle,
  type RecordingPlayerProps,
  type SummaryCardProps,
  type SummaryMessageRowProps,
} from './Meetings.js';
export {
  MessageExtrasProvider,
  useMessageExtras,
  type MessageExtrasHandlers,
} from './messageExtras.js';
export { EditedLabel, useEditHistory, type EditedLabelProps } from './EditedLabel.js';
export { EditableMessageBubble, type EditableMessageBubbleProps } from './EditableMessageBubble.js';
export { MessageComposer, type MessageComposerProps } from './MessageComposer.js';
export { MessageActions, type MessageActionsProps } from './MessageActions.js';
export { TypingIndicator, type TypingIndicatorProps } from './TypingIndicator.js';
export { ThreadView, type ThreadViewProps } from './ThreadView.js';
export { ThreadSummary, type ThreadSummaryProps } from './ThreadSummary.js';
export { Avatar, type AvatarProps } from './Avatar.js';
export {
  PresenceBadge,
  presenceStateLabel,
  presenceText,
  type PresenceBadgeProps,
} from './PresenceBadge.js';
export { formatRelativeTime } from './relativeTime.js';
export { UserName, useDisplayName, type UserNameProps } from './UserName.js';

// ── Conversation + member panels ──────────────────────────────
export {
  ConversationList,
  type ConversationListProps,
  type ConversationListSection,
} from './ConversationList.js';
export { MemberList, type MemberListProps } from './MemberList.js';

// ── Rich content ──────────────────────────────────────────────
export { AttachmentPreview, type AttachmentPreviewProps } from './AttachmentPreview.js';
export { LinkPreviewCard, type LinkPreviewCardProps } from './LinkPreviewCard.js';
export { UploadQueueStrip, type UploadQueueStripProps } from './UploadQueueStrip.js';
export { ReactionStrip, ReactionPicker, type ReactionStripProps } from './Reactions.js';
export { EmojiPicker, loadEmojiData, type EmojiPickerProps } from './EmojiPicker.js';
export { MentionInput, type MentionInputProps } from './MentionInput.js';

// ── Theme ─────────────────────────────────────────────────────
export {
  PoolseTheme,
  useTheme,
  useSystemColorScheme,
  type PoolseThemeProps,
  type PoolseThemeValue,
} from './PoolseTheme.js';
export {
  BUILT_IN_THEME_IDS,
  DEFAULT_THEME_ID,
  createTheme,
  decodeTheme,
  encodeTheme,
  tokensFromFlat,
  type BuiltInThemeId,
  type ColorScheme,
  type ColorSchemePreference,
  type FlatThemeTokens,
  type Theme,
  type ThemeInput,
} from '@poolse/theme';

// ── Brand chrome ──────────────────────────────────────────────
export { PoolseIcon, type PoolseIconProps, type IconName } from './PoolseIcon.js';
export { PoolseLogo, type PoolseLogoProps, type PoolseLogoVariant } from './PoolseLogo.js';
export { PoolseFonts, usePoolseFonts } from './fonts.js';
