// Public surface of @poolse/react — headless hooks for the poolse SDK.
//
// Wrap your app in <PoolseProvider config={{apiUrl, getToken}}>, then
// use the hooks below to access live state + actions. The provider
// owns one Poolse instance for its mount lifetime.

export { PoolseProvider, usePoolse, type PoolseProviderProps } from './provider.js';
export { useMe } from './use-me.js';
export { useConversation } from './use-conversation.js';
export { useConversations } from './use-conversations.js';
export { useMembers } from './use-members.js';
export { useMessages } from './use-messages.js';
export { useReactions, type ReactionMap } from './use-reactions.js';
export { useThread } from './use-thread.js';
export { useTyping } from './use-typing.js';
export { usePresence } from './use-presence.js';
export { useRealtimeStatus } from './use-realtime-status.js';
export { useAttachmentUpload } from './use-attachment-upload.js';
export { useAttachmentUrl } from './use-attachment-url.js';
export { useUser, type UseUserState } from './use-user.js';

// Re-export the SDK so consumers can pull in types / errors from one
// package — saves a second `npm install @poolse/sdk` for React-only apps.
export type {
  Attachment,
  AttachmentStatus,
  AttachmentUploadInput,
  AttachmentUploadRequest,
  AttachmentUploadResponse,
  Conversation,
  ConversationCreateRequest,
  Me,
  MemberRole,
  Membership,
  Message,
  MessageCreateRequest,
  MessageType,
  PoolseConfig,
  PoolseUserProfile,
  RealtimeStatus,
  Uuid,
} from '@poolse/sdk';
export { ApiError, AuthError, PoolseError, NetworkError, RateLimitedError } from '@poolse/sdk';
