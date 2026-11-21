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
export { useUser, type UseUserState } from './use-user.js';
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
export {
  useReadReceipts,
  receiptsOf,
  canEditOwnMessage,
  EDIT_WINDOW_MS,
  type UseReadReceipts,
} from './use-read-receipts.js';
