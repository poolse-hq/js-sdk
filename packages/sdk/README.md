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

## What's in it

| Member                                        | Covers                                                                                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `poolse.me`                                   | `show`, `update({ read_receipts })`, `peek`, `onChange`                                                                                             |
| `poolse.conversations`                        | `list`, `create`, `one(id)` → `show`, `update`, `listMembers`, `addMembers`, `addMember`, `removeMember(userId)`, `messages.list / send / markRead` |
| `poolse.messages`                             | `one(id)` → `update`, `delete`, `replies`, `addReaction`, `removeReaction`                                                                          |
| `poolse.attachments`                          | `upload`, `requestUpload`, `one(id)` → `downloadUrl`, `delete`                                                                                      |
| `poolse.users`                                | Cache over `userResolver`: `get`, `peek`, `subscribe`, `invalidate`, `invalidateAll`                                                                |
| `poolse.devices`                              | `register`, `unregister` (push tokens)                                                                                                              |
| `poolse.liveCalls`                            | `get(conversationId)`                                                                                                                               |
| `poolse.rooms`                                | `start`, `ring`, `leave`                                                                                                                            |
| `poolse.callTokens`                           | `create(conversationId)`                                                                                                                            |
| `poolse.call(conversationId, { livekit, … })` | `CallRoom`: call media on the web (pass your `livekit-client` import)                                                                               |
| `poolse.realtime`                             | `conversation(id)`, `user(id)`, `leave`, `getStatus`, `onStatus`, `connect`, `pause`, `resume`, `disconnect`                                        |
| `poolse.rest.request({ method, path, … })`    | Any endpoint, with the same auth, retries and idempotency                                                                                           |

Conversation channels emit `onMessage`, `onMessageUpdated`,
`onMessageDeleted`, `onTypingStart`, `onTypingStop`, `onReactionAdded`,
`onReactionRemoved`, `onMemberRead`, `onCallStarted`, `onCallParticipants`,
`onCallFinished`, `onPresenceState` and `onPresenceDiff`, and have
`sendTyping()` and `getPresenceState()`. The user channel emits `onMention`,
`onConversationCreated` and `onConversationUpdated`.

Events sent while the socket is down aren't replayed; reload from REST when
`onStatus` reports `connected` again. `realtime.pause()` / `resume()` (3.1)
close and reopen the socket while keeping every channel and listener, for an
app going to the background. `disconnect()` destroys them.

## Errors

```ts
import { PoolseError, ApiError, AuthError, RateLimitedError, NetworkError } from '@poolse/sdk';
```

`ApiError` (any non-2xx) carries `status`, `code`, `docUrl` and `details`.
`AuthError` is a 401 after one refresh, `RateLimitedError` a 429 after
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
