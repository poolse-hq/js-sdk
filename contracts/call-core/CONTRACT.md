# Poolse Call Contract — cv 1 (Stage 0)

The single source of truth for calling across poolse-server, the native call
cores (`dev.poolse:call-core`, `PoolseCallCore`), the React Native bridge, and
the web JS machine. Every implementation is built against this document and
must pass `vectors.json`. Changing this file is a reviewed event; payloads
carry the contract version so implementations refuse rather than misread.

Status: **draft for joint review** (Stage 0 exit = sign-off).

---

## 1 · The model

- A **call** is a server-side resource on a conversation: it goes `live` when
  placed and `finished` when its room empties. Its participant set is counted
  from **LiveKit webhooks**, never from Phoenix channel presence.
- A **ring** is one member's personal invitation to a live call. Each
  conversation member (except the caller) gets one ring per call, fanned out
  to all their registered devices. Rings resolve to exactly one of:
  `answered | declined | busy | missed | cancelled`.
- **Declining resolves your ring. It never affects the call.** While a call is
  `live`, every conversation member — decliner, misser, newcomer — may join.
- The call **finishes** when the room has been empty, or has held exactly one
  participant with no ring still `ringing`, continuously for the grace period
  (`FINISH_GRACE_MS = 30_000`).
- `media` (`audio | video`) is capability negotiation. It never affects
  lifecycle.

## 2 · Identifiers & versioning

- `call_id`: server-minted UUID, one per call (not per ring, not per device).
- Every REST response body, push payload, and socket event carries `cv: 1`
  (string `"1"` in push payloads, where all values are strings).
- A core receiving `cv` with a different major refuses the payload and
  surfaces `contract_mismatch` to the host app. A payload with **no** `cv` is
  legacy (§10).

## 3 · Tokens — the three doors

Clients treat all three tokens as **opaque strings** presented in
`Authorization: Bearer <token>`. Claims below bind the server implementation.

### 3.1 Ring grant — answering with zero stored credentials

Carried in every ring push. Single-use, device-bound, ring-scoped.

| claim                        | value                                                |
| ---------------------------- | ---------------------------------------------------- |
| `scope`                      | `"call:respond"`                                     |
| `sub`                        | callee poolse user id                                |
| `call_id`, `conversation_id` | the call                                             |
| `device_id`                  | the device registration this push targeted           |
| `jti`                        | single-use id; spending it twice fails `grant_spent` |
| `exp`                        | `ring_deadline + 30s`                                |

Valid on `answer` and `decline` only. Replay from another device fails on
`device_id`; replay after the ring fails on `exp`.

### 3.2 Session — placing and late-joining

The normal poolse user session (apps are open for both actions). Valid on
`place`, `join`, `decline`, and the read endpoints.

### 3.3 Call-control — living inside the call

Returned in every CallSessionBundle. Scoped `call:control` to
(`call_id`, `sub`); honored only while the call is `live` (registry check —
`exp` is a 24 h backstop, not the authority). Valid on `hangup`, `reconnect`,
`ring`, `stats`.

## 4 · REST API

Base `{apiUrl}/v1`. All POSTs are idempotent: repeating a spent/duplicate
request returns the same result or the documented error, never a second side
effect.

| endpoint                                                       | auth             | success                                                                                                                                                                        | errors                                                                                  |
| -------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `POST /conversations/:id/calls` body `{media}`                 | session          | `201 CallSessionBundle` (`created: true`) — or `200` with the **existing** live call's bundle (`created: false`): simultaneous placement collapses into a join (scenario 16)   | `403 not_member`                                                                        |
| `GET /conversations/:id/call`                                  | session          | `200 CallSummary`                                                                                                                                                              | `404 no_live_call`                                                                      |
| `POST /calls/:id/answer`                                       | grant            | `200 CallSessionBundle`                                                                                                                                                        | `410 call_finished` · `401 grant_expired` / `grant_spent` · `403 grant_device_mismatch` |
| `POST /calls/:id/join`                                         | session          | `200 CallSessionBundle`                                                                                                                                                        | `410 call_finished` · `403 not_member`                                                  |
| `POST /calls/:id/decline` body `{reason?: "declined"\|"busy"}` | grant or session | `204` (also `204` after the call finished — a late decline is harmless)                                                                                                        | `401` invalid grant                                                                     |
| `POST /calls/:id/hangup`                                       | control          | `204` ("I left" — ends the call only per the §1 finish rule)                                                                                                                   | `204` even if already finished                                                          |
| `POST /calls/:id/ring` body `{user_ids?, external_ids?}`       | control          | `200 {cv, rung_user_ids}` — rings more of the conversation's members into a call under way ("Add people"), each on their own 45 s window; an earlier decline is lifted. Skips anyone in the call, still ringing, or not a member | `409 call_not_answered` (nobody has picked up yet) · `410 call_finished`              |
| `POST /calls/:id/reconnect`                                    | control          | `200 CallSessionBundle` (full bundle, same shape as answer/join — one parser; cores still accept the older `{cv, livekit: {url, token}}` and apply it onto the current bundle) | `410 call_finished` · `401` control token invalid                                       |

Error bodies use the envelope `{"error": {"code": "grant_spent", …}}`.
Clients map: `404`/`410` → gone (`ended(finished)`); `401`/`403`/`503`, other
`4xx`, or an unparseable `2xx` → `HTTP_FAILED` (`ended(failed)`, never
`finished`); `408`/`429`/other `5xx`/network → timeout (retried).

### 4.1 `CallSessionBundle`

```jsonc
{
  "cv": 1,
  "created": true, // place only
  "call": {
    /* CallSummary */
  },
  "livekit": { "url": "wss://…", "token": "…" },
  "control_token": "…",
}
```

### 4.2 `CallSummary`

```jsonc
{
  "id": "uuid",
  "conversation_id": "uuid",
  "conversation_name": "Fix the boiler", // null for unnamed
  "media": "audio",
  "state": "live", // live | finished
  "started_by": { "user_id": "uuid", "external_id": "acc_1", "display_name": "Elena" },
  "started_at": "2026-10-15T09:00:00Z",
  "ended_at": null,
  "participants": [
    // LiveKit-counted, media-level
    { "user_id": "uuid", "external_id": "acc_1" },
  ],
  "ring_states": {
    // per CALLEE user (caller absent)
    "<user_id>": "ringing", // ringing|answered|declined|missed — `ringing` only while their ring is out
  },
}
```

## 5 · Push payloads

Data-only pushes (FCM data message / PushKit dictionary); every value a
string. Two shapes only.

### 5.1 Ring

```jsonc
{
  "cv": "1",
  "type": "call",
  "event": "ring",
  "call_id": "…",
  "conversation_id": "…",
  "conversation_name": "Fix the boiler", // "" when unnamed
  "media": "audio", // audio | video
  "caller_user_id": "…",
  "caller_external_id": "…",
  "caller_name": "Elena",
  "grant": "…",
  "ring_deadline": "1760518800000", // epoch ms; surface stops itself here
  "sent_at": "1760518755000",
}
```

A core that receives a ring for a call it is already showing (push + socket
race) deduplicates on `call_id`. A ring whose `ring_deadline` has passed, or
arriving while the registry says `finished` (answer returns `410`), is never
surfaced — or is dismissed instantly if it already was.

### 5.2 Ring teardown

```jsonc
{
  "cv": "1",
  "type": "call_event",
  "event": "ring_ended", // type=call_event: old JS builds ring on any type=call
  "call_id": "…",
  "conversation_id": "…",
  "reason": "cancelled", // cancelled | answered_elsewhere | declined | timeout | finished
  "device_id": "…", // optional: the device that answered/declined
  "sent_at": "…",
}
```

Sent to **every device whose surface might be ringing** when its ring
resolves for any reason, including the call finishing mid-ring. It only ever
ends a `ringing_in`: an `answered_elsewhere` echo of this device's own answer
never ends a call it already answered. Cores accept `type` `call` or
`call_event` and dispatch on `event`; a `type: "call"` push with no `event` is
a ring (backward compatibility).

### 5.3 Call finished (Android native core)

```jsonc
{
  "cv": "1",
  "type": "call_event",
  "event": "finished",
  "call_id": "…",
  "conversation_id": "…",
  "reason": "finished", // finished | declined_all | busy_all (every callee on another call) | no_answer | cancelled
}
```

Sent to the Android devices of every user who joined or was rung when the
call finishes → `CALL_FINISHED(reason)`. For a caller still in `ringing_out`
the reason becomes the ended reason; a core receiving `ring_ended` or
`finished` ALWAYS tears down any ring surface for that `call_id` (even with no
matching machine state, e.g. after a process restart).

### 5.4 Missed call

To everyone whose phone rang out (rung, never joined, did not decline;
busy counts as missed), once the call finishes:

```jsonc
// Android — FCM data, the native core posts the notification itself
{
  "cv": "1", "type": "call_event", "event": "missed",
  "call_id": "…", "conversation_id": "…", "conversation_name": "…",
  "caller_user_id": "…", "caller_name": "…", "media": "audio",
  "title": "Jasir", "body": "Missed voice call",   // finished text
  "sent_at": 1760000000000
}
// iOS — an ALERT push to the token registered with kind "alert"
// (never the VoIP token: PushKit may only carry a ring)
{
  "aps": { "alert": { "title": "Jasir", "body": "Missed voice call" },
           "sound": "default", "category": "poolse_missed_call",
           "thread-id": "<conversation_id>" },
  "type": "call_missed", "call_id": "…", "conversation_id": "…", "media": "audio", …
}
```

Tap → open the conversation; the `call_back` action → place a call on it
with `media`. Android hands both to the app as launch extras, read through
the bridge (`takeCallAction` / `onCallAction`).

### 5.5 Chat messages

poolse notifies every member but the sender of a new **text** message
(muted members only when mentioned), on their `alert` devices (Android: all;
iOS: the regular APNs token), with the tenant's call push credentials.

```jsonc
// Android — FCM data; the native core posts it (MessagingStyle, one per conversation)
{
  "cv": "1", "type": "message", "event": "new",
  "message_id": "…", "conversation_id": "…", "conversation_name": "Fix the boiler",
  "group": "1", "sender_user_id": "…", "sender_external_id": "…", "sender_name": "Ana",
  "text": "on my way", "mentioned": "0", "sent_at": 1760000000000,
  "unread_total": 3, "reply_grant": "<jwt>"
}
// iOS — alert push, the same keys beside aps
{ "aps": { "alert": { "title": "Fix the boiler", "body": "Ana: on my way" },
           "thread-id": "<conversation_id>", "category": "poolse_message",
           "badge": 3, "sound": "default", "mutable-content": 1, "summary-arg": "Ana" }, … }
```

The tenant's dashboard settings shape it server-side: chat off sends
nothing; `preview: "sender"` replaces `text` with "New message";
`preview: "hidden"` also blanks `sender_name` and `conversation_name` and
adds `"private": "1"` (Android shows the app name and a count; iOS gets no
title); `groups: "mentions"` notifies a group's mentioned members only.

Read sync — when a member's read cursor passes unread messages, their
devices get `{"type": "message", "event": "read", "conversation_id", "unread_total"}`
(Android data; iOS background push with `"type": "message_read"`) and drop
that conversation's notifications.

The **reply grant** (`aud: "message-reply"`, one user + device + conversation,
3 days) authorizes, as `Authorization: Bearer <grant>`:

| endpoint                       | body          |                                                                          |
| ------------------------------ | ------------- | ------------------------------------------------------------------------ |
| `POST /v1/notifications/reply` | `{body, id?}` | posts as the user, then marks read; same `id` again → the original (200) |
| `POST /v1/notifications/read`  | —             | marks the conversation read to its newest message                        |

Hosts tell the core which conversation is on screen
(`setActiveConversation`): Android skips its notifications natively, iOS
apps ask `shouldPresentMessage(data)` in their notification handler.

### 5.6 Rooms (calls that ring nobody)

`POST /v1/conversations/:id/room {media}` starts the conversation's room —
201 with the §4.1 bundle — or joins what is live there (200): another room,
or a ringing call. A room is the web's Meet-style model: anyone in the
conversation drops in while the chat carries on.

- Summary `kind: "room"` (calls: `"call"`). No pushes, no ring states.
- Live and joinable from the start; leaving (`hangup`) never ends it for
  the others; it finishes once it has been **empty** for the grace — one
  person waiting alone keeps it.
- Presence comes from the LiveKit webhook only (REST start/join do not mark
  anyone present), so a starter who never connects cannot hold it open.
- Phones join it like any live call (`join`, from the Join banner).
- The call record carries `call_kind: "room"`; clients word it "Video room ·
  45:12 · 3 joined" — nobody missed a room.

## 6 · Socket events

For open apps; mirrors of server state, never lifecycle authority. The
conversation topic carries the first three; `ring_ended` rides the user topic.

| event               | payload                                                 | notes                                                                                        |
| ------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `call:started`      | `{cv, call: CallSummary}`                               | banners appear; callee UIs may ring from this when no push arrived yet (dedupe on `call_id`) |
| `call:participants` | `{cv, call_id, participants: [...]}`                    | debounced ≤ 4/s; banners and in-call rosters update                                          |
| `call:ring_ended`   | `{cv, call_id, reason}`                                 | same reasons as §5.2                                                                         |
| `call:finished`     | `{cv, call_id, ended_at, duration_ms, joined_user_ids}` | banners drop; call log finalizes                                                             |

### 6.1 Call log

On `finished`, the server writes ONE system message to the conversation:

```jsonc
{
  "kind": "call",
  "v": 2,
  "call_id": "…",
  "media": "audio",
  "caller_user_id": "…",
  "started_at": 1760000000000,
  "ended_at": 1760000192000,
  "end_reason": "finished", // as call:finished
  "duration_ms": 192000, // null when nobody answered
  "joined_user_ids": ["…"], // v1 readers
  "participants": [{ "user_id": "…", "status": "joined" }],
} // joined | declined | busy | missed
```

The caller is not in `participants`. Each client words it for its viewer
(the SDK's `describeCallLog`): the caller sees "Outgoing call · 4:12" or
why nobody answered; a participant sees "Incoming call", "Missed call",
"You declined". v1 history (no `v`) also had a per-user `call_missed`
marker message, shown only to its user; v2 writes none. The conversation's
`last_message_preview` holds the whole body, so inbox rows word it too.
While a call is live, `GET /conversations/:id/call` + the events above
drive a **Join** banner (`useLiveCall`).

## 7 · The client state machine

One machine, implemented three times (Kotlin, Swift, JS mirror), verified by
`vectors.json`. **Lifecycle authority is the server's**; the machine reacts.

### Phases

`idle · ringing_in · ringing_out · connecting · active · reconnecting ·
ended(reason)`

`ended` lingers `ENDED_LINGER_MS = 2500` then auto-resets to `idle`.
`ringing_out` means "I am in the room (media may already be connected) and at
least one ring is unresolved with nobody joined yet" — the caller's media
joins during the ring so the first word is never clipped.

### Inputs (events)

`PUSH_RING · SOCKET_RING · RING_ENDED(reason) · CALL_FINISHED(reason?) ·
USER_ANSWER_WAITING · USER_DECLINE_WAITING · WAITING_DEADLINE ·
USER_ANSWER · USER_DECLINE · USER_PLACE · USER_JOIN · USER_HANGUP ·
HTTP_OK(bundle) · HTTP_GONE · HTTP_TIMEOUT · HTTP_FAILED(code) ·
MEDIA_CONNECTED · MEDIA_FAILED · MEDIA_LOST · MEDIA_RECONNECTING ·
MEDIA_RECOVERED · REMOTE_JOINED · ALL_RINGS_RESOLVED(outcome) ·
RING_DEADLINE · RECONNECT_BUDGET_ELAPSED · CONNECT_TIMEOUT · LINGER_ELAPSED`

### Abstract effects (each core maps to its platform)

`SHOW_RING · DISMISS_RING · RINGTONE_START/STOP · RINGBACK_START/STOP ·
HTTP_ANSWER(grant) · HTTP_JOIN · HTTP_DECLINE(reason) · HTTP_HANGUP ·
HTTP_RECONNECT · MEDIA_JOIN(bundle) · MEDIA_LEAVE ·
CALL_SESSION_START/STOP (Android FGS / iOS CallKit session) ·
SHOW_WAITING · DISMISS_WAITING · PROMOTE_WAITING ·
EMIT(snapshot)`

Every transition implicitly emits a snapshot. The canonical transition table
IS `vectors.json`; prose highlights only the non-obvious rules:

- **Busy**: a ring for a _different_ call while `ringing_in` →
  `HTTP_DECLINE(busy)` for the new call, no phase change (vector S9).
- **Call waiting**: a ring for a different call while on one (`ringing_out`,
  `connecting`, `active`, `reconnecting`) does not busy it — it **waits**
  beside the current call (`state.waiting`, `SHOW_WAITING`), at most one:
  a third is busy. The waiting call ends by `USER_DECLINE_WAITING`
  (`HTTP_DECLINE(busy)` + `DISMISS_WAITING` — its caller hears busy), its
  own `RING_ENDED`/`CALL_FINISHED`, or `WAITING_DEADLINE` (missed), each
  leaving the current call untouched. `USER_ANSWER_WAITING` ("End &
  answer") leaves the current call (the `USER_HANGUP` effects) and answers
  the waiting one in one step: `PROMOTE_WAITING`, `HTTP_ANSWER(its grant)`,
  `CALL_SESSION_START`, never ringing. When the current call ends any
  other way, the waiting one is **promoted** to the ring: `PROMOTE_WAITING`
  then `SHOW_RING`/`RINGTONE_START`, `ringing_in` (no ended screen).
  `PROMOTE_WAITING` retires the old call: its grant, bundle and generation
  — a late answer/timer of the old call can never land on the new one.
- **Answer is optimistic**: `USER_ANSWER` → `connecting` + `HTTP_ANSWER`
  immediately; `HTTP_GONE` → `ended(finished)`; `HTTP_FAILED` → `ended(failed)`;
  HTTP timeout retries once, a second timeout → `ended(failed)` (with no bundle
  media can never join). A `CONNECT_TIMEOUT` watchdog (~20 s) bounds
  `connecting`. A late `HTTP_OK` after the phase moved on is ignored by the
  machine; the runtime hangs up a bundle that arrives after the user already
  hung up, and never carries a bundle into the next call.
- **Leaving ≠ ending**: `USER_HANGUP` always sends `HTTP_HANGUP` and goes to
  `ended(left)` locally. Whether others end is the server's call (§1); clients
  never count participants to decide.
- **Reconnect**: `MEDIA_RECONNECTING` (the SFU resuming on its own) in
  `active` → `reconnecting`, no effects — never tear down a room the SFU is
  recovering. `MEDIA_LOST` (unexpected disconnect) in `active` or
  `reconnecting` → `reconnecting` + `HTTP_RECONNECT` (rejoin with the fresh
  bundle); `MEDIA_RECOVERED` or `MEDIA_CONNECTED` → `active`; `HTTP_GONE` →
  `ended(left)`; `HTTP_FAILED` → `ended(failed)`; budget exhausted
  (`RECONNECT_BUDGET_MS = 25_000`) → `ended(connection_lost)`.
- **Caller media failure**: `MEDIA_FAILED` in `ringing_out` → `ended(failed)`
  with ringback stop, media leave and hangup.
- **Duplicates**: cores keep a small LRU (~32) of resolved call ids and drop
  rings for them; a ring is stale only once `ring_deadline + 10 s` (clock
  slack) has passed.

## 8 · Snapshot (bridge type)

```ts
type Snapshot = {
  cv: 1;
  callId: string;
  conversationId: string;
  conversationName: string | null;
  kind: 'call' | 'room';      // from the bundle's call.kind; 'call' until the server answers
  waiting: {                  // call waiting (§7); null when none
    callId: string; conversationId: string | null;
    conversationName: string | null; callerName: string | null;
    media: 'audio' | 'video';
  } | null;
  direction: 'incoming' | 'outgoing' | 'joined';
  media: 'audio' | 'video';
  phase: 'ringing_in' | 'ringing_out' | 'connecting' | 'active' | 'reconnecting' | 'ended';
  reason?:
    | 'left'
    | 'finished'
    | 'declined_all'
    | 'busy_all'
    | 'no_answer'
    | 'cancelled'
    | 'connection_lost'
    | 'failed';
  startedAt?: number;
  connectedAt?: number;
  participants: Array<{
    userId: string;
    externalId: string;
    speaking: boolean;
    muted: boolean;
    cameraOn: boolean;
    connectionQuality: 'good' | 'poor' | 'lost' | 'unknown'; // lost = dropped, coming back
  }>;
  connectionQuality: 'good' | 'poor' | 'lost' | 'unknown'; // our own link to the SFU
  videoPaused: boolean;       // incoming video off to keep the audio going (weak link)
  audioRoute: 'earpiece' | 'speaker' | 'bluetooth' | 'headset';
  audioOutputs: Array<{
    id: string;
    kind: 'earpiece' | 'speaker' | 'bluetooth' | 'headset';
    name: string;
  }>;
  audioOutputId: string | null;
  mutedSelf: boolean;
  cameraOn: boolean;
} | null; // null = idle
```

Snapshots, not deltas: a UI mounting at any moment (cold answer) renders
correctly from one read.

### Bridge API (`@poolse/react-native-calls`)

```ts
configure({ apiUrl });
onCallState(cb: (s: Snapshot) => void): Unsubscribe;
getCallState(): Snapshot;
place(conversationId, { media, sessionToken });
join(callId, { sessionToken });
answer(); decline(); hangUp();
setMuted(b); setSpeaker(b); setAudioOutput(id); setCamera(b); switchCamera();
onRingEnded(callId, reason); onCallFinished(callId);   // socket forwarding, idempotent with push
takeCallAction(); onCallAction(cb);                     // Android: missed-call notification taps (§5.4)
setActiveConversation(id | null); shouldPresentMessage(data); conversationOfNotification(data); // §5.5
canUseFullScreenIntent(); openFullScreenIntentSettings(); // Android
ringIntoCall({ userIds?, externalIds? }): Promise<string[]>; // POST /calls/:id/ring with the core's control token
setPictureInPictureEnabled(b); isInPictureInPicture(); onPictureInPicture(cb); // video PiP
```

A participant's `externalId` comes from the LiveKit token's metadata
(`{tenant_id, external_id}`), so a host maps the roster to its own users.

Weak link (both cores): our quality `poor`/`lost` for 6 s with remote
video → every remote camera publication is disabled (`videoPaused`,
remotes read `cameraOn: false`); `good` for 10 s → re-enabled.

Alone in a call (not a room) after someone else was in it: ask
`/reconnect` at 3 s — `410` ends it `finished`; a bundle whose
`ring_states` has anyone `ringing` re-asks every 5 s; otherwise ask once
more at +9 s and then leave (`hangup`, ended `finished`) whatever the answer.

Audio output rules, identical on both platforms. Without a choice: a
connected headset or Bluetooth device, else the speaker for `video` or
the earpiece for `audio`. `setAudioOutput(id)` (an `audioOutputs` id)
holds for the call until that device disconnects, or a NEW headset /
Bluetooth device connects, which takes over and clears the choice.
`setSpeaker(true)` = the speaker; `setSpeaker(false)` = the best private
route (Bluetooth → wired → earpiece). Ids: `speaker`, `earpiece`,
`wired`, then `bluetooth` (Android) or `port:<uid>` (iOS) — opaque to
the UI.

`participants` are REMOTE only (`userId` = LiveKit identity). `getCallState()`
and `onCallState` are safe before `configure` (idle / no-op). On end the
snapshot stays `phase: 'ended'` with its reason for `ENDED_LINGER_MS`, then
becomes `null`.

## 9 · Multi-device & policy rules

- Ring fan-out: one push per registered device of each callee.
- A user's `answer`/`decline` resolves their ring **for the user**: all their
  other devices receive `ring_ended: answered_elsewhere / declined_elsewhere`.
- One media presence per user: a `join` while already joined elsewhere
  supersedes — the server revokes the older LiveKit participant; that device's
  core sees `MEDIA_LOST` → `HTTP_RECONNECT` → `410-equivalent`
  (`superseded`) → `ended(left)`.
- Members added to the conversation mid-call see the banner (visibility =
  current membership) and may join; they are never retroactively rung.
- The server enforces one live call per conversation (§4, scenario 16).

## 10 · Migration & compatibility

- The legacy JS calling path is retired (SDK 3.0 scope): the socket-signalled
  calls (`call:invite/accept/decline/busy/hangup/cancel` in,
  `call:incoming/accepted/declined/busy/ended/cancelled` out), the
  peer-to-peer `voice:*` room and `GET /v1/ice-servers` are gone from the
  server, as are `useCalls`, `useVoiceRoom`, `CallScreen`, `useVoipCalls`
  and `CallProvider` from the SDKs (sdk 2.26, react 2.29, react-ui 2.25,
  react-native 2.29). Phones call through this contract only; the web joins
  rooms (§5.6).
- Ring pushes keep `caller_name` and `conversation_name` at top level (the
  cores show them), and `has_video` beside `media` — the iOS core falls back
  to it when `media` is absent. No legacy `type: "call_end"` teardown is
  sent any more; teardown is `call_event` only (§5).
- Server deploys are **manual** during this project: every stage's server
  change lands as a reviewed commit plus an explicit "ready to deploy" note.

## 11 · Scenario → vector map

The 18 scenarios from the plan are encoded in `vectors.json`; each vector
names its scenario (`s1`…`s18`). Adding a call bug fix without first adding or
amending a vector is a process violation (see plan §11, working rules).
