# Changelog

All notable changes to `@poolse/sdk` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org).

## [3.10.2] - 2026-11-23

### Fixed

- Retries no longer repeat work: POST/PATCH are never retried on a 5xx or
  a dropped connection (a failing scheduled send went out four times),
  only on 429 and on network errors raised before the request left the
  device (connection refused, DNS). The server's Idempotency-Key cache
  replays only 2xx responses, so it cannot dedupe a half-succeeded 5xx.
  GET/PUT/DELETE retry network errors, 502/503/504 and 429; a plain 500
  is no longer retried. `Retry-After` also accepts an HTTP date.

## [3.10.1] - 2026-11-23

### Added

- `CallDataChannel` (`getSelfId`, `sendData`, `onData`): what
  `CallReactions` and `ScreenAnnotations` take, so they run over
  @poolse/native's `callData` on phones as well as over `CallRoom`.

## [3.10.0] - 2026-11-23

### Added — messaging plus (docs/MESSAGING_PLUS.md, PLATFORM_PLUS.md §1)

- Scheduled send (MS1): `messages.schedule({body, send_at, …})`,
  `chat.scheduledMessages.list / update / cancel / sendNow`,
  `user.onScheduledMessage` (`scheduled_message:sent` / `failed`).
- Polls (MS3): `type: "poll"` with `poll: {options, multiple, anonymous,
closes_at}`; `messages.one(id).poll() / vote(optionIds) / closePoll()`;
  `conversation.onPollUpdated`; helpers `isPollClosed`, `pollPercentages`,
  `toggleVote`, `applyLocalVote`.
- Pins and forward (MS13): `pin()`, `unpin()`, `forward({conversation_ids,
comment})`, `messages.pins()`, `onPinChanged`; `Message.pinned_at`,
  `forwarded_from`.
- Thread follow and also-send-to-channel (MS19): `followState()`,
  `setFollow(on)`; `also_send_to_channel` on sends, `Message.also_in_channel`.
- `messages.catchUp({since, language})` (MS20), `translate(language)` (MS21).
- Interactive blocks (IN4): `type: "blocks"` with `blocks`, `Block` types,
  `action({action_id, value, values})`, `missingInputs`, `initialBlockValues`.
- Files and media (MS15, MS16, MS18): `messages.files({kind, limit, before})`,
  `attachments.versions / thumbnailUrl / previewUrl`, upload `purpose`
  (`voice` / `video_message`), `durationMs`, `replacesAttachmentId`,
  `opaque` (NT2); attachment `kind`, `transcript`, `summary`,
  `has_thumbnail`, `has_preview`, `version`; `onAttachmentProcessed`;
  `attachmentKind`, `mediaMessageOf`.
- `dlp_acknowledged` on sends, edits, schedules and forwards (AD6).
- `handNoteToAgent` (NT12): one decrypted note as a Markdown file on a
  message to an agent.

### Added

- Agents in calls (the server's docs/AGENTS_IN_CALLS.md; every path, field
  and event in `call-agents.ts`'s WIRE section): `poolse.callAgents`
  (`list`, `invite(callId, agentId, 'notetaker' | 'assistant')`, `setMode`,
  `remove`, `subscribe(conversationId, callId, { onAgents, onSaid })` for
  `call:agents` / `agent:said`), `.whisper` (`get`, `set`, `subscribe` for
  `whisper:hint` / `whisper:changed`), `.briefs` (`list`, `get`, `create`,
  `update`, `remove`); `poolse.escalations` (`list`, `reply(id, { decision }
| { answer })`, a live store on `agent:escalation`);
  `poolse.notificationActions.escalation({ escalationId, token, decision |
answer })` for answering with a push's `reply_token`, no session.
  `CallMeeting.agents`. Helpers: `callAgentOfParticipant` (token metadata
  `agent: true`, or the call's list), `isAgentMetadata`, `callAgentStateOf`,
  `callAgentStateLabel` ("Taking notes"), `callAgentModeLabel`,
  `whisperHintKindLabel`, `whisperErrorMessage`, `escalationStatusLabel`,
  `escalationErrorMessage`, `parseEscalationOptions`, and the
  `AgentEscalationPushData` type.
- `CallRoom.getParticipants()` lists agents in the call (last, with their
  metadata); they never count as company for `onAlone`.

- Live meetings (`poolse.live`, the server's docs/MEETINGS.md; every
  path/field/event in `meetings-live.ts`'s WIRE section): `stage` (`get`,
  `setMode`, `raiseHand`, `lowerHand`, `setRole`),
  `questions` (`list`, `ask`, `vote`, `unvote`, `setStatus`, `remove`),
  `breakouts` (`get`, `open`, `move`, `close`, `join`, `returnToMain` —
  rooms are parts of the main call), `lobby` (the conversation's: `get`,
  `admit`, `deny`, `admitAll` on a `LobbyTarget`), `moments` (`mark`,
  `list`, `remove`), `agenda`, `captions.set`, `quality.report`,
  `meetings` (`get`, `list`, `rsvp`), `phones` (dial-ins, `call`,
  `hangUp`), `guestLinks` (`create`, `list`, `revoke`), `meeting(callId)`
  (the snapshot's `meeting`: attendees, quality, captions…),
  `messages(callId)`, `react`, `rooms()`, `whiteboard(callId)`,
  `moveHere(callId)`, `subscribe(conversationId, callId, listeners, {
selfUserId })` and `subscribeUser(userId, { onRoomParticipants,
onMeetingStarting, onMeetingBrief })`. `GuestClient` (link, join,
  waitInLobby, session, leave, hand, react, questions, vote,
  reportQuality) and `waitInLobby` for browser guests. `call_id` on
  `MessageCreateRequest` / `Message` (in-call chat); `UserChannel.on`.
  Identities may be `guest_…` / `sip_…`: `identityKindOf`,
  `meetingNameOf`, `phoneLabel` ("Phone ···1234"). Helpers:
  `callMeetingOf`, `sortQuestions`, `stageRoleOf`,
  `participantRoleOf`, `planBreakouts`, `agendaOverrunMs`, `inCallElsewhere`,
  `meetingCardOf`, `rsvpOf`, `meetingJoinable`.
- `ConversationChannel.on(event, fn)` for topic events without a typed handler.
- `CallRoom`: `sendData` / `onData` (LiveKit data channel,
  `CALL_DATA_MAX_BYTES`), `CallParticipant.connectionQuality` and
  `.metadata`, `onReconnecting` / `isReconnecting`, `onDisconnected`
  (`'moved'` when you took the call on another device), `getConnectionQuality`,
  `getNetworkStats`, `setBackground` / `getBackground` /
  `backgroundSupported` (with `trackProcessors: @livekit/track-processors`
  passed in), `setNoiseSuppression` / `isNoiseSuppressionEnabled`
  (`noiseSuppression` option).
- `CallReactions` and `ScreenAnnotations` (pointer and pen over a shared
  screen) on the data channel; `CallQualityMonitor`, `diagnoseCallNetwork`,
  `connectionQualityLabel` for the plain-language network banner;
  `CallQualityMonitor`'s `report` option sends readings to the server
  (throttled; `qualityReportBody`).
- Whiteboard: `WhiteboardModel`, `openWhiteboard`, `bindYDoc` — strokes,
  shapes, text and an eraser in a Y.Doc over the doc relay; Yjs passed in.

- Agents (docs/AGENTS.md): `is_agent` on `Me` / `Membership`, `sender_is_agent`
  and `agent_meta` on `Message`, `sender_is_agent` on `MentionEvent`;
  `agentMetaOf`, `citationsOf` (numbered `Citation`s), `approvalIdOf`,
  `messageAgent`, `agentFromWire`. `users.agentOf` / `isAgent` /
  `noteAgents` / `noteAgentProfiles` remember who is an agent.
- `poolse.agents`: `list()` (`GET /v1/me/agents`), `inConversation`,
  `setScope`, `resetScope` (AG3), `memory`, `addMemory`, `updateMemory`,
  `deleteMemory` (AG10), `followups`, `followupDone`, `followupCancel` (AG11).
- `poolse.approvals` (AG4): `list({ status })`, `ensure(id)`, `approve(id, {
reason })`, `deny`, a live store (`subscribe`, `peek`, `pending`) following
  `agent:approval` on the user channel (`UserChannel.onAgentApproval`).
- `poolse.meetings` (docs/SUMMARIES.md): `summary`, `regenerateSummary`,
  `deleteSummary`, `summaries`, `styles`, `setCallStyle`,
  `conversationSettings`, `updateConversationSettings`, `followUp` (a
  draft), `ask` (`{ answer, citations, calls }`), `createClip`, `clips`,
  `clip`, `clipDownloadUrl`, `clipAttachment`, `deleteClip`, `playback`.
  `parseCallSummary` / `summaryFromWire` (v1 body: items with `start_ms`,
  `end_ms`, `recording_ms`; action items with `assignee_name`, `due_date`,
  `due_text`; `sections`; `shortened`), `MeetingMoment`, `momentOf`,
  `clipOf`, `chaptersOf`, `silencesOf`, `silencesFromSegments`,
  `skipSilenceTarget`, `activeSegmentIndex`, `formatDue`, `formatClock`,
  `summaryStatusText`, `formatCallSummaryPreview`, `meetingsErrorMessage`.
- Conversation channel: `onSummaryReady`, `onClipReady`, `onClipDeleted`.
  `Recording.chapters` (with `end_ms`), `Attachment.clip`.
- Experimental: `realtime.doc(docId, docToken, { clientId })` →
  `DocChannel`, the live-docs relay (docs/DOCS_RELAY.md): binary `update`,
  `awareness`, `sync_request` / `sync_reply`, `refresh`, presence, `closed`,
  `DocPushError` (`retryAfterMs`), join reply `limits` enforced locally.

## [3.9.0] - 2026-11-22

### Added

- Call recording, consent and transcripts (needs a poolse server with
  docs/RECORDING.md). `poolse.calls`:
  `recording.start(callId, { mode })`, `recording.stop`, `recording.list(conversationId, { limit, before })`,
  `recording.downloadUrl(recordingId)` (5-minute link), `recording.settings` /
  `updateSettings` (a conversation's `auto_record`, `consent`, …);
  `consent(callId, 'accepted' | 'declined')`; `transcription.start` / `stop`;
  `transcript.get(callId)`, `transcript.list(conversationId)`,
  `transcript.renameSpeakers(callId, { key: name | null })`. Types `Recording`,
  `Transcript`, `TranscriptWithSegments`, `TranscriptSpeaker`, `TranscriptSegment`, …
- `LiveCall.recording` (`CallRecordingState`: `available`, `active`, `mode`,
  `consent_required`, `consent.accepted/declined`, …) and `LiveCall.transcription`.
- Conversation channel: `onRecordingStarted` / `Stopped` / `Ready` / `Consent`,
  `onTranscriptStarted` / `Stopped` / `Ready` / `Speakers`, and
  `startRecording` / `stopRecording` / `sendConsent` over the socket.
- `realtime.transcript(callId)` → `TranscriptChannel` (`onJoined` with the last
  200 final segments, `onSegment`, `onError`, `release()`); `applyLiveSegment`
  folds interim and final segments.
- `CallRoom`: poolse's assistant (`poolse:…`, LiveKit kind agent) and the
  recorder (`EG_…`) are left out of `getParticipants()` and the "alone" check
  (`isServiceParticipant`). Publish permission is followed for consent:
  `canPublish()`, `onPublishPermission(fn)`, `republish()`; nothing is
  published (and no error raised) while it is withheld, and the microphone
  and camera come back by themselves once it returns
  (`republishOnPermission`, default `true`).
- The `{"kind":"recording"}` system message: `parseRecordingNotice`,
  `describeRecordingNotice`, `recordingNoticeDisplayFor`,
  `formatRecordingNoticePreview`. Also `captureLabel`, `captureErrorMessage`,
  `groupTranscript`, `findInText`, `speakerName`.
- Error codes: `recording_unavailable`, `recording_disabled`, `not_allowed`,
  `call_finished`, `not_recording`, `not_ready`, `egress_failed`,
  `invalid_mode`, `invalid_decision`, `transcription_unavailable`,
  `transcription_disabled`, `not_in_call`, `not_transcribing`.
  `recording.start` and `transcription.start` don't retry a 5xx (503 means
  not set up, 502 that Egress refused).

## [3.8.0] - 2026-11-21

### Added

- Several clients side by side: `client.namespace` (`poolse:v1:<apiUrl>#<user>`),
  `whenNamespace()`, `scoped(key, create)`, `onDestroy`, `destroyed`, `apiUrl`.
  Nothing is shared at module level.
- `destroy({ clearStorage })` now returns a promise and tears down timers,
  caches, outbox and scoped services as well; the instance is inert after it.
- `setBackground(bool)`, `isBackground()`, `wake({ forMs })`; `config.background`.
  `realtime.pause()` works before the first connect; `realtime.isPaused()`.
- `client.unread` (`get`, `subscribe`, `refresh`, `summary`) on
  `GET /v1/me/unread`, live from `unread:totals` (joins `user:<id>` with
  `unread_totals: true` while subscribed), `conversation:read.totals` and
  per-conversation deltas; falls back to summing the conversations seen.
  `UserChannel.onUnreadTotals` / `requestUnreadTotals`; `UnreadTotalsEvent`.
- `client.outbox`: queued offline sends resent with the same id on reconnect,
  refused ones kept as `failed` (`retry`, `remove`, `whenSent`, `onSent`,
  `flush`); `MessageQueuedError`, `MessageDiscardedError`, `isRetryable`.
  `Message.local_status` / `local_error`; `config.outbox` (default `true`).
- `client.cache` (`LocalCache`) and `PoolseStorage` with
  `createIndexedDbStorage()` and `memoryStorage()`; `config.storage`,
  `config.storageNamespace`, `config.cache`. The signed-in user is restored
  from storage for an offline start.
- `client.timings` (`ClientTimings`): `connect`, `reconnect`, `me`,
  `firstConversations`, `firstMessages`, `cachedConversations`,
  `cachedMessages`, plus `start(name)` / `record(name, ms)`.
- `MessagePushData` / `MessageReadPushData`: `tenant_id`, `workspace_name`,
  `workspace_icon_url`. `ApiErrorCode`: `message_id_conflict`.

### Fixed

- A socket error after `pause()` no longer flips the status back to
  `reconnecting`.

## [3.7.1] - 2026-11-21

- No changes; released with the other `@poolse/*` packages at 3.7.1.

## [3.7.0] - 2026-11-21

- No changes; released with the other `@poolse/*` packages at 3.7.0.

## [3.6.2] - 2026-11-21

- No changes; released with the other `@poolse/*` packages at 3.6.2.

## [3.6.1] - 2026-11-21

- No changes; released with the other `@poolse/*` packages at 3.6.1.

## [3.6.0] - 2026-11-21

### Added

- `conversations.one(id).markUnread(messageId)` (also on `.messages`):
  `POST /v1/conversations/:id/unread`, so the message and everything after it
  count as unread again (server rc.16).

## [3.5.0] - 2026-11-21

### Added

- Presence (`poolse.presence`, `PresenceResource`): `get({ userIds?, externalIds? })`
  (`GET /v1/presence`, any number of ids, sent 200 at a time); a shared store —
  `subscribe(ids, fn)` batches lookups from every caller in a tick, `peek(id)`
  reads the cache, and `presence:changed` keeps it live. Lookups go over the
  socket (`presence:get`, which also subscribes) while the user channel is
  joined, else REST; each (re)join asks again for everyone subscribed. Ids may
  be user ids or external ids.
- This device's activity: `presence.setActivity('active' | 'idle')` (sends
  `presence:set`; unchanged states are skipped, `active` re-sent at most once a
  minute), `presence.getActivity()`, and `presence.trackActivity({ idleAfterMs?,
document?, window? })` for browsers (hidden / blur / no input for 5 min →
  idle; a no-op without `document`). The `user:<id>` join carries
  `presence: 'active' | 'idle'`.
- `UserChannel.onPresenceChanged`, `setPresence`, `getPresence`, `onJoined`,
  `isJoined`; `ChannelReplyError` for refused or timed-out channel requests.
- Types `Presence`, `PresenceState`, `PresenceActivity`, `PresenceList`,
  `PresenceChangedEvent`, `PresenceLookup`, `TrackActivityOptions`;
  `PRESENCE_MAX_LOOKUP`.

- Notification actions without a session: `createNotificationActions({ apiUrl?,
fetch?, … })` and `poolse.notificationActions` (`NotificationActions`) with
  `reply({ token, text, id? })` (`POST /v1/notification-actions/reply`; `id`
  defaults to a fresh UUID and doubles as the idempotency key, so a retry
  returns the original message) and `read({ token })`. The push's
  `reply_grant` is sent as the bearer; 401 (`device_signed_out`, expired grant)
  is not retried.
- Push payload types `MessagePushData` (`reply_grant`, `actions`,
  `unread_total`, …) and `MessageReadPushData`; `NotificationActionId` and
  `parseNotificationActions(actions)`.
- Message actions: `messages.get(id)` / `messages.one(id).get()` (a deleted
  message comes back as its tombstone), `messages.edits(id)` /
  `messages.one(id).edits()` (`MessageEditList`, `MessageEdit`), and the
  `messages.update(id, attrs)` shortcut.
- `include_deleted` on `conversations.one(id).messages.list()` and
  `messages.one(id).replies()` (`IncludeDeletedOption`).
- Link previews: `Message.link_previews` (`LinkPreview`, `LinkPreviewType`)
  and `MessageUpdateRequest.remove_link_previews` (`string[] | true`).
- Thread summaries: `Message.last_reply_at`, `Message.thread_participants`
  (`ThreadParticipant`); `ConversationChannel.onThreadUpdated`
  (`thread:updated`, `ThreadUpdatedEvent`); `MessageDeletedEvent.thread_root_id`.
- Helpers for keeping a local message list in step: `isTombstone`,
  `toTombstone`, `mergeMessage`, `applyThreadUpdate`, `markQuoteDeleted`.
- Conversation list paging: `conversations.list({ cursor, limit })` returns
  `next_cursor` (null on the last page; `ConversationListOptions`), and
  `conversations.listAll({ limit?, signal? })` iterates every conversation
  across pages (`for await`). `list(signal)` keeps working.
- `ApiErrorCode` — the known error codes (`quoted_message_deleted`,
  `quoted_message_not_found`, `quoted_message_wrong_conversation`,
  `reply_parent_not_found`, `message_deleted`, `device_signed_out`, …);
  `ApiError.code` is typed with it (still any string).

### Changed

- `MessageUpdateRequest.body` is optional (an update may only remove link
  previews).

## [3.4.0] - 2026-11-21

- No changes; released with the other `@poolse/*` packages at 3.4.0.

## [3.3.0] - 2026-11-20

### Added

- `conversations.one(id).membership.get()` / `.update({ notify, muted_until })`
  (`OwnMembershipHandle`) for the caller's per-conversation notify level and
  mute; types `OwnMembership`, `OwnMembershipUpdateRequest`, `NotifyLevel`.
- `Conversation.mention_unread_count`, `notify` and `muted_until`.
- `Me.notifications` and `me.update({ notifications })`
  (`NotificationPreferences`: `paused_until`, `groups`, `quiet_hours`).
- `UserChannel.onConversationRead` (`conversation:read`,
  `ConversationReadEvent`) and `UserChannel.onAppEvent` (`app:event`,
  `AppEvent`).
- `poolse.onAppEvent(fn)`, and `realtime.peekUser()`.

### Changed

- An `app:event` of type `member:updated` drops the member's cached profile
  (`users.invalidate(data.external_id)`, or `invalidateAll()` when it names
  nobody).

## [3.2.0] — 2026-11-17

Stable release of everything in the 3.2.0 prereleases below (streaming agent replies, screen sharing, full screen, the redesigned call screen, screen sharing from iOS).

### Changed

- `CallParticipant` has three new fields, `screenSharing`, `screenTrack` and
  `screenTrackRef`. Code that builds `CallParticipant` objects by hand (test
  mocks, custom adapters) needs to set them.

## [3.2.0-dev.5] — 2026-11-17 (prerelease, npm tag `dev`)

No changes; released with the other packages.

## [3.2.0-dev.4] — 2026-11-16 (prerelease, npm tag `dev`)

No changes; released with the other packages.

## [3.2.0-dev.3] — 2026-11-16 (prerelease, npm tag `dev`)

No changes; released with the other packages.

## [3.2.0-dev.2] — 2026-11-16 (prerelease, npm tag `dev`)

### Added

- Screen sharing in calls and rooms: `CallRoom.setScreenShareEnabled(on, { audio })`,
  `isScreenShareEnabled()` and `canShareScreen()`. Each `CallParticipant` gains
  `screenSharing`, `screenTrack` and `screenTrackRef`, separate from the camera.
  Closing the browser's picker is not an error.
- `LiveCall.screen_share_allowed`: the workspace lets people share a screen
  (dashboard → Calls). Off, the media token cannot publish one.

## [3.2.0-dev.1] — 2026-11-04 (prerelease, npm tag `dev`)

### Added

- `message:stream` gains a `tool` status (the agent is running a tool; `tool` is its name).

## [3.2.0-dev.0] — 2026-11-04 (prerelease, npm tag `dev`)

### Added

- `ConversationChannel.onMessageStream()` and the `MessageStreamEvent`
  type for `message:stream`: an AI agent's reply as it's written
  (`started`, text `delta`s, `failed`). The finished reply arrives as
  `message:new` with the stream's `id`.

## [3.1.0] — 2026-10-27

### Added

- `realtime.pause()` / `realtime.resume()`: close the socket and reopen
  it while keeping every channel handle and its listeners, so code
  holding a handle keeps receiving events after resume.
- `UserChannel.onRingEnded()` and `UserChannel.onCallFinished()` for the
  `call:ring_ended` / `call:finished` events on `user:<id>`, and the
  `RingEndedEvent` type. No more reaching for the internal `_channel()`.
- `ConversationChannel.onClosed()`: fires when the channel closes for
  good — the server removed you from the conversation, or you left.

### Fixed

- A conversation channel the server closes (you were removed) is dropped,
  so `realtime.conversation(id)` returns a fresh handle instead of a dead
  one that never received events again.
- After a refused socket handshake (for example a revoked token) the
  realtime layer fetches a fresh token from `getToken` (at most every
  30s) instead of retrying with the cached one forever.

## [3.0.0] — 2026-10-26

### Changed

- **License.** From 3.0.0 this package is under the poolse SDK License
  (see `LICENSE`): free to use, including commercially, in apps built on
  poolse; not for use with other backends or to build a competing
  service. Versions before 3.0.0 remain MIT.
- First stable release; all `@poolse/*` packages move to 3.0.0 together.
  Earlier versions are deprecated. See `MIGRATING.md`.

### Added

- `LiveCall.video_allowed` and `LiveCall.max_participants`: the workspace's
  call limits, set on the dashboard's Calls page.

## [2.26.0] — 2026-10-22

### Removed

- **The legacy JS calling path.** `CallsResource` (`poolse.realtime.calls`,
  socket-signalled ringing), `VoiceRoom` (`poolse.realtime.voice`, the
  peer-to-peer room), `createBrowserWebRtcAdapter` / `isWebRtcAvailable`,
  `IceServersResource` (`poolse.iceServers`) and their types
  (`IncomingCall`, `OutgoingCall`, `Voice*`, `WebRtcAdapter`, …). The
  server no longer serves them. Phones call through the native call core
  (`@poolse/react-native-calls`); the web joins rooms (`poolse.rooms`,
  `CallRoom`). `CallMedia` stays.

### Fixed

- `version` reports the published version again (it said 2.24.0 in 2.25.0).

## [2.20.0] — 2026-10-13

### Changed

- Version bump to stay in step with `@poolse/react-ui` and
  `@poolse/react-native`, which carry this release's message-bubble
  redesign.

## [2.19.0] — 2026-08-25

### Changed

- Version bump to stay in step with `@poolse/react` and
  `@poolse/react-native`, which carry this release's call fixes.

## [2.18.0] — 2026-08-24

Republished in lockstep.

## [2.17.1] — 2026-08-24

Republished in lockstep.

## [2.17.0] — 2026-08-24

Republished in lockstep.

## [2.16.3] — 2026-08-24

Republished in lockstep.

## [2.16.2] — 2026-08-24

Republished in lockstep.

## [2.16.1] — 2026-08-24

Republished in lockstep.

## [2.16.0] — 2026-08-24

Republished in lockstep with `@poolse/react-native@2.16.0`.

## [2.15.2] — 2026-08-23

Republished in lockstep. No changes to this package.

## [2.15.1] — 2026-08-23

Republished in lockstep with `@poolse/react@2.15.1`. No changes to this
package.

## [2.15.0] — 2026-08-23

### Fixed

- **A video call on a machine with no camera failed outright.**
  `setCameraEnabled` throws `NotFoundError` on a desktop without a
  webcam, and that landed in `join()`'s error path and tore the call
  down — video calling was impossible from such a machine, when it
  should have connected as audio. Capture devices are now best-effort:
  a missing or refused camera _or_ microphone reports through
  `onError` and the call still connects. An SFU that genuinely cannot be
  reached still fails, as it should.

## [2.14.1] — 2026-08-23

### Fixed

- **Device lists came back with no ids and no names.** `listDevices`
  built its result by spreading each `MediaDeviceInfo`, but that is a
  WebIDL interface whose `deviceId`, `kind` and `label` are accessors on
  the _prototype_ — so `{ ...device }` produces `{}`. Every picker was a
  list of blank, unselectable rows. Each field is now read explicitly.
- Entries with an empty `deviceId` are dropped. A browser returns that
  placeholder for a device the page has not been granted, and offering
  it gives the user a row that cannot be selected.

## [2.14.0] — 2026-08-23

### Added

- **`CallRoom.listDevices` / `getActiveDevice` / `setActiveDevice`** —
  choose the camera, microphone or audio output a call runs on.
  `audiooutput` is the web's speakerphone button: it re-points playback
  through `setSinkId`. Not every browser implements that, so a refusal
  surfaces as an error and leaves the call where it was.
- **`CallRoom.onDevices`** — fires when devices are plugged in or
  removed, so a picker never offers a webcam that has been unplugged.
- **`CallDevice`** and **`CallDeviceKind`** types.

## [2.13.1] — 2026-08-23

Republished in lockstep with `@poolse/react-native@2.13.1`. No changes
to this package.

## [2.13.0] — 2026-08-23

### Added

- **`CallRoom.onAlone`** — fires when everyone else has left a connected
  call and is not coming back. A peer who hangs up cleanly sends
  `call:hangup`; this covers the case where no signal is ever sent
  because the app was killed, the phone lost signal or the tab was
  closed, and the only evidence is an empty SFU roster. Guarded twice:
  it never fires before somebody else has actually joined (so a caller
  waiting for an answer is safe), and the verdict waits out
  `CallRoomOptions.aloneGraceMs` (default 1500ms) so a simultaneous
  hang-up or a brief reconnect does not read as abandonment.
- **`CallRoom.switchCamera` / `getFacingMode`** — flips between the front
  and rear cameras by restarting the track under the existing
  publication, so the far side's tile never blanks.
- **`CallRoomOptions.facing`** — which camera a call opens on. Defaults
  to `'user'`; previously the platform chose, and Android routinely
  chose the rear camera.
- **`CameraFacing`** and **`LiveKitLocalVideoTrack`** types.

## [2.0.0] — 2026-06-03

Lockstep release with `@poolse/react@2.0.0` and `@poolse/react-ui@2.0.0`.
Single load-bearing change: the SDK no longer surfaces poolse-internal
user uuids in identity-shaped APIs — everything is keyed by the
tenant's own `external_id` instead.

### Breaking

- **`PoolseConfig.userResolver` signature changes.** Was
  `(userId: string) => UserProfile | null`; now
  `(externalId: string) => UserProfile | null`. Your resolver receives
  YOUR user id (the same string you pass when minting JWTs and as
  `member_external_ids`), so no `poolse_user_id` column is needed.
- **`Message.sender_external_id`** added (string | null, required on
  every wire payload that carries a sender).
- **`Membership.external_id`** added (string, required).
- **`QuotedMessagePreview.sender_external_id`** added.
- **`TypingEvent.external_id`** added — `useTyping` returns
  `Set<externalId>` instead of `Set<userId>`.
- **`UsersResource.{peek, get, subscribe, invalidate}`** all keyed by
  `externalId` (was `userId`). Same semantics; same caching.

### Migration

See `MIGRATING.md` at the repo root. For most apps it's a rename of
the resolver argument plus deleting the `poolse_user_id` column if
you stored one.

### Backend coupling

Pairs with the `poolse-server` change that:

- lazy-provisions unknown `external_id`s referenced in
  `POST /v1/conversations` (`member_external_ids`) and
  `POST /v1/conversations/:id/members` (`external_ids`), abuse-capped
  at 50/hour per JWT,
- emits `sender_external_id` / `external_id` on every user-shaped
  wire payload (REST, webhook, realtime).

Self-hosted `@poolse/sdk@2.0.0` against an older backend will get
`sender_external_id: null` everywhere — degraded display, but no crash.

## [1.1.0] — 2026-06-02

Lockstep release with `@poolse/react@1.1.0` and `@poolse/react-ui@1.1.0`.
No API changes in `@poolse/sdk` itself — version bumped to keep the
three packages in sync, so customers can pin one version across the
whole client surface.

### Changed

- README rewritten as a full reference: authentication model, every
  resource and method with its HTTP path, the realtime channel event
  catalogue with payload shapes, token caching semantics, idempotency
  conventions, retry behaviour, and the typed error hierarchy.
- Repo-wide prettier formatting fixes (whitespace only).

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
