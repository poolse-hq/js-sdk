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
export { MeResource } from './resources/me.js';
export { ConversationMessages, MessageHandle, MessagesResource } from './resources/messages.js';
export { UsersResource } from './resources/users.js';
export {
  AttachmentHandle,
  AttachmentsResource,
  type AttachmentOptions,
  type AttachmentUploadInput,
} from './resources/attachments.js';

// Realtime / WebSocket layer.
export { PoolseRealtime, ConversationChannel, UserChannel } from './realtime/realtime.js';
export type {
  ConversationCreatedEvent,
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

export { version } from './version.js';
