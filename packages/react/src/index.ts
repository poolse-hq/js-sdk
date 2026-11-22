// Public surface of @poolse/react — headless hooks for the poolse SDK.
//
// Wrap your app in <PoolseProvider config={{apiUrl, getToken}}>, then
// use the hooks below to access live state + actions. The provider
// owns one Poolse instance for its mount lifetime.

export { PoolseProvider, usePoolse, type PoolseProviderProps } from './provider.js';
export {
  useUnreadTotals,
  useUnreadQueue,
  orderUnread,
  type UseUnreadTotals,
  type UseUnreadQueue,
  type UseUnreadQueueOptions,
} from './use-unread.js';
export { useOutbox, type UseOutbox } from './use-outbox.js';
export { useClientTimings } from './use-timings.js';
export { filterConversations, type ConversationSearchOptions } from './conversation-search.js';
export { useMe } from './use-me.js';
export { useConversation } from './use-conversation.js';
export { useConversations } from './use-conversations.js';
export { useMembers } from './use-members.js';
export { useMessages } from './use-messages.js';
export { useReactions, type ReactionMap } from './use-reactions.js';
export { useThread } from './use-thread.js';
export { useTyping } from './use-typing.js';
export { useMessageStreams, type MessageStream } from './use-message-streams.js';
export { usePresence, useConversationPresence } from './use-presence.js';
export { useUserPresence, usePresenceMany } from './use-user-presence.js';
export { useRealtimeStatus } from './use-realtime-status.js';
export {
  useAttachmentUpload,
  type UploadItem,
  type UploadItemStatus,
} from './use-attachment-upload.js';
export { useAttachmentUrl } from './use-attachment-url.js';
export { useAgent, useUser, type UseUserState } from './use-user.js';
export { useAppEvent } from './use-app-event.js';
export {
  computeGroupPosition,
  sameGroup,
  sameDay,
  formatDayLabel,
  type GroupPosition,
} from './grouping.js';

// Re-export the SDK so consumers can pull in types / errors from one
// package — saves a second `npm install @poolse/sdk` for React-only apps.
export type {
  ApiErrorCode,
  AppEvent,
  Attachment,
  AttachmentStatus,
  AttachmentUploadInput,
  AttachmentUploadRequest,
  AttachmentUploadResponse,
  Conversation,
  ConversationCreateRequest,
  ConversationReadEvent,
  Me,
  MemberRole,
  Membership,
  NotificationPreferences,
  NotifyLevel,
  OwnMembership,
  OwnMembershipUpdateRequest,
  LinkPreview,
  LinkPreviewType,
  LocalMessageStatus,
  Message,
  MessageCreateRequest,
  MessageEdit,
  MessageEditList,
  MessageType,
  MessageUpdateRequest,
  PoolseConfig,
  PoolseUserProfile,
  Presence,
  PresenceActivity,
  PresenceChangedEvent,
  PresenceState,
  RealtimeStatus,
  ThreadParticipant,
  ThreadUpdatedEvent,
  TrackActivityOptions,
  Uuid,
  DestroyOptions,
  OutboxEntry,
  PoolseStorage,
  TimingEvent,
  UnreadTotals,
  UnreadSummary,
} from '@poolse/sdk';
export {
  ApiError,
  AuthError,
  PoolseError,
  NetworkError,
  RateLimitedError,
  MessageQueuedError,
  MessageDiscardedError,
  Poolse,
  createIndexedDbStorage,
  memoryStorage,
} from '@poolse/sdk';
export { isTombstone, mergeMessage, toTombstone } from '@poolse/sdk';

// Call-log system messages — shared parser + display helpers.
export {
  parseCallLog,
  parseCallLogBody,
  isCallLogMessage,
  isMessageVisibleTo,
  describeCallLog,
  callLogDisplayFor,
  formatCallDuration,
  formatCallLogPreview,
} from '@poolse/sdk';
export type {
  CallLog,
  CallLogEntry,
  CallMissedEntry,
  CallLogMedia,
  CallLogDisplay,
  CallParticipantStatus,
  CallEndReason,
  LiveCall,
  LiveCallMember,
  RoomSession,
  DeviceKind,
  ReadReceiptsState,
} from '@poolse/sdk';

// ── Calls and rooms ──────────────────────────────────────────────
export { useCallRoom, type UseCallRoom, type UseCallRoomOptions } from './use-call-room.js';
export { useLiveCall, type UseLiveCall } from './use-live-call.js';
export { useRoom, type UseRoom, type UseRoomOptions } from './use-room.js';
// Live meeting features (CL2–CL15, CA5) — docs/MEETINGS.md.
export {
  useAgenda,
  useBreakouts,
  useCallQuality,
  useCallReactions,
  useLobby,
  useMoments,
  useQuestions,
  useRoomPresence,
  useScreenAnnotations,
  useStage,
  useWhiteboard,
  type UseAgenda,
  type UseBreakouts,
  type UseCallReactions,
  type UseLobby,
  type UseMoments,
  type UseQuestions,
  type UseScreenAnnotations,
  type UseStage,
  type UseWhiteboard,
} from './use-meetings-live.js';

// ── Recording, consent and transcripts ───────────────────────────
export { useRecording, type UseRecording } from './use-recording.js';
export {
  useLiveTranscript,
  type UseLiveTranscript,
  type UseLiveTranscriptOptions,
} from './use-live-transcript.js';
export {
  useTranscript,
  useTranscripts,
  useRecordings,
  type UseTranscript,
  type UseCaptureList,
} from './use-transcript.js';
export { applyCaptureEvent, type CaptureState, type CaptureEvent } from './capture-state.js';
export {
  applyLiveSegment,
  captureErrorMessage,
  captureLabel,
  describeRecordingNotice,
  findInText,
  groupTranscript,
  speakerName,
  formatRecordingNoticePreview,
  isServiceParticipant,
  parseRecordingNotice,
  parseRecordingNoticeBody,
  recordingNoticeDisplayFor,
  POOLSE_SERVICE_IDENTITY_PREFIX,
} from '@poolse/sdk';
export type {
  CallRecordingState,
  CallTranscriptionState,
  ConsentDecision,
  ConversationRecordingSettings,
  LiveTranscriptSegment,
  Recording,
  RecordingDownload,
  RecordingMode,
  RecordingNotice,
  RecordingNoticeDisplay,
  RecordingStatus,
  TranscriptBlock,
  Transcript,
  TranscriptSegment,
  TranscriptSpeaker,
  TranscriptWithSegments,
} from '@poolse/sdk';
export {
  useReadReceipts,
  receiptsOf,
  canEditOwnMessage,
  EDIT_WINDOW_MS,
  type UseReadReceipts,
} from './use-read-receipts.js';

// ── Agents (AG1, AG3, AG4, AG5, AG10, AG11) ──────────────────────
export { useApproval, useApprovals, type UseApproval, type UseApprovals } from './use-approvals.js';
export {
  useAgents,
  useConversationAgents,
  useFollowups,
  useMemory,
  type UseAgents,
  type UseConversationAgents,
  type UseFollowups,
  type UseMemory,
} from './use-agents.js';
export {
  APPROVAL_REASON_MAX,
  agentFromWire,
  agentMetaOf,
  approvalErrorMessage,
  approvalFromWire,
  approvalIdOf,
  approvalStatusLabel,
  citationLabel,
  citationsOf,
  messageAgent,
  toolLabel,
} from '@poolse/sdk';
export type {
  AgentApproval,
  AgentInfo,
  AgentMessageKind,
  AgentMeta,
  AgentProfile,
  AgentScope,
  AgentScopeUpdate,
  ApprovalDetail,
  ApprovalStatus,
  Citation,
  CitationType,
  ConversationAgent,
  Followup,
  FollowupStatus,
  MemoryFact,
  MemoryKind,
} from '@poolse/sdk';

// ── Meetings: summaries, asking, clips, playback (RT6–RT9, RT12, RT13)
export {
  useAskMeetings,
  useCallSummary,
  useClip,
  useRecordingPlayback,
  useRecordingUrl,
  type UseAskMeetings,
  type UseCallSummary,
  type UseClip,
  type UseRecordingPlayback,
  type UseRecordingUrl,
} from './use-meetings.js';
export {
  ASK_QUESTION_MAX,
  PLAYBACK_RATES,
  activeSegmentIndex,
  chapterIndexAt,
  chaptersOf,
  clipFromWire,
  clipOf,
  formatCallSummaryPreview,
  formatClock,
  formatDue,
  formatTimeRange,
  meetingsErrorMessage,
  momentOf,
  parseCallSummary,
  silencesFromSegments,
  silencesOf,
  skipSilenceTarget,
  summaryFromWire,
  summaryStatusText,
  summaryStyleLabel,
} from '@poolse/sdk';
export type {
  CallSummary,
  Clip,
  ClipInfo,
  ClipStatus,
  FollowUpDraft,
  MeetingAnswer,
  MeetingCallRef,
  MeetingCitation,
  MeetingMoment,
  PlaybackRate,
  RecordingChapter,
  RecordingPlayback,
  SilenceRange,
  SummaryActionItem,
  SummaryItem,
  SummaryMoment,
  SummarySection,
  SummaryStatus,
} from '@poolse/sdk';

// Experimental: the shared-document relay (`poolse.realtime.doc`).
export { DocChannel, DocPushError, DEFAULT_DOC_LIMITS } from '@poolse/sdk';
export type { DocEditor, DocJoinInfo, DocLimits, DocRights, DocClosedReason } from '@poolse/sdk';
