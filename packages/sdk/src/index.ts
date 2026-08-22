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
export { IceServersResource, type IceServerResponse } from './resources/ice-servers.js';
export { CallRoom } from './voice/call-room.js';
export type {
  CallConnection,
  CallParticipant,
  CallRoomOptions,
  CallRoomStatus,
  LiveKitModule,
  LiveKitParticipant,
  LiveKitPublication,
  LiveKitRoomHandle,
  LiveKitTrack,
  LiveKitTrackReference,
} from './voice/livekit-types.js';
export { MeResource } from './resources/me.js';
export { DevicesResource } from './resources/devices.js';
export type {
  Device,
  DeviceEnvironment,
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

// ── Voice + calling ──────────────────────────────────────────────────
export { VoiceRoom } from './voice/voice-room.js';
export { CallsResource } from './voice/calls.js';
export { createBrowserWebRtcAdapter, isWebRtcAvailable } from './voice/webrtc-browser.js';
export type {
  CallMedia,
  CallAccepted,
  CallBusy,
  CallCancelled,
  CallEnded,
  CallDeclined,
  IncomingCall,
  OutgoingCall,
  VoiceCandidate,
  VoiceDescription,
  VoiceIceServer,
  VoiceParticipant,
  VoicePeerConnection,
  VoiceRoomOptions,
  VoiceStatus,
  VoiceStream,
  VoiceTrack,
  WebRtcAdapter,
} from './voice/types.js';

export { version } from './version.js';

// Cross-runtime UUID v4 used internally for idempotency keys, client
// message ids, upload queue local ids. Exported so RN consumers can
// reuse the same fallback in their own config callbacks if they want.
export { safeUuid } from './uuid.js';
