# Changelog

All notable changes to `@poolse/sdk` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org).

## [1.0.0-beta.0] — 2026-06-01

First beta of the stable API surface. Consolidates everything from
the 0.2.x line (realtime read receipts, per-conv unread counts,
thread + reply_count, quote replies, MemberReadEvent, attachment
preloads, the AbortError preservation fix). No breaking API changes
relative to `0.2.0-alpha.7` — only a version promotion + diagnostic
log cleanup.

## [0.2.0] — 2026-06-01

### Added — quote replies (WhatsApp-style)

- `Message.quoted_message_id?: Uuid | null` + `Message.quoted_message?:
QuotedMessagePreview` — server preloads on REST list + realtime
  broadcast so the SDK can render the inline quote card without a
  per-message lookup. Body truncated to ~200 chars server-side.
- `MessageCreateRequest.quoted_message_id?: Uuid` — quote a message
  on send. Stays in the main feed (independent of `reply_to_id`,
  which still drives thread promotion).
- New `QuotedMessagePreview` type exported from the package root.

### Added

- `Message.reply_count?: number` — number of replies in the thread
  rooted at this message. Populated by REST list; defaults to 0 over
  realtime (a brand-new message can't have replies yet). Drives the
  thread pill in `<MessageRow>` and increments locally in
  `useMessages` when a reply lands.

### Fixed

- `RestClient.request` no longer wraps `AbortError` as a `NetworkError`
  — it now re-throws the `DOMException` as-is. The previous wrapping
  defeated abort detection in `useMembers` / `useConversation` /
  `useAttachmentUrl`, so a StrictMode-induced re-mount or a fast
  conversation switch surfaced "Failed to load …" UI even though the
  underlying request was cancelled, not failed.

### Added

- `MemberReadEvent` — wire shape for the server's `member:read` push,
  emitted on the conversation channel whenever any member advances
  their read cursor.
- `ConversationChannel.onMemberRead(fn)` — subscribe to read-cursor
  advances. The companion `useMembers` hook wires this so the sender's
  read-receipt glyph flips from "sent" to "read" without a refetch.
- `Conversation.unread_count?: number` — populated by
  `chat.conversations.list()`. Diff between `last_sequence` and the
  caller's `last_read_message_id`'s sequence; powers sidebar badges.

### Changed

- `PoolseConfig.apiUrl` is now optional. Defaults to the hosted
  endpoint at `https://api.poolse.dev`. Self-hosted / staging
  deployments still override via the field.
- Exports new `POOLSE_API_URL` constant for callers who want to
  reference the default explicitly.

### Added

- `Message.attachments?: Attachment[]` — server populates on send +
  realtime broadcast for messages with linked attachments.
- `MessageCreateRequest.attachment_ids?: Uuid[]` — send a message
  with one or more previously-uploaded attachments.
- `MessageCreateRequest.body` is now optional (was required) — a
  message with attachments and no body is valid.

## [0.1.0] — 2026-06-01

First publishable release.

### Added

- `Poolse` client class with REST resources: `me`, `conversations`
  (list/create/get/update + members), `messages` (send/list/mark-read +
  edit/delete/replies/reactions on per-id handle), `attachments`
  (presigned upload + download + delete).
- `RestClient` low-level wrapper:
  - Bearer JWT via `config.getToken` (async or sync; nullable for
    deliberate unauthenticated calls).
  - Auto-generated `Idempotency-Key` for non-GET requests
    (`crypto.randomUUID()` by default; overrideable).
  - Exponential backoff with full jitter for transient failures.
  - `Retry-After` header honoured on 429.
  - Network errors retried (except `AbortError`).
  - 401 → `AuthError`, 429 → `RateLimitedError`, other 4xx/5xx → `ApiError`,
    network failures → `NetworkError`. All `instanceof`-checkable.
- Initial scaffold: TypeScript, dual ESM+CJS build via tsup, vitest,
  eslint, prettier, Node 22 Docker dev environment.

## [0.0.1] — scaffolding only

Placeholder release. The real `Poolse` client class (REST + Channels +
offline queue) lands in subsequent SDK tasks under Phase 1F.
