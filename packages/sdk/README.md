# `@poolse/sdk`

The headless TypeScript client for [poolse](https://poolse.dev): REST, the
realtime WebSocket, rooms and call media on the web. No UI and no framework.

If you use React, [`@poolse/react`](https://www.npmjs.com/package/@poolse/react)
(hooks) and [`@poolse/react-ui`](https://www.npmjs.com/package/@poolse/react-ui)
(components) sit on top of this package.

Full reference: <https://poolse.dev/docs/sdk/sdk>

## Install

```bash
npm install @poolse/sdk
```

`phoenix` (the Phoenix Channels client) is a dependency and installs with it.

Requirements: a global `fetch` for REST (browsers, React Native, Deno, Bun,
Node 18+) and a global `WebSocket` for realtime (browsers, React Native,
Deno, Bun, Node 22+). On older Node, set `globalThis.WebSocket` before the
first realtime call. Upload progress needs `XMLHttpRequest` (browsers only).

## Authentication

The SDK acts as one end user, with a short-lived JWT that your backend mints
with its API key (`POST /v1/users/:user_id/tokens`). Never ship an API key to
a client. The SDK calls your `getToken` when it needs a JWT, caches it until
30 seconds before it expires, and asks again once after a 401.

## Quick start

```ts
import { Poolse } from '@poolse/sdk';

const poolse = new Poolse({
  getToken: async () => {
    const res = await fetch('/api/chat-token', { method: 'POST' });
    const { token } = await res.json();
    return token;
  },
});

const { data: conversations } = await poolse.conversations.list();
const conv = poolse.conversations.one(conversations[0].id);
await conv.messages.send({ body: 'Hello' });

const live = poolse.realtime.conversation(conv.id);
const off = live.onMessage((msg) => console.log(msg.body));

off();
poolse.destroy();
```

## Configuration

| Field                            | Default                     | Meaning                                                                |
| -------------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| `getToken`                       | required                    | `() => Promise<string \| null> \| string \| null`                      |
| `apiUrl`                         | `https://api.poolse.dev`    | API origin, without `/v1`.                                             |
| `wsUrl`                          | `apiUrl` with `http` → `ws` | Socket origin.                                                         |
| `socketPath`                     | `/socket`                   |                                                                        |
| `fetch`                          | `globalThis.fetch`          |                                                                        |
| `maxRetries`                     | `3`                         | Retries for network errors, 5xx and 429.                               |
| `baseBackoffMs` / `maxBackoffMs` | `250` / `30000`             | Backoff.                                                               |
| `generateIdempotencyKey`         | `safeUuid`                  |                                                                        |
| `onSocketError`                  | —                           | `(err: Error) => void`                                                 |
| `userResolver`                   | —                           | `(externalId) => { displayName, avatarUrl? } \| null` (sync or async). |
| `storage`                        | memory only                 | `PoolseStorage` for the outbox, cached history and the user.           |
| `storageNamespace`               | poolse user id              | Who this session is, known at start (offline start).                   |
| `outbox`                         | `true`                      | Queue offline sends; keep refused ones as `failed`.                    |
| `cache`                          | 50 msgs × 50 convs          | `{ messagesPerConversation, conversations, listRows }`.                |
| `background`                     | `false`                     | Start with the socket closed (`setBackground(false)` opens it).        |

## What's in it

| Member                                        | Covers                                                                                                                                                                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `poolse.me`                                   | `show`, `update({ read_receipts })` or `update({ notifications })`, `peek`, `onChange`                                                                                                                                                                                   |
| `poolse.conversations`                        | `list({ cursor, limit })` → `next_cursor`, `listAll()` (async iterator), `create`, `one(id)` → `show`, `update`, `listMembers`, `addMembers`, `addMember`, `removeMember(userId)`, `messages.list / send / markRead`, `membership.get / update({ notify, muted_until })` |
| `poolse.messages`                             | `get(id)`, `edits(id)`, `update(id, { body?, remove_link_previews? })`, `one(id)` → `get`, `edits`, `update`, `delete`, `replies({ include_deleted? })`, `addReaction`, `removeReaction`                                                                                 |
| `poolse.presence`                             | `get({ userIds?, externalIds? })`, `subscribe(ids, fn)`, `peek(id)`, `setActivity('active' \| 'idle')`, `getActivity`, `trackActivity()`                                                                                                                                 |
| `poolse.notificationActions`                  | `reply({ token, text, id? })`, `read({ token })` with a push's `reply_grant` (also `createNotificationActions({ apiUrl })`, no session)                                                                                                                                  |
| `poolse.attachments`                          | `upload`, `requestUpload`, `one(id)` → `downloadUrl`, `delete`                                                                                                                                                                                                           |
| `poolse.users`                                | Cache over `userResolver`: `get`, `peek`, `subscribe`, `invalidate`, `invalidateAll`                                                                                                                                                                                     |
| `poolse.devices`                              | `register`, `unregister` (push tokens)                                                                                                                                                                                                                                   |
| `poolse.liveCalls`                            | `get(conversationId)`                                                                                                                                                                                                                                                    |
| `poolse.calls`                                | `recording.start / stop / list / downloadUrl / settings / updateSettings`, `consent`, `transcription.start / stop`, `transcript.get / list / renameSpeakers` — see below                                                                                                 |
| `poolse.rooms`                                | `start`, `ring`, `leave`                                                                                                                                                                                                                                                 |
| `poolse.callTokens`                           | `create(conversationId)`                                                                                                                                                                                                                                                 |
| `poolse.call(conversationId, { livekit, … })` | `CallRoom`: call media on the web (pass your `livekit-client` import)                                                                                                                                                                                                    |
| `poolse.realtime`                             | `conversation(id)`, `user(id)`, `leave`, `getStatus`, `onStatus`, `connect`, `pause`, `resume`, `disconnect`                                                                                                                                                             |
| `poolse.rest.request({ method, path, … })`    | Any endpoint, with the same auth, retries and idempotency                                                                                                                                                                                                                |

Conversation channels emit `onMessage`, `onMessageUpdated`,
`onMessageDeleted`, `onThreadUpdated`, `onTypingStart`, `onTypingStop`, `onReactionAdded`,
`onReactionRemoved`, `onMemberRead`, `onCallStarted`, `onCallParticipants`,
`onCallFinished`, `onPresenceState`, `onPresenceDiff` and `onClosed`, and
have `sendTyping()` and `getPresenceState()`. The user channel emits
`onMention`, `onConversationCreated`, `onConversationUpdated`,
`onConversationRead` (your read position moved on any of your devices: fresh
`unread_count` and `mention_unread_count`), `onAppEvent` (`{ type, data }`
sent by your backend or the Workspace API), `onRingEnded`
(`RingEndedEvent`: `reason` is `answered_elsewhere`, `declined`,
`cancelled`, `timeout` or `finished`), `onCallFinished` (with
`conversation_id`) and `onPresenceChanged`, and has `setPresence(state)`,
`getPresence({ user_ids } | { external_ids })`, `onJoined` and `isJoined`.

## Recording, consent and transcripts

On a poolse server with call recording (its `docs/RECORDING.md`):

```ts
const rec = await poolse.calls.recording.start(callId, { mode: 'audio' }); // or 'video'
await poolse.calls.recording.stop(callId); // status 'stopping'; recording:ready follows
const list = await poolse.calls.recording.list(conversationId);
const { url } = await poolse.calls.recording.downloadUrl(rec.id); // valid 5 minutes; 409 not_ready until ready

await poolse.calls.consent(callId, 'accepted'); // or 'declined' (listen-only)

await poolse.calls.transcription.start(callId); // live transcript on
const t = await poolse.calls.transcript.get(callId); // speakers + segments
await poolse.calls.transcript.renameSpeakers(callId, { [speakerKey]: 'Elena' }); // null: their own name
```

Every call snapshot (`liveCalls.get`, `call:started`) carries `recording`
(`available`, `active`, `mode`, `consent_required`, `consent.accepted` /
`declined`) and `transcription`, so someone joining late sees it at once.
Changes arrive on the conversation channel: `onRecordingStarted` (with
`notice: 'spoken' | 'banner'`), `onRecordingStopped`, `onRecordingReady`
(`status` `ready` or `failed`), `onRecordingConsent`, `onTranscriptStarted`
/ `Stopped` / `Ready` / `Speakers`. Errors are `ApiError` codes:
`recording_unavailable` (503), `recording_disabled`, `not_allowed`,
`call_finished`, `not_recording`, `not_ready`, `egress_failed` (502 — e.g.
nobody's media connected yet), `invalid_mode`, `transcription_unavailable`,
`transcription_disabled`, `not_in_call`; `captureErrorMessage(err)` words them.

The live transcript has its own topic:

```ts
const t = poolse.realtime.transcript(callId); // shared; release() when done
t.onJoined(({ transcript, segments }) => …); // the last 200 final segments, on every (re)join
t.onSegment((s) => (list = applyLiveSegment(list, s))); // interim replaced by the speaker's next
t.release();
```

**Consent.** Where the workspace or room requires it, someone who hasn't
accepted may not publish while the call is captured: the SFU withholds
publish permission. `CallRoom` publishes nothing meanwhile (and raises no
error), and once they accept it republishes the microphone and camera as
they last had them — `canPublish()`, `onPublishPermission(fn)`,
`republish()`, `republishOnPermission: false` to do it yourself.

poolse's own participants — the transcript assistant (`poolse:assistant:…`,
LiveKit kind agent) and the recorder (`EG_…`) — are left out of
`CallRoom.getParticipants()`; use `isServiceParticipant(identity, kind)` for
your own rosters. The `{"kind":"recording"}` system message posted at each
start and stop is read with `parseRecordingNotice` /
`recordingNoticeDisplayFor(msg, meId, nameFor)` /
`formatRecordingNoticePreview`.

## Agents, meetings and live docs

Built against the server's docs/AGENTS.md, docs/SUMMARIES.md and
docs/DOCS_RELAY.md. Each wire shape is read in one mapping section
(`agents.ts`, `meetings.ts`, `realtime/doc.ts`).

**Agents (AG1).** Users and members carry `is_agent`, messages and
`mention:new` `sender_is_agent`. The hooks feed rows to
`poolse.users.noteAgents(rows)`; `poolse.agents.list()` (`GET
/v1/me/agents`) adds names; `users.agentOf(externalId)` / `isAgent` answer
from both (or your resolver's `isAgent`). The UI packages badge every
avatar and name of an agent.

An agent's message has `agent_meta`: `agentMetaOf(msg)` → `{ kind
('asked' | 'watch' | 'standup_update' | …), citations, approvalId, … }`.

**Approvals (AG4).** The asking message carries `agent_meta.approval_id`:

```ts
const id = approvalIdOf(message);
const a = await poolse.approvals.ensure(id); // from GET /v1/me/approvals?status=all; null if not yours
await poolse.approvals.list(); // pending ones
await poolse.approvals.approve(id); // POST /v1/me/approvals/:id/approve
await poolse.approvals.deny(id, { reason: 'Not this week' }); // ≤ 500 chars
poolse.approvals.subscribe(() => poolse.approvals.pending()); // live: agent:approval
```

`AgentApproval`: `tool`, `summary` ("Create issue (github)"), `details`
(the arguments as label/value lines), `status` (`pending` → `running` →
`done` | `failed`, or `declined`, `expired`, `replaced`, `cancelled`),
`expiresAt`. `approvalErrorMessage(err)` words 404 / 409 `not_pending` /
410 `expired`.

**Citations (AG5).** `citationsOf(message)` → numbered `Citation`s
(`n`, `type`: `message` | `file` | `transcript` | `summary` | `memory`,
`snippet`, `title`, and per-type `messageId`, `attachmentId`, `fileName`,
`callId`, `startMs`, `speaker`, `summaryId`, `factId`).

**Scopes, memory, follow-ups (AG3, AG10, AG11).**
`agents.inConversation(conversationId)` (each agent with `scope.ceiling`,
`.conversation`, `.effective`), `setScope(conversationId, agentId, { mode,
tools, readHistory })`, `resetScope`; `agents.memory({ conversationId, kind,
q })`, `addMemory`, `updateMemory`, `deleteMemory`; `agents.followups({
status })`, `followupDone`, `followupCancel`.

**Meetings (RT6–RT9, RT12, RT13).** Two clocks: transcript time
(`startMs`) and recording time (`recordingMs`); a `MeetingMoment` carries
both.

```ts
const s = parseCallSummary(message); // the v1 system message; s.shortened → meetings.summary(callId)
conv.onSummaryReady(({ call_id, summary }) => …); // regenerated, failed, skipped, deleted
await poolse.meetings.regenerateSummary(callId, { style: 'retro' });
await poolse.meetings.followUp(callId, { channel: 'email' }); // a draft; poolse never sends it
const { answer, citations, calls } = await poolse.meetings.ask({ question, callId, conversationId });
const clip = await poolse.meetings.createClip(recordingId, { startMs, endMs, base: 'transcript' });
// clip:ready → share it:
const { attachmentId } = await poolse.meetings.clipAttachment(clip.id); // then send attachment_ids
const p = await poolse.meetings.playback(recordingId); // url (5 min), chapters, transcript in recording ms
```

Helpers: `momentOf(summary, item)`, `summaryStatusText`, `summaryStyleLabel`,
`formatDue(dueDate, dueText)`, `chapterIndexAt`, `skipSilenceTarget`,
`silencesFromSegments`, `activeSegmentIndex`, `formatClock`,
`PLAYBACK_RATES`, `meetingsErrorMessage` (`no_model`, `no_transcript`,
`clips_unavailable`, `recording_too_large`, `legal_hold`, …).

**Live docs relay (experimental, MS5).** A thin transport; a Yjs provider
sits on top:

```ts
const doc = poolse.realtime.doc(docId, docToken, { clientId: ydoc.clientID });
doc.onJoined(() => void doc.requestSync(Y.encodeStateVector(ydoc))); // every (re)join; null = no_peer
doc.onSyncRequest(({ fromPeer, stateVector }) =>
  doc.sendSyncReply(fromPeer, Y.encodeStateAsUpdate(ydoc, stateVector)),
);
doc.onSyncReply((u) => Y.applyUpdate(ydoc, u, provider));
doc.onUpdate((u) => Y.applyUpdate(ydoc, u, provider));
doc.onAwareness((u) => applyAwarenessUpdate(awareness, u, provider));
doc.onPresence((editors) => …); // [{ userId, externalId, peer, rights, clientId }]
doc.onClosed((reason) => …); // token_expired | revoked | slow_consumer
await doc.sendUpdate(update); // binary frames; DocPushError: read_only, too_large, rate_limited (retryAfterMs)…
await doc.refresh(newToken); // at ~80 % of the token's life; rejoins use it
doc.leave();
```

## Live meetings

The features of a running call are `poolse.live` (the server's
docs/MEETINGS.md). Reads are REST; changes arrive on the conversation
topic, and rooms and meeting starts on your user topic:

```ts
await poolse.live.stage.raiseHand(callId);
await poolse.live.stage.setRole(callId, userId, 'speaker'); // moderator: bring up
await poolse.live.questions.ask(callId, 'When do we ship?', { anonymous: true });
await poolse.live.breakouts.open(callId, { count: 3, durationMinutes: 10 });
await poolse.live.lobby.admit({ conversationId, callId }, guestId);
await poolse.live.moments.mark(callId);
await poolse.live.agenda.done(callId, itemId);
await poolse.live.captions.set(callId, true);
await poolse.live.meetings.rsvp(meetingId, 'accepted');
await poolse.live.phones.call(callId, '+37060012345', 'Ana (mobile)');

const off = poolse.live.subscribe(
  conversationId,
  callId,
  {
    onStage,
    onQuestion,
    onBreakouts,
    onLobby,
    onMoment,
    onAgenda,
    onQuality,
    onAttendees,
    onCaptions,
  },
  { selfUserId: me.id },
);
const offUser = poolse.live.subscribeUser(me.id, { onRoomParticipants, onMeetingStarting });
```

Who is who: a member is in a call as their user id, a browser guest as
`guest_<id>`, a phone as `sip_…`. Show `meetingNameOf(identity, name)` —
the guest's typed name, "Phone ···1234" — never the id.

Breakout rooms are parts of the main call: on your `myRoomId`, connect to
`breakouts.join(roomId)`'s session, then leave the main room's media
(don't hang up); on close, `breakouts.returnToMain(callId)`.

The lobby is the conversation's: guests can wait before the call starts.
The browser call page uses `GuestClient` (no account): `link(token)`,
`join(token, name)`, `waitInLobby()` (admitted once a member let them in
and a call is live), `session()`, `hand`, `react`, `ask`, `vote`, `leave`.

In-call chat: send with `call_id` (`MessageCreateRequest.call_id`); read
it back with `live.messages(callId)`.

Peer to peer over the call's data channel, never stored:
`new CallReactions(room)` and `new ScreenAnnotations(room, sharerUserId)`
(pointer and pen, 0–1 coordinates). `room.sendData` / `room.onData` for
your own. `live.react(callId, emoji)` relays through the server instead.

Call quality: each `CallParticipant` has `connectionQuality`;
`new CallQualityMonitor(room, { report: (b) => poolse.live.quality.report(callId, b) })`
words your own link ("Your network is dropping packets") and tells the
server, which tells the others (`call:quality`).

Background and noise (web): pass `trackProcessors` (`@livekit/track-processors`,
an optional peer) to `poolse.call(…)`, then `room.setBackground({ type: 'blur' })`;
`room.setNoiseSuppression(false)`.

Move the call to this device: `inCallElsewhere(live, me.id, connectedHere)`
says when to offer it; `poolse.live.moveHere(callId)` joins here and the
other device sees `onDisconnected('moved')` (web) or `reason: 'moved'`
(`@poolse/native`).

Whiteboard: `openWhiteboard(poolse, Y, await poolse.live.whiteboard(callId))`
gives a `WhiteboardModel` on a Y.Doc synced over the doc relay (Yjs passed in).

Meeting cards: `meetingCardOf(message)` reads the `meeting_card` body;
the body has no `my_rsvp` — `rsvpOf(card, me.id)` finds yours.

## Agents in calls

Agents join calls as visible participants (the server's
docs/AGENTS_IN_CALLS.md). An agent's LiveKit identity is its poolse user
id; its token metadata says `agent: true`, its `mode` and `label`:

```ts
await poolse.callAgents.invite(callId, agentId, 'notetaker'); // or 'assistant'
await poolse.callAgents.setMode(callId, agentId, 'assistant');
await poolse.callAgents.remove(callId, agentId);
const off = poolse.callAgents.subscribe(conversationId, callId, { onAgents, onSaid });

// A tile / roster row: the Agent badge, its label, "Taking notes".
const agent = callAgentOfParticipant(participant, agents); // null for a person
if (agent) render(agent.label, callAgentStateLabel(callAgentStateOf(agent)));
```

`CallRoom.getParticipants()` lists agents (last, with `metadata`); they
never keep a call alive. Guests see them too (`meeting.agents` of their
session). Inviting an agent starts the call's transcript (the usual
notice and consent gate).

Whisper (only you see it): `poolse.callAgents.whisper.set(callId, true)`,
`.get(callId)` for the history, `.subscribe(me.id, callId, { onHint,
onChanged })`.

Attending for you: write a brief with `poolse.callAgents.briefs.create({
scheduledMeetingId | callId, text, rules })`. Its questions are
`poolse.escalations` (`list`, `reply(id, { decision: 'approve' })` or
`{ answer: 'Only 5%' }`, `subscribe`). From a push without a session:

```ts
const actions = createNotificationActions({ apiUrl });
await actions.escalation({
  escalationId: data.escalation_id,
  token: data.reply_token,
  decision: 'approve',
});
```

`@poolse/native` does this itself from the lock screen.

## Several workspaces, offline, speed

Each signed-in workspace is its own `Poolse` instance. Nothing is shared at
module level: every client has its own socket, caches, outbox, presence and
storage namespace (`client.namespace` = `poolse:v1:<apiUrl>#<user>`).

```ts
const acme = new Poolse({
  apiUrl: 'https://chat.acme.example',
  getToken: acmeToken,
  storage: createIndexedDbStorage(),
  storageNamespace: 'ana@acme',
});
const beta = new Poolse({ apiUrl: 'https://chat.beta.example', getToken: betaToken });

acme.unread.subscribe(({ unread, mentions }) => setBadge('acme', unread, mentions));
beta.setBackground(true); // phone: not on screen → socket closed
onPush((p) => clientFor(p.tenant_id)?.wake()); // connect for 30 s
await acme.destroy({ clearStorage: true }); // sign out of one only
```

- **`setBackground(bool)` / `isBackground()` / `wake({ forMs })`** — close the
  socket (channel handles and listeners stay) and reopen it with a fresh
  token; hooks catch up from REST. `realtime.pause()` now also works before
  the first connect.
- **`destroy({ clearStorage })`** — returns a promise; closes the socket at
  once, drops timers, caches, outbox and `scoped` services; the instance is
  inert afterwards. `clearStorage` also deletes its keys in `storage` and its
  drafts. `onDestroy(fn)`, `destroyed`.
- **`scoped(key, create)`** — one service per client, destroyed with it (how
  the UI packages keep stores per client).
- **`unread`** — `get()`, `subscribe(fn)`, `refresh()`, `summary()`:
  `{ unread, mentions, conversations, source, loading, error }` from
  `GET /v1/me/unread`, live from `unread:totals` (the user channel joins with
  `unread_totals: true` while subscribed), `conversation:read` (`totals`) and
  per-conversation deltas; on a server without the endpoint (404), the sum of
  the conversations seen (`source: 'local'`).
- **`outbox`** — sends that can't reach the server are queued under their
  client message id and resent on reconnect, `online`, or a backoff timer (2 s
  → 60 s, none in the background); the server stores a repeated id once. A 4xx
  (409 `message_id_conflict` included) leaves the message `failed` until
  `retry(id)` / `remove(id)`. `entries()`, `subscribe`, `onSent`, `whenSent`,
  `flush`. `send` rejects with `MessageQueuedError` when queued.
  `Message.local_status` (`sending` · `queued` · `failed`) and `local_error`
  mark such rows.
- **`cache`** — warm `LocalCache` of the conversation list and the newest
  messages per conversation, in memory and in `storage`.
- **`PoolseStorage`** — `{ get, set, remove }`, sync or async, string values.
  `createIndexedDbStorage()` (browser / desktop webview; memory fallback) and
  `memoryStorage()` ship here; on React Native wrap MMKV
  (`{ get: k => mmkv.getString(k) ?? null, set: (k, v) => mmkv.set(k, v), remove: k => mmkv.delete(k) }`),
  AsyncStorage or SQLite the same way.
- **`timings`** — `get()`, `peek(name)`, `on(fn)`, `start(name)` → `done()`,
  `record(name, ms)`. Built in: `connect`, `reconnect`, `me`,
  `firstConversations`, `firstMessages`, `cachedConversations`,
  `cachedMessages` (ms since the client was created; `reconnect` since the
  resume).

## Presence

`poolse.presence.subscribe(['ana', 'ben'], (p) => …)` keeps users' presence
(`online`, `away`, `in_call`, `offline`, plus `last_seen_at`, `dnd_until`,
`do_not_disturb`) live: lookups from every caller in the same tick go out as
one request (200 ids at a time), over the socket while the user channel is
joined, and `presence:changed` updates the cache (`peek(id)`). Report the
device's own state with `setActivity('active' | 'idle')` — `trackActivity()`
does it in a browser (hidden, blurred or 5 minutes without input → idle).

## Message actions

`messages.get(id)` returns one message, or its tombstone (`deleted_at` set,
`body: null`) once deleted; `messages.edits(id)` its earlier versions;
`include_deleted: true` on `list` / `replies` adds tombstones. Messages carry
`link_previews` (filled in after the send and announced by `message:updated`;
remove with `messages.update(id, { remove_link_previews: [url] | true })`)
and a thread summary (`reply_count`, `last_reply_at`, `thread_participants`,
updated by `thread:updated`). `mergeMessage`, `toTombstone`,
`applyThreadUpdate` and `markQuoteDeleted` apply those events to a local list.

`poolse.onAppEvent(fn)` listens for app events without holding the user
channel yourself; it joins it once the user is known. A `member:updated`
event drops that member's cached profile (`data.external_id`, or every
profile when it names nobody) so names and pictures re-render; call
`poolse.users.invalidate(externalId)` yourself after a profile change your
app makes some other way.

## Notification settings

`me.update({ notifications: { paused_until, groups, quiet_hours } })` sets the
user's own defaults (send only what changes; `null` clears). Per conversation,
`conversations.one(id).membership.update({ notify, muted_until })` takes
`notify` `all` / `mentions` / `none` (or `null` to follow the default) and an
ISO `muted_until` (or `null`). Conversation rows carry the same `notify`,
`muted_until` and `mention_unread_count` for the caller.

Events sent while the socket is down aren't replayed; reload from REST when
`onStatus` reports `connected` again. `realtime.pause()` / `resume()` close
and reopen the socket while keeping every channel and listener, for an app
going to the background. `disconnect()` destroys them.

A channel the server closes (you were removed from the conversation) fires
`onClosed` and is dropped, so a later `realtime.conversation(id)` joins
afresh. After a refused socket handshake (for example a revoked token) the
SDK fetches a new token from `getToken`, at most every 30 seconds.

## Errors

```ts
import { PoolseError, ApiError, AuthError, RateLimitedError, NetworkError } from '@poolse/sdk';
```

`ApiError` (any non-2xx) carries `status`, `code`, `docUrl` and `details`.
`code` is typed `ApiErrorCode` (`quoted_message_deleted`, `message_deleted`,
`device_signed_out`, …, or any other string). `AuthError` is a 401 after one refresh, `RateLimitedError` a 429 after
retries (with `retryAfterMs`), `NetworkError` a failed `fetch` (with
`cause`). Aborted requests reject with the `AbortError` `DOMException`.

Also exported: the call-log helpers (`parseCallLog`, `describeCallLog`,
`formatCallLogPreview`, …), `safeUuid`, `version`, `POOLSE_API_URL` and every
wire type (`Conversation`, `Message`, `Membership`, `Attachment`, `Me`, …).

## Links

- Docs: <https://poolse.dev/docs/sdk/sdk>
- Migrating to 3.0: <https://poolse.dev/docs/guides/migrating-to-3>
- Source: <https://github.com/poolse-hq/js-sdk>
- Issues: <https://github.com/poolse-hq/js-sdk/issues>

## Messaging plus

Scheduled send, polls, pins, forward, thread follow, catch-up, translation,
interactive blocks, files and voice/video messages (the server's
docs/MESSAGING_PLUS.md and PLATFORM_PLUS.md):

```ts
const conv = chat.conversations.one(id).messages;
await conv.schedule({ body: 'Morning!', send_at: '2026-11-23T08:00:00Z' });
await chat.scheduledMessages.list(); // .update / .cancel / .sendNow

const poll = await conv.send({
  type: 'poll',
  body: 'Lunch?',
  poll: { options: ['Pizza', 'Sushi'] },
});
await chat.messages.one(poll.id).vote(['1']);

await chat.messages.one(msgId).pin();
await chat.messages.one(msgId).forward({ conversation_ids: [otherId], comment: 'fyi' });
await chat.messages.one(rootId).setFollow(false);
const { summary, highlights } = await conv.catchUp(); // "what did I miss"
const { text } = await chat.messages.one(msgId).translate('de');
await chat.messages.one(blockMsgId).action({ action_id: 'approve' });

const { data, next_cursor } = await conv.files({ kind: 'document' });
const voice = await chat.attachments.upload({
  body: blob,
  contentType: blob.type,
  byteSize: blob.size,
  purpose: 'voice',
  durationMs,
});
```

A send refused by data-loss prevention throws `ApiError` `dlp_warning`
(send again with `dlp_acknowledged: true`) or `dlp_blocked`
(`details.rules: [{id, name}]`).

## License

Licensed under the [poolse SDK License](./LICENSE) from 3.0.0; versions
before 3.0.0 remain MIT.
