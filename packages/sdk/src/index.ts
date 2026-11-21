// Public SDK surface.

export { Poolse } from './poolse.js';
export { POOLSE_API_URL } from './config.js';
export type { PoolseConfig } from './config.js';

export {
  ApiError,
  AuthError,
  ChannelReplyError,
  PoolseError,
  NetworkError,
  RateLimitedError,
} from './errors.js';

// Re-export the resource classes so callers can use them in type
// signatures (e.g. dependency injection). They aren't normally
// instantiated directly — go through `new Poolse(config)` instead.
export {
  type AddMemberOptions,
  ConversationHandle,
  ConversationsResource,
  OwnMembershipHandle,
} from './resources/conversations.js';
export { CallTokensResource } from './resources/call-tokens.js';
export { LiveCallsResource } from './resources/live-calls.js';
export type { LiveCall, LiveCallMember } from './resources/live-calls.js';
export {
  CallsResource,
  CallRecordingApi,
  CallTranscriptionApi,
  CallTranscriptApi,
  type CallRecordingState,
  type CallTranscriptionState,
  type CaptureStorage,
  type ConsentDecision,
  type ConsentPolicy,
  type ConsentResult,
  type ConversationRecordingSettings,
  type ConversationRecordingSettingsUpdate,
  type ListPageOptions,
  type Recording,
  type RecordingDownload,
  type RecordingMode,
  type RecordingStatus,
  type Transcript,
  type TranscriptSegment,
  type TranscriptSpeaker,
  type TranscriptStatus,
  type TranscriptWithSegments,
  type WhoMayRecord,
} from './resources/calls.js';
export {
  POOLSE_SERVICE_IDENTITY_PREFIX,
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
  type LiveTranscriptSegment,
  type RecordingNotice,
  type RecordingNoticeDisplay,
  type TranscriptBlock,
} from './recording.js';
export { RoomsResource, type RoomSession } from './resources/rooms.js';

// Agents: badge, approvals, citations (AG1, AG4, AG5).
export {
  APPROVAL_REASON_MAX,
  ApprovalsResource,
  agentFromWire,
  approvalErrorMessage,
  approvalFromWire,
  approvalStatusLabel,
  citationLabel,
  citationsOf,
  formatApprovalPreview,
  kindPayload,
  messageAgent,
  parseApproval,
  type AgentApproval,
  type AgentInfo,
  type ApprovalDetail,
  type ApprovalListOptions,
  type ApprovalStatus,
  type Citation,
  type CitationType,
} from './agents.js';

// Meetings: summaries, asking, clips, playback (RT6–RT9, RT13).
export {
  ASK_QUESTION_MAX,
  MeetingsResource,
  PLAYBACK_RATES,
  activeSegmentIndex,
  chapterIndexAt,
  chaptersOf,
  clipOf,
  formatCallSummaryPreview,
  formatClock,
  formatDue,
  formatTimeRange,
  meetingAnswerFromWire,
  meetingsErrorMessage,
  parseCallSummary,
  silencesOf,
  skipSilenceTarget,
  summaryStyleLabel,
  transcriptOffsetMs,
  type CallSummary,
  type ClipInfo,
  type MeetingAnswer,
  type MeetingLink,
  type PlaybackRate,
  type RecordingChapter,
  type SilenceRange,
  type SummaryActionItem,
  type SummaryMoment,
} from './meetings.js';

// Experimental: the live-edit relay for shared documents (MS5).
export {
  DEFAULT_DOC_LIMITS,
  DocChannel,
  DocPushError,
  openDocChannel,
  type DocClosedReason,
  type DocEditor,
  type DocJoinInfo,
  type DocLimits,
  type DocRights,
} from './realtime/doc.js';
export { CallRoom } from './voice/call-room.js';
export type {
  CallConnection,
  CallDevice,
  CallDeviceKind,
  CallParticipant,
  CallRoomOptions,
  CallRoomStatus,
  CameraFacing,
  CheckedLiveKitModule,
  LiveKitLocalVideoTrack,
  LiveKitModule,
  LiveKitParticipant,
  LiveKitPublication,
  LiveKitRoomHandle,
  LiveKitTrack,
  LiveKitTrackReference,
} from './voice/livekit-types.js';
export { MeResource, type UpdateMeRequest } from './resources/me.js';
export { DevicesResource } from './resources/devices.js';
export type {
  Device,
  DeviceEnvironment,
  DeviceKind,
  DevicePlatform,
  RegisterDeviceRequest,
} from './resources/devices.js';
export { ConversationMessages, MessageHandle, MessagesResource } from './resources/messages.js';
export { UsersResource } from './resources/users.js';
export {
  NotificationActions,
  createNotificationActions,
  parseNotificationActions,
  type MessagePushData,
  type MessageReadPushData,
  type NotificationActionId,
  type NotificationActionsOptions,
  type NotificationReadRequest,
  type NotificationReplyRequest,
} from './notification-actions.js';
export {
  PRESENCE_MAX_LOOKUP,
  PresenceResource,
  type PresenceLookup,
  type PresenceMe,
  type PresenceRealtime,
  type TrackActivityOptions,
} from './resources/presence.js';
export type { AttachmentProgressEvent } from './resources/attachments.js';
export {
  AttachmentHandle,
  AttachmentsResource,
  type AttachmentOptions,
  type AttachmentUploadInput,
} from './resources/attachments.js';

// Realtime / WebSocket layer.
export {
  PoolseRealtime,
  ConversationChannel,
  TranscriptChannel,
  UserChannel,
} from './realtime/realtime.js';
export type {
  CallFinishedEvent,
  CallParticipantsEvent,
  CallStartedEvent,
  AppEvent,
  ConversationCreatedEvent,
  ConversationReadEvent,
  UnreadTotalsEvent,
  ConversationUpdatedEvent,
  MemberReadEvent,
  MentionEvent,
  RingEndedEvent,
  MessageDeletedEvent,
  MessageStreamEvent,
  MessageNewEvent,
  MessageUpdatedEvent,
  PresenceChangedEvent,
  PresenceSnapshot,
  ThreadUpdatedEvent,
  ReactionEvent,
  RealtimeStatus,
  RecordingChangedEvent,
  RecordingConsentEvent,
  RecordingStartedEvent,
  TranscriptChangedEvent,
  TranscriptJoinReply,
  TranscriptSegmentEvent,
  TranscriptSpeakersEvent,
  TypingEvent,
  Unsubscribe,
} from './realtime/types.js';

export type {
  AgentWire,
  ApiErrorCode,
  CitationWire,
  Attachment,
  AttachmentDownloadResponse,
  AttachmentStatus,
  AttachmentUploadRequest,
  AttachmentUploadResponse,
  Conversation,
  ConversationCreateRequest,
  ConversationList,
  ConversationListOptions,
  ConversationType,
  ConversationUpdateRequest,
  ErrorEnvelope,
  IncludeDeletedOption,
  IsoDateTime,
  LinkPreview,
  LinkPreviewType,
  LocalMessageStatus,
  Me,
  NotificationPreferences,
  NotifyLevel,
  OwnMembership,
  OwnMembershipUpdateRequest,
  QuietHours,
  ReadReceiptsState,
  MemberRole,
  Membership,
  MembershipCreateRequest,
  MembershipList,
  Message,
  MessageCreateRequest,
  MessageEdit,
  MessageEditList,
  MessageList,
  MessageType,
  MessageUpdateRequest,
  PoolseUserProfile,
  Presence,
  PresenceActivity,
  PresenceList,
  PresenceState,
  QuotedMessagePreview,
  ReactionRequest,
  ReadRequest,
  ThreadParticipant,
  Uuid,
} from './types.js';

// Keeping a local message list in step with server events.
export {
  applyThreadUpdate,
  isTombstone,
  markQuoteDeleted,
  mergeMessage,
  toTombstone,
} from './message-state.js';

// ── Calling ──────────────────────────────────────────────────────────
// Phones ring and carry calls in the native call core
// (@poolse/native); the web joins rooms (`poolse.rooms`,
// `CallRoom`). What both share:
export type { CallMedia } from './voice/types.js';

export { version } from './version.js';

// Call-log system messages (`{"kind":"call",…}` bodies) — shared
// parser + display helpers used by @poolse/react-ui and
// @poolse/react-native.
export {
  parseCallLog,
  parseCallLogBody,
  isCallLogMessage,
  isMessageVisibleTo,
  describeCallLog,
  callLogDisplayFor,
  formatCallDuration,
  formatCallLogPreview,
  type CallLog,
  type CallLogEntry,
  type CallMissedEntry,
  type CallLogMedia,
  type CallLogDisplay,
  type CallParticipantStatus,
  type CallEndReason,
} from './call-log.js';

// Cross-runtime UUID v4 used internally for idempotency keys, client
// message ids, upload queue local ids. Exported so RN consumers can
// reuse the same fallback in their own config callbacks if they want.
export { safeUuid } from './uuid.js';

// Several clients side by side, offline and speed budgets (3.8).
export type { DestroyOptions, ScopedService, WakeOptions } from './poolse.js';
export {
  createIndexedDbStorage,
  memoryStorage,
  type IndexedDbStorageOptions,
  type PoolseStorage,
} from './storage.js';
export { ClientTimings, type BuiltInTiming, type TimingEvent } from './timings.js';
export { LocalCache, type LocalCacheOptions } from './local-cache.js';
export {
  MessageDiscardedError,
  MessageQueuedError,
  Outbox,
  isRetryable,
  type OutboxEntry,
} from './outbox.js';
export { UnreadResource, type UnreadSummary, type UnreadTotals } from './resources/unread.js';
