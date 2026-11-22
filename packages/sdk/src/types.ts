// Hand-rolled response types matching poolse's OpenAPI schemas.
//
// TODO: replace with auto-generated types from openapi-typescript once a
// build-step exists to snapshot poolse's `/openapi.json`. The hand-rolled
// versions stay aligned by following the OpenAPI schema modules verbatim
// (see poolse/apps/caas_api/lib/caas_api_web/schemas/*.ex).

import type {
  AttachmentKind,
  AttachmentPurpose,
  Block,
  ForwardedFrom,
  Poll,
  PollCreate,
  ProcessingStatus,
  AttachmentTranscriptStatus,
} from './messaging-plus.js';

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
  /** Where read receipts stand for this user. Absent on older servers (treat as on). */
  read_receipts?: ReadReceiptsState;
  /** The user's own notification preferences. Absent on older servers. */
  notifications?: NotificationPreferences;
  /** This user is an agent. */
  is_agent?: boolean;
}

/**
 * How a conversation notifies the user: every message, only messages
 * that mention them, or nothing. Calls ring regardless.
 */
export type NotifyLevel = 'all' | 'mentions' | 'none';

/** A daily quiet time in the user's own time zone, e.g. 22:00–07:00. */
export interface QuietHours {
  /** `HH:MM`. */
  start: string;
  /** `HH:MM`; earlier than `start` means the window wraps past midnight. */
  end: string;
  /** IANA time zone, e.g. `Europe/Skopje`. */
  timezone: string;
}

/**
 * The user's own say over message notifications (`Me.notifications`,
 * set with `me.update({ notifications })`). Per-conversation choices
 * live on the membership — see {@link OwnMembership}.
 */
export interface NotificationPreferences {
  /** Do-not-disturb: no message notifications until then. Null = not paused. */
  paused_until: IsoDateTime | null;
  /** Default for group conversations; null follows the workspace. */
  groups: 'all' | 'mentions' | null;
  /** Daily quiet time; null = none. */
  quiet_hours: QuietHours | null;
}

/**
 * The workspace's read-receipt setting, as it applies to one user.
 * `visible: false` means the app shows no check marks at all — the
 * server withholds other members' read state anyway.
 */
export interface ReadReceiptsState {
  /** `on`: everyone sees them; `off`: nobody; `user`: each user decides (reciprocal). */
  mode: 'on' | 'off' | 'user';
  /** Whether others see when this user reads. */
  shared: boolean;
  /** True only in `user` mode — the app may offer a switch (`me.update`). */
  can_change: boolean;
  /** Whether this user sees other people's read state. */
  visible: boolean;
}

// ── presence ─────────────────────────────────────────────────────────────

/**
 * A user's presence across all of their devices:
 *
 *   * `online` — a connected device is active.
 *   * `away` — connected, but every device is idle.
 *   * `in_call` — in a live call's or room's media.
 *   * `offline` — no connected device for more than 30 s.
 */
export type PresenceState = 'online' | 'away' | 'in_call' | 'offline';

/** What this device reports about itself (`presence:set`, join param `presence`). */
export type PresenceActivity = 'active' | 'idle';

/** One user's presence (`GET /v1/presence`, `presence:get`, `presence:changed`). */
export interface Presence {
  user_id: Uuid;
  external_id: string | null;
  state: PresenceState;
  /**
   * online / in_call: about now; away: when they went idle; offline:
   * their last disconnect (null if never seen).
   */
  last_seen_at: IsoDateTime | null;
  /** The user's own notification pause, while it lasts. Not evented — absent on `presence:changed`. */
  dnd_until?: IsoDateTime | null;
  /** Paused or inside their quiet hours right now. Not evented — absent on `presence:changed`. */
  do_not_disturb?: boolean;
}

/** `GET /v1/presence`. */
export interface PresenceList {
  data: Presence[];
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
  /**
   * Plaintext preview of the most recent message body, truncated to
   * 80 chars. Updated server-side by `send_message`. Null when the
   * conversation has no messages, or when the last message had no
   * body (in which case `"📎 Attachment"` etc is returned).
   *
   * Note: stored unencrypted on the server (deliberate denorm so
   * the conversation list doesn't pay a per-row decrypt). Apps with
   * full at-rest-encryption requirements should ignore this field
   * and render their own preview client-side.
   */
  last_message_preview: string | null;
  /** Monotonic per-conversation sequence counter (last message's `sequence`). */
  last_sequence: number;
  /**
   * Number of messages the caller hasn't read yet
   * (`last_sequence - sequence_of(my_last_read_message_id)`).
   * Populated only by `chat.conversations.list()` — undefined when the
   * conversation is fetched via other paths.
   */
  unread_count?: number;
  /** How many of the unread messages mention the caller. Absent on older servers. */
  mention_unread_count?: number;
  /**
   * The caller's notification level for this conversation; null follows
   * their default (`Me.notifications.groups`, then the workspace).
   */
  notify?: NotifyLevel | null;
  /** The caller muted this conversation until then (mentions still notify); null = not muted. */
  muted_until?: IsoDateTime | null;
  /**
   * Tenant `external_id`s of every member, in no particular order.
   * Populated by code paths that preload the memberships
   * (`chat.conversations.list()`); may be `[]` on responses where
   * memberships weren't preloaded (webhook payloads, some create
   * responses). Use this to render the other-party name on a direct
   * conversation row without a separate `useMembers` call.
   */
  member_external_ids?: string[];
  inserted_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface ConversationList {
  data: Conversation[];
  /**
   * Opaque cursor for the next page — pass it as `cursor` to
   * `conversations.list()`. Null on the last page; absent on servers
   * that don't page the list.
   */
  next_cursor?: string | null;
}

/** Query for `conversations.list()` — `GET /v1/conversations`. */
export interface ConversationListOptions {
  /** `next_cursor` of the previous page; omit for the first page. */
  cursor?: string | null;
  /** Page size, 1–100 (server default 50). */
  limit?: number;
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
  /** Internal poolse user id. Most consumer code uses `external_id` instead. */
  user_id: Uuid;
  /**
   * The tenant's own user identifier (the same string you pass as
   * `external_id` when minting JWTs or referencing users in
   * `member_external_ids`). Every user reference on the wire carries
   * this so the SDK's `userResolver(externalId)` is a complete API
   * — no need to maintain a `poolse_user_id` mapping on your side.
   */
  external_id: string;
  role: MemberRole;
  /** The member is an agent (AG1): show the Agent badge. Absent on older servers. */
  is_agent?: boolean;
  last_read_message_id: Uuid | null;
  last_read_sequence: number | null;
  last_read_at: IsoDateTime | null;
  inserted_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface MembershipList {
  data: Membership[];
}

/**
 * The caller's own membership of a conversation —
 * `GET /v1/conversations/:id/membership` — carrying how that
 * conversation notifies them.
 */
export interface OwnMembership {
  conversation_id: Uuid;
  role: MemberRole;
  /** Per-conversation level; null follows the user's default. */
  notify: NotifyLevel | null;
  /** Silent until then, except for mentions; null = not muted. */
  muted_until: IsoDateTime | null;
}

/** `PATCH /v1/conversations/:id/membership` — send only what changes. */
export interface OwnMembershipUpdateRequest {
  notify?: NotifyLevel | null;
  muted_until?: IsoDateTime | null;
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

export type MessageType = 'text' | 'system' | 'custom' | 'poll' | 'blocks';

/** Where an unsent message stands in the outbox; see `Message.local_status`. */
export type LocalMessageStatus = 'sending' | 'queued' | 'failed';

export interface Message {
  id: Uuid;
  tenant_id: Uuid;
  conversation_id: Uuid;
  /** Internal poolse user id of the sender. Null for system messages. */
  sender_id: Uuid | null;
  /**
   * The tenant's own user identifier for the sender — passed straight
   * to `userResolver(externalId)` to render display name + avatar.
   * Null for system messages, and null on read paths that didn't
   * preload the sender (very rare; every client-facing path preloads).
   */
  sender_external_id: string | null;
  type: MessageType;
  body: string | null;
  /** The sender is an agent (AG1): its avatar and name carry the Agent badge. */
  sender_is_agent?: boolean;
  /** Said during this call (CL6): the in-call chat. Absent on older servers. */
  call_id?: Uuid | null;
  /**
   * Null except on an agent's message: `{kind, citations?, approval_id?,
   * followup_id?, standup_id?}`. Read with `agentMetaOf(message)` /
   * `citationsOf` / `approvalIdOf`.
   */
  agent_meta?: Record<string, unknown> | null;
  reply_to_id: Uuid | null;
  thread_root_id: Uuid | null;
  /**
   * Number of live replies in the thread rooted at this message. Every
   * top-level message carries it (REST and events); `thread:updated`
   * keeps it current. The React hooks also bump it locally when a reply
   * lands so older servers still update the thread pill.
   */
  reply_count?: number;
  /** When the thread's newest live reply was posted; null without replies. */
  last_reply_at?: IsoDateTime | null;
  /** Who replied in the thread, most recent first, at most 10. */
  thread_participants?: ThreadParticipant[];
  /**
   * Quote reply (WhatsApp-style): id of the message being quoted.
   * Independent of `reply_to_id` (which drives thread promotion).
   * Quoted replies stay in the main feed, NOT in a thread side-pane.
   */
  quoted_message_id?: Uuid | null;
  /**
   * Trimmed preview of the quoted message — server preloads on
   * REST list + realtime broadcast so the SDK can render the inline
   * quote card without a per-message lookup. `body` is truncated
   * to ~200 chars; null when the quoted message was deleted post-quote.
   */
  quoted_message?: QuotedMessagePreview | null;
  mentions: Uuid[];
  reactions: Record<string, Uuid[]>;
  /**
   * Attachments linked to this message. Server populates on send +
   * realtime broadcast; absent on partial responses (e.g. when the
   * client posted with attachment_ids but the server has yet to
   * resolve them).
   */
  attachments?: Attachment[];
  /**
   * Previews of the first links in `body`, fetched by the server after
   * the send or edit; the message then arrives again as
   * `message:updated`. Empty until fetched, on tombstones, and when the
   * workspace turned previews off. Absent on older servers.
   */
  link_previews?: LinkPreview[];
  /** `type: "poll"` only (MS3); the question is `body`. */
  poll?: Poll | null;
  /** REST only, poll messages: the caller's votes. */
  my_option_ids?: string[];
  /** `type: "blocks"` only (IN4); `body` is the plain-text fallback. */
  blocks?: Block[];
  /** Pinned in its conversation (MS13). */
  pinned_at?: IsoDateTime | null;
  pinned_by_id?: Uuid | null;
  /** A forwarded copy: where it came from (MS13). */
  forwarded_from?: ForwardedFrom | null;
  /** A thread reply also shown in the channel (MS19). */
  also_in_channel?: boolean;
  edited_at: IsoDateTime | null;
  /**
   * Set on a tombstone: a deleted message keeps its id, sequence, sender
   * and thread fields, with `body: null`, no quote, mentions, reactions,
   * attachments or link previews. See {@link isTombstone}.
   */
  deleted_at: IsoDateTime | null;
  sequence: number;
  inserted_at: IsoDateTime;
  updated_at: IsoDateTime;
  /**
   * Client-only: set by the outbox on a message this client sent that
   * hasn't reached the server — `'sending'` (on its way), `'queued'`
   * (offline; it goes out on reconnect, under the same id) or
   * `'failed'` (the server refused it; offer Retry / Delete). Absent on
   * every message from the server.
   */
  local_status?: LocalMessageStatus;
  /** Client-only: why a `'failed'` send was refused, for display. */
  local_error?: string;
}

/** One person who replied in a thread (`Message.thread_participants`). */
export interface ThreadParticipant {
  user_id: Uuid;
  external_id: string | null;
}

/** `LinkPreview.type`: a web page, or a link straight to an image. */
export type LinkPreviewType = 'website' | 'image';

/**
 * A link's preview (`Message.link_previews`). Images are not proxied:
 * load `image_url` / `favicon_url` directly.
 */
export interface LinkPreview {
  /** Exactly as written in the message body — match on it. */
  url: string;
  type: LinkPreviewType;
  title?: string | null;
  description?: string | null;
  site_name?: string | null;
  image_url?: string | null;
  favicon_url?: string | null;
}

/** An earlier version of an edited message (`messages.edits(id)`). */
export interface MessageEdit {
  /** 1 is the original text. */
  version: number;
  body: string | null;
  /** When this version was written (sent or edited). */
  written_at: IsoDateTime;
  /** When the next version replaced it. */
  replaced_at: IsoDateTime;
  editor_id: Uuid | null;
}

/** `GET /v1/messages/:id/edits`. */
export interface MessageEditList {
  /** Earlier versions, oldest first. */
  data: MessageEdit[];
  /** The version the message is at now (`data.length + 1`). */
  current_version: number;
  edited_at: IsoDateTime | null;
}

/**
 * Customer-supplied user metadata — the SDK doesn't know your users'
 * names or where their avatars live. Customers wire a
 * `PoolseConfig.userResolver` that maps a poolse `Uuid` to whatever
 * their app already stores: a display name, an avatar URL.
 *
 * The SDK caches resolved profiles in-memory (deduplicating
 * concurrent lookups) so a 50-message render only fires one
 * resolver call per unique sender.
 */
export interface PoolseUserProfile {
  /**
   * The name shown in sender labels, mention dropdowns, member
   * lists, and read-receipt tooltips. Customers usually pass their
   * app's `display_name` / `username` / `full_name`.
   */
  displayName: string;
  /**
   * Square avatar URL (any size — the UI scales). Null = render the
   * fallback `<Avatar>` with initials. Optional so customers that
   * don't track avatars can omit the field.
   */
  avatarUrl?: string | null;
  /**
   * This user is an agent, not a person: every avatar and name of theirs
   * carries the Agent badge. Users, members and messages from the
   * server that say `is_agent` mark it too, so a resolver needn't.
   */
  isAgent?: boolean;
  /** The agent's details, when `isAgent`. */
  agent?: { id: string | null; name: string | null; kind: string | null } | null;
}

/**
 * Compact preview of a quoted message, embedded on the quoting
 * message when `Message.quoted_message_id` is set. Just enough for
 * the UI to render the inline quote card.
 */
export interface QuotedMessagePreview {
  id: Uuid;
  sender_id: Uuid | null;
  /** Same external-id story as `Message.sender_external_id`. */
  sender_external_id: string | null;
  /** Truncated to ~200 chars server-side; null when the original was deleted. */
  body: string | null;
  deleted_at: IsoDateTime | null;
  inserted_at: IsoDateTime;
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
  /**
   * Quote-reply target. The new message keeps `thread_root_id` null
   * (no thread promotion) and is delivered alongside other top-level
   * messages, with a preview card pointing at this id. Must reference
   * a message in the same conversation.
   */
  quoted_message_id?: Uuid;
  mentions?: Uuid[];
  /**
   * Tag the message as said during this call (CL6, docs/MEETINGS.md §6):
   * the call must be live in this conversation, else the tag is dropped
   * and the message still goes. `GET /v1/calls/:id/messages` lists them.
   */
  call_id?: Uuid;
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
   * Send despite a data-loss-prevention warning (AD6): the first send
   * failed with `dlp_warning`, and the sender chose "Send anyway". Has no
   * effect on `dlp_blocked`.
   */
  dlp_acknowledged?: boolean;
  /** `type: "poll"`: the options; `body` is the question (1–500 chars). */
  poll?: PollCreate;
  /** `type: "blocks"`: 1–50 blocks, ≤ 16 KB; `body` is required as the fallback. */
  blocks?: Block[];
  /** With `reply_to_id`: also show the reply in the channel (MS19). */
  also_send_to_channel?: boolean;
  /**
   * Client-supplied UUID for retry-safe sends. The SDK fills this in
   * automatically when not provided so the optimistic temp row and
   * the canonical server row share a single id (used for id-based
   * dedup in `useMessages`).
   */
  id?: Uuid;
}

/**
 * `PATCH /v1/messages/:id` — sender only. Send `body` to edit, and/or
 * `remove_link_previews` to drop previews: a list of their `url`s
 * (at most 10) or `true` for all of them (none is fetched for the
 * message again). Removed links stay removed through later edits.
 */
export interface MessageUpdateRequest {
  body?: string;
  remove_link_previews?: string[] | true;
  /** A block message's sender replaces its blocks (no edit history). */
  blocks?: Block[];
  dlp_acknowledged?: boolean;
}

/** History options for `messages.list()` and `messages.one(id).replies()`. */
export interface IncludeDeletedOption {
  /**
   * Return deleted messages as tombstones. Without it, history only
   * shows deleted messages that still root live replies, and replies
   * leave deleted ones out.
   */
  include_deleted?: boolean;
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
  /**
   * Set on a clip cut from a call recording (RT9): what it was cut
   * from. Read with `clipOf(attachment)`.
   */
  clip?: { clip_id?: string; recording_id: string; start_ms: number; end_ms: number } | null;
  /** docs/PLATFORM_PLUS.md §1 — absent on older servers. */
  conversation_id?: Uuid | null;
  kind?: AttachmentKind;
  purpose?: AttachmentPurpose | null;
  duration_ms?: number | null;
  processing_status?: ProcessingStatus | null;
  transcript_status?: AttachmentTranscriptStatus | null;
  /** Voice and video messages: the Soniox transcript (plain text). */
  transcript?: string | null;
  transcript_language?: string | null;
  /** Video messages: 1–3 sentences. */
  summary?: string | null;
  has_thumbnail?: boolean;
  has_preview?: boolean;
  /** Versions (MS18): 1 for the first; `version_group_id` is the first version's id. */
  version?: number;
  version_group_id?: Uuid;
  inserted_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface AttachmentUploadRequest {
  content_type: string;
  byte_size: number;
  original_filename?: string;
  /** A voice message (MS15) or a video message (MS16, ≤ 5 min). */
  purpose?: AttachmentPurpose;
  /** The recording's length as the recorder knows it (≤ 3 600 000). */
  duration_ms?: number;
  /** This file is a new version of that one (MS18). */
  replaces_attachment_id?: Uuid;
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

/**
 * Error codes the server answers with (`ApiError.code`). Not
 * exhaustive — any other string may arrive too.
 */
export type ApiErrorCode =
  | 'unauthorized'
  | 'invalid_user_token'
  | 'forbidden'
  | 'not_found'
  | 'validation_failed'
  | 'rate_limited'
  | 'message_not_found'
  | 'message_deleted'
  | 'quoted_message_deleted'
  | 'quoted_message_not_found'
  | 'quoted_message_wrong_conversation'
  | 'reply_parent_not_found'
  | 'send_failed'
  | 'edit_failed'
  | 'reaction_failed'
  | 'user_scope_required'
  | 'read_receipts_fixed'
  | 'device_signed_out'
  | 'user_blocked'
  | 'mau_cap_exceeded'
  // A send's client `id` is already taken by another message (sender,
  // conversation or tenant): permanent, never retried.
  | 'message_id_conflict'
  // Call recording, consent and transcripts (docs/RECORDING.md §3).
  | 'recording_unavailable'
  | 'recording_disabled'
  | 'not_allowed'
  | 'call_finished'
  | 'not_recording'
  | 'not_ready'
  | 'egress_failed'
  | 'invalid_mode'
  | 'invalid_decision'
  | 'transcription_unavailable'
  | 'transcription_disabled'
  | 'not_in_call'
  | 'not_transcribing'
  | 'unknown_error'
  // Keeps autocomplete for the codes above while accepting any string.
  | (string & {});

export interface ErrorEnvelope {
  error: {
    code: ApiErrorCode;
    message: string;
    doc_url: string;
    details?: Record<string, unknown>;
  };
}
