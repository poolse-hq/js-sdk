# Changelog

All notable changes to `@poolse/react` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org).

## [2.15.0] — 2026-08-23

### Fixed

- **Answering a call then hanging up left the other side in it.**
  `accept()` clears `incoming`, and a callee never had an `outgoing`, so
  `hangUp()` resolved no call id and returned before signalling. The
  call id of the call in progress is now tracked in its own right.
- **A late `call:cancelled` tore down a live call.** The guard fell
  through whenever `incoming` was null — exactly the state `accept()`
  leaves behind — so a caller's ring timeout firing as the callee
  answered dropped the callee straight out of the call.
- **Every call signal is now matched to the call it belongs to.**
  `accepted`, `declined`, `busy`, `ended` and `cancelled` are ignored
  unless they name the call this client is actually in. A signal about a
  previous call could previously end the current one.
- **A room could be left connected with nothing holding it.** If a call
  ended while its media was still connecting, the cleanup ran before
  `join()` resolved, found nothing to release, and the connection
  completed into a room no component held — audio still flowing, no UI,
  and no way to hang up. Both `useCallRoom` and `useVoiceRoom` now
  release a room that was superseded mid-connect.
- **`markBusy` could reject a call the user was being shown.** The
  decision ran inside a `setPhase` updater; updaters must be pure, and
  React may run them more than once.

## [2.14.1] — 2026-08-23

### Added

- **`useCallRoom().refreshDevices`** — re-read the device list on
  demand. Devices are already re-read on connect and on hardware
  changes; this covers the case neither does, which is that a browser
  only reveals device ids and labels once the page holds a matching
  permission, and that moment is not subscribable. Call it when opening
  a picker.

### Fixed

- Device lists inherited the `MediaDeviceInfo` spread bug from
  `@poolse/sdk`. See its 2.14.1 entry.

## [2.14.0] — 2026-08-23

### Added

- **`useCallRoom().devices` / `.activeDevices` / `.selectDevice`** —
  camera, microphone and audio-output selection, refreshed as devices
  come and go. Enumeration is deferred until the call connects, because
  a browser withholds device labels from a page that does not yet hold
  the matching permission.

## [2.13.1] — 2026-08-23

Republished in lockstep with `@poolse/react-native@2.13.1`. No changes
to this package.

## [2.13.0] — 2026-08-23

### Fixed

- **Video calls now open with the camera on.** `useCallRoom` pinned its
  options to the first render, but a call screen mounts long before a
  call exists — so the room was always built from options captured when
  nothing was ringing, i.e. audio. Cameras never opened on a video call
  and the toggle looked broken.

### Added

- **`useCallRoom().alone`** — everyone else has left and is not coming
  back. Wire it to your hang-up path; see `@poolse/sdk`'s
  `CallRoom.onAlone` for the guards that keep it from firing on an
  unanswered outbound call.
- **`useCallRoom().switchCamera` / `.facingMode`** — front/rear camera.
- **`useCallRoom`** options `facing` and `aloneGraceMs`.
- **`useVoiceRoom().alone`** — the same signal for the peer-to-peer mesh
  fallback, so both transports end an abandoned call.

## [2.0.0] — 2026-06-03

Lockstep release with `@poolse/sdk@2.0.0` and `@poolse/react-ui@2.0.0`.

### Breaking

- **`useUser(externalId)`** — was `useUser(userId)`. The hook now
  consumes the tenant's own user id. Pass the value from
  `message.sender_external_id`, `membership.external_id`, or any
  other external_id-shaped field on the wire.
- **`useTyping(conversationId).typing`** now returns `Set<externalId>`
  (was `Set<userId>`). Same for `usePresence(conversationId).online`.
- **`useMembers(conversationId).removeMember(externalId)`** — was
  `removeMember(userId)`. The hook translates external_id → user_id
  internally; the DELETE endpoint still takes user_id but you don't
  see it.

### Migration

See `MIGRATING.md` at the repo root.

## [1.1.0] — 2026-06-02

Lockstep release with `@poolse/sdk@1.1.0` and `@poolse/react-ui@1.1.0`.
No API changes in `@poolse/react` itself — version bumped to keep the
three packages in sync, so customers can pin one version across the
whole client surface.

### Changed

- README rewritten with a full per-hook reference: signatures, return
  shapes, the realtime channels each hook subscribes to, the optimistic
  send + thread routing strategy in `useMessages`, the buffered-reads
  race fix in `useMembers`, the cache + dedup semantics in `useUser`,
  and the synchronous-snapshot rollback pattern used by edits and
  optimistic removes.
- Repo-wide prettier formatting fixes (whitespace only).

## [1.0.0-beta.0] — 2026-06-01

First beta of the stable API. Promotes the full 0.2.x hook surface
(useMessages with reply_count routing, useThread with full-thread
fetch, useMembers with buffered read-receipt events,
useConversations with unreadCounts + markConversationRead) to a
stable namespace. No breaking changes relative to `0.2.0-alpha.7`
— version bump + removed verbose diagnostic logs.

## [0.2.0] — 2026-06-01

### Fixed

- Realtime read receipts now actually fire. The server-side broadcast
  call in `Messaging.do_mark_read` was missing — the alpha.2 commit
  added the channel handler and the SDK subscription but the broadcast
  itself never made it into the commit, so no `member:read` event was
  ever sent. Fixed in the matching server release; `useMembers` also
  logs received events as `[poolse] member:read received` for easy
  observability.

### Changed — thread replies routed to reply_count only

- `useMessages` no longer adds incoming thread replies to the main
  feed — replies belong to the side-pane that `useThread` populates.
  Realtime `message:new` with `thread_root_id` set now bumps the
  root's `reply_count` and skips the upsert. Matches the new server
  behavior (`WHERE thread_root_id IS NULL` on `list_messages`), so
  refresh and realtime stay consistent.
- `useThread` default page size raised from 50 → 500 so a typical
  thread loads in one round-trip. `loadMore` remains as an escape
  hatch.
- `useMembers` now buffers `member:read` events that fire before the
  initial fetch lands, then replays them once members are loaded.
  Fixes the realtime read-receipt race where reads arriving in the
  subscribe → fetch-response window were silently dropped.

### Added

- `useMessages` now maintains `Message.reply_count` live — increments
  on inbound thread reply, decrements on reply soft-delete. No server
  round-trip; the thread pill in `<MessageRow>` updates immediately.

### Fixed

- `useMembers` catch path now `console.error`s the underlying error
  with a `[poolse]` prefix so silent failures are debuggable from
  DevTools.

### Added (continued)

- `useMessages.edit(messageId, body)` — optimistic edit with rollback
  on server error. Server enforces sender-only authorization.
- `useMessages.delete(messageId)` — optimistic soft-delete (sets
  `deleted_at` + null body locally, rolls back on error).
- `useMessages.markReadUpTo(messageId)` — wraps
  `chat.conversations.one(id).messages.markRead`; advances the
  caller's read cursor and triggers server-side read-receipt
  broadcasts to other members.
- `useConversations` now exposes `unreadCounts: Record<convId, number>`
  plus `markConversationRead(convId)` for sidebar-badge UIs.
- `useThread.edit(messageId, body)` / `useThread.delete(messageId)`
  for inline reply editing inside `<ThreadView>`.

### Changed

- `useMembers(conversationId)` now treats an empty string id as
  "skip fetch" (returns `{ members: [], loading: false }`) so
  callers can conditionally enable member loading without wrapping
  in a `enabled ?` guard.
- `useMembers` subscribes to the new `member:read` realtime event
  and advances the matching membership's `last_read_message_id` /
  `last_read_at` in place. The sender's check-double glyph now
  flips in real time without a refetch.
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
