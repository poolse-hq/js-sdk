// Hand-rolled response types matching poolse's OpenAPI schemas.
//
// TODO: replace with auto-generated types from openapi-typescript once a
// build-step exists to snapshot poolse's `/openapi.json`. The hand-rolled
// versions stay aligned by following the OpenAPI schema modules verbatim
// (see poolse/apps/caas_api/lib/caas_api_web/schemas/*.ex).

export type Uuid = string;
export type IsoDateTime = string;

// ── identity ─────────────────────────────────────────────────────────────

export interface Me {
  id: Uuid;
  tenant_id: Uuid;
  external_id: string;
  display_name: string | null;
  custom_data: Record<string, unknown>;
  is_blocked: boolean;
  inserted_at: IsoDateTime;
  updated_at: IsoDateTime;
}

// ── conversations ────────────────────────────────────────────────────────

export type ConversationType = 'direct' | 'group';

export interface Conversation {
  id: Uuid;
  tenant_id: Uuid;
  type: ConversationType;
  /** Display name (for group chats); null for unnamed conversations. */
  name: string | null;
  /** Public avatar URL; null when none uploaded. */
  avatar_url: string | null;
  /** User that created the conversation; null for system-created rows. */
  created_by_user_id: Uuid | null;
  /** Hard cap on memberships; null = unlimited (tenant default). */
  member_limit: number | null;
  /**
   * Customer-supplied free-form data — anything you want to attach to
   * the conversation that doesn't fit the schema (UI flags, tags, etc).
   * Server treats it as opaque JSON.
   */
  custom_data: Record<string, unknown>;
  /**
   * Server-defined behavioral knobs (notification rules, retention,
   * etc). Defaults to `{}` and is updateable.
   */
  settings: Record<string, unknown>;
  /** Most recent message's `inserted_at`; null until first message. */
  last_message_at: IsoDateTime | null;
  /** Monotonic per-conversation sequence counter (last message's `sequence`). */
  last_sequence: number;
  /**
   * Number of messages the caller hasn't read yet
   * (`last_sequence - sequence_of(my_last_read_message_id)`).
   * Populated only by `chat.conversations.list()` — undefined when the
   * conversation is fetched via other paths.
   */
  unread_count?: number;
  inserted_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface ConversationList {
  data: Conversation[];
}

export interface ConversationCreateRequest {
  type: ConversationType;
  name?: string | null;
  avatar_url?: string | null;
  member_limit?: number | null;
  /**
   * Customer-side user IDs to add as members on creation — saves a
   * round-trip vs creating then calling `addMembers`.
   */
  member_external_ids?: string[];
  custom_data?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

export interface ConversationUpdateRequest {
  name?: string | null;
  avatar_url?: string | null;
  member_limit?: number | null;
  custom_data?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

// ── memberships ──────────────────────────────────────────────────────────

export type MemberRole = 'owner' | 'admin' | 'member';

export interface Membership {
  id: Uuid;
  conversation_id: Uuid;
  user_id: Uuid;
  role: MemberRole;
  last_read_message_id: Uuid | null;
  last_read_at: IsoDateTime | null;
  inserted_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface MembershipList {
  data: Membership[];
}

/**
 * Server accepts a batch of `external_ids` (the customer's stable user
 * identifiers — what was passed to `POST /v1/users`). The server
 * resolves each to its internal user_id and creates a membership row
 * per external_id, all in one round-trip. Optional `role` defaults to
 * `"member"` server-side.
 *
 * Most callers use the higher-level
 * `chat.conversations.one(id).addMember(externalId)` /
 * `addMembers([externalIds])` methods which build this shape for you.
 */
export interface MembershipCreateRequest {
  external_ids: string[];
  role?: MemberRole;
}

// ── messages ─────────────────────────────────────────────────────────────

export type MessageType = 'text' | 'system' | 'custom';

export interface Message {
  id: Uuid;
  tenant_id: Uuid;
  conversation_id: Uuid;
  sender_id: Uuid | null;
  type: MessageType;
  body: string | null;
  reply_to_id: Uuid | null;
  thread_root_id: Uuid | null;
  /**
   * Number of replies in the thread rooted at this message. Server
   * populates on REST list + initial fetch; defaults to 0 for new
   * messages broadcast over realtime. SDK increments locally when a
   * new reply lands so the thread pill ("💬 N replies") updates live.
   */
  reply_count?: number;
  mentions: Uuid[];
  reactions: Record<string, Uuid[]>;
  /**
   * Attachments linked to this message. Server populates on send +
   * realtime broadcast; absent on partial responses (e.g. when the
   * client posted with attachment_ids but the server has yet to
   * resolve them).
   */
  attachments?: Attachment[];
  edited_at: IsoDateTime | null;
  deleted_at: IsoDateTime | null;
  sequence: number;
  inserted_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface MessageList {
  data: Message[];
}

export interface MessageCreateRequest {
  /**
   * Plain-text body. Optional only when `attachment_ids` is non-empty
   * — a message with attachments AND no body is valid (just the
   * attachment renders). At least one of `body` or `attachment_ids`
   * must be present.
   */
  body?: string | null;
  type?: MessageType;
  reply_to_id?: Uuid;
  mentions?: Uuid[];
  /**
   * Attach previously-uploaded attachments to this message. Each id
   * must come from `chat.attachments.upload(...)` or the lower-level
   * `requestUpload(...)` flow and must belong to the same tenant.
   * The server links them in the same transaction as the insert, so
   * the broadcast and REST response both carry the resolved
   * `Attachment` rows in `message.attachments`.
   */
  attachment_ids?: Uuid[];
  /**
   * Client-supplied UUID for retry-safe sends. The SDK fills this in
   * automatically when not provided so the optimistic temp row and
   * the canonical server row share a single id (used for id-based
   * dedup in `useMessages`).
   */
  id?: Uuid;
}

export interface MessageUpdateRequest {
  body: string;
}

export interface ReadRequest {
  message_id: Uuid;
}

export interface ReactionRequest {
  emoji: string;
}

// ── attachments ──────────────────────────────────────────────────────────

export type AttachmentStatus = 'pending' | 'ready';

export interface Attachment {
  id: Uuid;
  tenant_id: Uuid;
  /** Linked message id; null while the attachment is still `:pending`. */
  message_id: Uuid | null;
  /** Uploader; null for system-created attachments. */
  sender_id: Uuid | null;
  content_type: string;
  byte_size: number;
  /** Server-computed SHA-256 of the uploaded bytes; populated after the PUT completes. */
  sha256: string | null;
  original_filename: string | null;
  status: AttachmentStatus;
  inserted_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface AttachmentUploadRequest {
  content_type: string;
  byte_size: number;
  original_filename?: string;
}

/** Presigned PUT payload returned by `POST /v1/attachments/upload-url`. */
export interface AttachmentUploadResponse {
  attachment: Attachment;
  upload: {
    url: string;
    method: 'put';
    /** Headers the client MUST include on the PUT (signed into the URL). */
    headers: Record<string, string>;
  };
}

/** Presigned GET payload returned by `GET /v1/attachments/:id/download-url`. */
export interface AttachmentDownloadResponse {
  url: string;
  method: 'get';
}

// ── canonical error envelope ─────────────────────────────────────────────

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    doc_url: string;
    details?: Record<string, unknown>;
  };
}
