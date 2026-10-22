// Public SDK surface.

export { Poolse } from './poolse.js';
export { POOLSE_API_URL } from './config.js';
export type { PoolseConfig } from './config.js';

export { ApiError, AuthError, PoolseError, NetworkError, RateLimitedError } from './errors.js';

// Re-export the resource classes so callers can use them in type
// signatures (e.g. dependency injection). They aren't normally
// instantiated directly — go through `new Poolse(config)` instead.
export {
  type AddMemberOptions,
  ConversationHandle,
  ConversationsResource,
} from './resources/conversations.js';
export { CallTokensResource } from './resources/call-tokens.js';
export { LiveCallsResource } from './resources/live-calls.js';
export type { LiveCall, LiveCallMember } from './resources/live-calls.js';
export { RoomsResource, type RoomSession } from './resources/rooms.js';
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
export type { AttachmentProgressEvent } from './resources/attachments.js';
export {
  AttachmentHandle,
  AttachmentsResource,
  type AttachmentOptions,
  type AttachmentUploadInput,
} from './resources/attachments.js';

// Realtime / WebSocket layer.
export { PoolseRealtime, ConversationChannel, UserChannel } from './realtime/realtime.js';
export type {
  CallFinishedEvent,
  CallParticipantsEvent,
  CallStartedEvent,
  ConversationCreatedEvent,
  ConversationUpdatedEvent,
  MemberReadEvent,
  MentionEvent,
  MessageDeletedEvent,
  MessageNewEvent,
  MessageUpdatedEvent,
  PresenceSnapshot,
  ReactionEvent,
  RealtimeStatus,
  TypingEvent,
  Unsubscribe,
} from './realtime/types.js';

export type {
  Attachment,
  AttachmentDownloadResponse,
  AttachmentStatus,
  AttachmentUploadRequest,
  AttachmentUploadResponse,
  Conversation,
  ConversationCreateRequest,
  ConversationList,
  ConversationType,
  ConversationUpdateRequest,
  ErrorEnvelope,
  IsoDateTime,
  Me,
  ReadReceiptsState,
  MemberRole,
  Membership,
  MembershipCreateRequest,
  MembershipList,
  Message,
  MessageCreateRequest,
  MessageList,
  MessageType,
  MessageUpdateRequest,
  PoolseUserProfile,
  QuotedMessagePreview,
  ReactionRequest,
  ReadRequest,
  Uuid,
} from './types.js';

// ── Calling ──────────────────────────────────────────────────────────
// Phones ring and carry calls in the native call core
// (@poolse/react-native-calls); the web joins rooms (`poolse.rooms`,
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
