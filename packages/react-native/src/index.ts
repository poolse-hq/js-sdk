// @poolse/react-native — plug-and-play React Native components built
// on @poolse/react hooks. Mirrors the @poolse/react-ui surface for
// web: same component names, same prop shapes, same feature flags —
// just rendered against native primitives (View / Text / FlatList /
// TextInput / Pressable / Image / Modal / KeyboardAvoidingView).
//
// Theming flows through a JS object via <PoolseTheme>; no CSS
// variables. Pick a @poolse/theme theme and scheme:
//
//     <PoolseTheme theme="ocean" colorScheme="system">
//       <ConversationView conversationId={id} />
//     </PoolseTheme>
//
// Components read the tokens with `useTheme()`.

// ── Inbox (composed list + detail with navigation) ────────────
export {
  PoolseInbox,
  type PoolseInboxProps,
  type PoolseInboxHandle,
  type InboxUser,
} from './PoolseInbox.js';

// ── Chat surface (composed conversation view) ─────────────────
export { ConversationView, type ConversationViewProps } from './ConversationView.js';
export type { ConversationDraft, DraftStorage } from './internal/drafts.js';
export { ChatHeader, type ChatHeaderProps } from './ChatHeader.js';
export { GroupDetailsSheet, type GroupDetailsSheetProps } from './GroupDetailsSheet.js';

// ── Pieces of the chat surface ────────────────────────────────
export { MessageBubble, type MessageBubbleProps } from './MessageBubble.js';
export { MessageRow, type MessageRowProps, type MessageUser } from './MessageRow.js';
export type {
  ChatDensity,
  ChatLayout,
  MessageSlot,
  MessageSlotProps,
  MessageSlots,
  RenderMessageContext,
  TimeFormat,
} from './layout.js';
export { CallLogRow, type CallLogRowProps } from './CallLogRow.js';
export { LiveCallBanner, type LiveCallBannerProps } from './LiveCallBanner.js';
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
export { AgentBadge, AgentBadgeInline, type AgentBadgeProps } from './AgentBadge.js';
export {
  CallAgentTag,
  EscalationCard,
  EscalationList,
  InviteAgentMenu,
  WhisperPanel,
  type CallAgentTagProps,
  type EscalationCardProps,
  type EscalationListProps,
  type InviteAgentMenuProps,
  type WhisperPanelProps,
} from './CallAgents.js';
export {
  ApprovalCard,
  ApprovalList,
  MessageApproval,
  MessageCitations,
  type ApprovalCardProps,
  type ApprovalListProps,
  type MessageApprovalProps,
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
// Live meetings (CL2–CL15, CA4, CA5, CA11).
export {
  AgendaPanel,
  BreakoutBanner,
  LobbyAdmitList,
  LobbyWaiting,
  MarkMomentButton,
  MeetingCard,
  MeetingCardMessageRow,
  QuestionsPanel,
  RoomPresence,
  StagePanel,
  type AgendaPanelProps,
  type BreakoutBannerProps,
  type LobbyAdmitListProps,
  type LobbyWaitingProps,
  type MarkMomentButtonProps,
  type MeetingCardMessageRowProps,
  type MeetingCardProps,
  type MeetingParticipant,
  type QuestionsPanelProps,
  type RoomPresenceProps,
  type StagePanelProps,
} from './MeetingsLive.js';
export {
  AnnotationOverlay,
  CaptionsOverlay,
  ConnectionIndicator,
  NetworkBanner,
  ReactionPickerBar,
  ReactionsOverlay,
  WhiteboardView,
  type AnnotationOverlayProps,
  type CaptionsOverlayProps,
  type ConnectionIndicatorProps,
  type NetworkBannerProps,
  type ReactionPickerBarProps,
  type ReactionsOverlayProps,
  type WhiteboardViewProps,
} from './CallOverlays.js';
export {
  avatarOverflow,
  captionLines,
  formatCountdown,
  meetingTimeText,
  overrunText,
  rsvpSummary,
  type CaptionLine,
} from './internal/meetingsLive.js';
export {
  MessageExtrasProvider,
  useMessageExtras,
  type MessageExtrasHandlers,
  type PoolseMediaProps,
  type RenderMedia,
} from './messageExtras.js';
export {
  MessageComposer,
  type MessageComposerProps,
  type MessageComposerHandle,
} from './MessageComposer.js';
export { MessageActions, type MessageActionsProps } from './MessageActions.js';
export { MessageList, type MessageListProps, type MessageListItem } from './MessageList.js';
export { DaySeparator, type DaySeparatorProps } from './DaySeparator.js';
export { TypingIndicator, type TypingIndicatorProps } from './TypingIndicator.js';
export { ThreadView, type ThreadViewProps } from './ThreadView.js';
export { ThreadSummary, type ThreadSummaryProps } from './ThreadSummary.js';
export { NewMessagesDivider, type NewMessagesDividerProps } from './NewMessagesDivider.js';
export { EditHistorySheet, type EditHistorySheetProps } from './EditHistorySheet.js';
export { UserName, useDisplayName, type UserNameProps } from './UserName.js';

// ── Conversation + member panels ──────────────────────────────
export {
  ConversationList,
  type ConversationListProps,
  type ConversationSection,
  type ConversationGroupBy,
} from './ConversationList.js';
export { MemberList, type MemberListProps } from './MemberList.js';
export { PresenceBadge, type PresenceBadgeProps } from './PresenceBadge.js';

// ── Rich content ──────────────────────────────────────────────
export { AttachmentPreview, type AttachmentPreviewProps } from './AttachmentPreview.js';
export { LinkPreviewCard, type LinkPreviewCardProps } from './LinkPreviewCard.js';
export { EmojiPicker, type EmojiPickerProps } from './EmojiPicker.js';
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
export {
  PoolseTheme,
  useTheme,
  /** @deprecated Use `useTheme()`; kept so 3.3 code keeps working. */
  usePoolseTheme,
  type PoolseThemeProps,
} from './theme/PoolseTheme.js';
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
export { useAppStatePresence } from './lifecycle/useAppStatePresence.js';
export {
  useBackgroundClients,
  applyBackground,
  type BackgroundClientsOptions,
} from './lifecycle/useBackgroundClients.js';
export { EmptyState, type EmptyStateProps } from './EmptyState.js';
export { SendStatus, type SendStatusProps } from './SendStatus.js';

// ── Call building blocks ──────────────────────────────────────
// Calls themselves run in the native call core (@poolse/native),
// which hands your screen a snapshot to draw. These are the pieces that
// are fiddly to get right, for building that screen.
export { CallControlButton, type CallControlButtonProps } from './voice/CallControlButton.js';
export { CallAvatar, type CallAvatarProps } from './voice/CallAvatar.js';
export {
  AudioRouteSheet,
  type AudioRouteSheetProps,
  type AudioRoute,
  type AudioRouteKind,
} from './voice/AudioRouteSheet.js';
export { callColors } from './voice/callTheme.js';
export { useCallDuration } from './voice/useCallDuration.js';
