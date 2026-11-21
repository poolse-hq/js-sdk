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

## License

Licensed under the [poolse SDK License](./LICENSE) from 3.0.0; versions
before 3.0.0 remain MIT.
