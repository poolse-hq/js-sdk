# Changelog

All notable changes to `@poolse/react` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org).

## [0.2.0] — 2026-06-01

### Added

- `useMessages.edit(messageId, body)` — optimistic edit with rollback
  on server error. Server enforces sender-only authorization.
- `useMessages.delete(messageId)` — optimistic soft-delete (sets
  `deleted_at` + null body locally, rolls back on error).
- `useMessages.markReadUpTo(messageId)` — wraps
  `chat.conversations.one(id).messages.markRead`; advances the
  caller's read cursor and triggers server-side read-receipt
  broadcasts to other members.

### Changed

- `useMembers(conversationId)` now treats an empty string id as
  "skip fetch" (returns `{ members: [], loading: false }`) so
  callers can conditionally enable member loading without wrapping
  in a `enabled ?` guard.
- Provider auto-resolves the SDK's new default `apiUrl` when none
  is passed in config.

## [0.1.1] — 2026-06-01

### Fixed

- `useMessages.send()` now stamps the optimistic temp message's
  `sender_id` with the current user's id (via `useMe` internally).
  Without this, self-sent messages briefly rendered on the "other"
  side of the chat until the realtime echo replaced them.

## [0.1.0] — 2026-06-01

First publishable release.

### Added

- `<PoolseProvider>` — mount-once SDK instance with ref-stable callbacks
  (safe to pass `config={{getToken: () => ...}}` inline on every render).
- `usePoolse()` — raw `Poolse` instance escape hatch.
- Realtime hooks: `useMe`, `useConversations`, `useConversation`,
  `useMembers`, `useMessages`, `useThread`, `useReactions`, `useTyping`,
  `usePresence`, `useRealtimeStatus`.
- Attachments: `useAttachmentUpload`, `useAttachmentUrl`.
- Real-time conversation list — `useConversations` subscribes to the
  user's `user:<id>` channel and prepends on `conversation:created`
  push (no manual refetch needed).
- Optimistic message send with id-based dedup: `useMessages.send()`
  inserts under the same id the server will assign, so realtime echo
  upserts in place.
