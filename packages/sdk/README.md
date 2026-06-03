# `@poolse/sdk`

Headless TypeScript SDK for [poolse](https://poolse.dev) — REST + WebSocket client for the poolse chat backend. No UI, no framework dependency. Runs in any environment with `fetch` and `WebSocket` (browsers, Node ≥ 18, Deno, Bun, React Native).

If you're using React, you'll usually want [`@poolse/react`](https://www.npmjs.com/package/@poolse/react) (hooks) or [`@poolse/react-ui`](https://www.npmjs.com/package/@poolse/react-ui) (prebuilt chat surface). Both sit on top of this package; you can drop down to it whenever you outgrow them.

> **⚠️ Upgrading from 1.x?** See [MIGRATING.md](https://github.com/poolse-hq/js-sdk/blob/main/MIGRATING.md). 2.0 is a breaking change: identity APIs are now keyed by your `external_id` instead of poolse uuids — `userResolver`, `useUser`, member operations all flip.

## Install

```bash
npm install @poolse/sdk
```

The Phoenix Channels client (`phoenix@^1.8`) is bundled into the dist — you don't need to install it separately.

## Authentication model

poolse separates **API keys** (server-side, full tenant scope) from **End User JWTs** (client-side, short-lived, single-user). The SDK is designed for the JWT side: your backend exchanges its API key for an End User JWT (`POST /v1/users/:user_id/tokens`), and the SDK uses that JWT for every REST call and the WebSocket handshake.

```
┌────────────┐  API key  ┌─────────┐  user JWT  ┌─────────────┐
│ your       │ ────────▶ │ poolse  │ ─────────▶ │ your        │
│ backend    │           │ REST    │            │ frontend    │
│ (mints     │           │         │            │ (this SDK)  │
│  JWTs)     │ ◀──────── │         │ ◀───────── │             │
└────────────┘           └─────────┘            └─────────────┘
```

Never embed an API key in a client bundle. The SDK calls your `getToken` whenever it needs the JWT; cache + refresh happen inside the SDK.

## Quick start

```ts
import { Poolse } from '@poolse/sdk';

const chat = new Poolse({
  apiUrl: 'https://api.poolse.dev', // optional; this is the default
  getToken: async () => {
    const res = await fetch('/api/chat-token', { method: 'POST' });
    const { token } = await res.json();
    return token; // string, or null for an anonymous request
  },
});

// REST
const me = await chat.me.show();
const { data: conversations } = await chat.conversations.list();
const conv = chat.conversations.one('00000000-0000-0000-0000-000000000000');
const { data: messages } = await conv.messages.list({ limit: 50 });
await conv.messages.send({ body: 'Hello' });

// Realtime — socket opens lazily on the first conversation() / user() call.
const live = chat.realtime.conversation(conv.id);
const off = live.onMessage((msg) => console.log('new', msg));

// Clean up when you're done.
off();
chat.destroy(); // closes WebSocket, leaves every joined channel
```

## Configuration

`new Poolse(config)` — every field but `getToken` has a default.

| Field                    | Type                                                                                      | Default                           | Notes                                                                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getToken`               | `() => Promise<string \| null> \| string \| null`                                         | — _required_                      | Called when the SDK needs a JWT. Return `null` to make an unauthenticated request (rare — the server requires a JWT for most routes).                                                                              |
| `apiUrl`                 | `string`                                                                                  | `https://api.poolse.dev`          | Base URL **without** `/v1`. Strip the trailing slash if present (the SDK does this too).                                                                                                                           |
| `wsUrl`                  | `string`                                                                                  | `apiUrl` with `http(s)` → `ws(s)` | Override for split-host deployments where the WebSocket gateway is on a different origin.                                                                                                                          |
| `socketPath`             | `string`                                                                                  | `/socket`                         | Phoenix Channels mount point.                                                                                                                                                                                      |
| `fetch`                  | `typeof fetch`                                                                            | `globalThis.fetch`                | Inject a fetch implementation (tests, restricted environments). Must be bound to `globalThis` if you pass the global one explicitly.                                                                               |
| `maxRetries`             | `number`                                                                                  | `3`                               | Retry budget for transient failures, per request.                                                                                                                                                                  |
| `baseBackoffMs`          | `number`                                                                                  | `250`                             | Base of the exponential backoff.                                                                                                                                                                                   |
| `maxBackoffMs`           | `number`                                                                                  | `30000`                           | Hard ceiling on a single retry delay.                                                                                                                                                                              |
| `generateIdempotencyKey` | `() => string`                                                                            | `crypto.randomUUID()`             | Override the key generator. Defaults throws at construction time if no `crypto.randomUUID` is available.                                                                                                           |
| `onSocketError`          | `(err: Error) => void`                                                                    | —                                 | Fired on non-fatal socket errors (Phoenix handles reconnect internally; this is for surface-level banners).                                                                                                        |
| `userResolver`           | `(externalId: string) => Promise<PoolseUserProfile \| null> \| PoolseUserProfile \| null` | —                                 | Optional. Resolve the tenant's own user identifier (`external_id` — same string you pass when minting JWTs) to `{ displayName, avatarUrl }` from your app's user data. The UI packages pick this up automatically. |

## REST surface

All methods accept an optional `AbortSignal` (or `{ signal }`) and return parsed JSON. Errors throw typed exceptions — see [Errors](#errors) below.

### `chat.me`

```ts
chat.me.show(signal?): Promise<Me>;            // GET /v1/me
```

### `chat.conversations`

```ts
chat.conversations.list(signal?): Promise<{ data: Conversation[] }>;
chat.conversations.create(attrs, signal?): Promise<Conversation>;
chat.conversations.one(id): ConversationHandle;
```

`ConversationCreateRequest`:

```ts
{
  type: 'direct' | 'group';
  name?: string | null;
  avatar_url?: string | null;
  member_limit?: number | null;
  member_external_ids?: string[];
  custom_data?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}
```

`member_external_ids` is your tenant's own ids — poolse looks them up by tenant and lazily provisions any that don't exist yet. The returned `Conversation` carries `member_external_ids` (the array of external_ids for every member) and `last_message_preview` (server-denormalized first ~80 chars of the most recent message body, used to render inbox rows without a per-row decrypt round-trip).

`ConversationHandle` (returned by `chat.conversations.one(id)`):

```ts
handle.show(signal?): Promise<Conversation>;                    // GET /v1/conversations/:id
handle.update(attrs, signal?): Promise<Conversation>;           // PATCH /v1/conversations/:id

handle.listMembers(signal?): Promise<{ data: Membership[] }>;   // GET /v1/conversations/:id/members
handle.addMembers(externalIds, { role?, signal? }?): Promise<{ data: Membership[] }>;
handle.addMember(externalId, { role?, signal? }?): Promise<Membership>;
handle.removeMember(userId, signal?): Promise<void>;

handle.messages: ConversationMessages;
```

`handle.messages`:

```ts
handle.messages.list({ limit?, before? }?, signal?): Promise<{ data: Message[] }>;
handle.messages.send(attrs, signal?): Promise<Message>;
handle.messages.markRead(messageId, signal?): Promise<void>;    // POST /v1/conversations/:id/read
```

Messages are paginated **newest-first** by per-conversation `sequence`. To load older messages: `list({ limit: 50, before: oldestSequence })`.

`MessageCreateRequest`:

```ts
{
  id?: Uuid;                      // optional client-supplied id for retry-safe sends
  body?: string | null;           // optional ONLY when attachment_ids is non-empty
  type?: 'text' | 'system' | 'custom';
  reply_to_id?: Uuid;             // setting this promotes the message to a thread reply
  quoted_message_id?: Uuid;       // WhatsApp-style quote — stays in main feed
  mentions?: Uuid[];              // user_ids to notify
  attachment_ids?: Uuid[];        // attach pre-uploaded files; max 10
}
```

If you omit `id`, `send` auto-generates one via `crypto.randomUUID()` so retries are idempotent and the realtime echo can be deduped against your optimistic insert.

### `chat.messages`

The message handle is keyed by message id (not conversation), because some operations need the message id but not the conversation id.

```ts
chat.messages.one(id): MessageHandle;
```

`MessageHandle`:

```ts
handle.update({ body }, signal?): Promise<Message>;                              // PATCH /v1/messages/:id
handle.delete(signal?): Promise<void>;                                            // DELETE /v1/messages/:id (soft-delete)
handle.replies({ limit?, after? }?, signal?): Promise<{ data: Message[] }>;       // GET /v1/messages/:id/replies
handle.addReaction(emoji, signal?): Promise<Message>;                             // POST /v1/messages/:id/reactions
handle.removeReaction(emoji, signal?): Promise<Message>;                          // DELETE /v1/messages/:id/reactions/:emoji
```

Thread replies are paginated **oldest-first** with an `after` cursor (opposite of the main feed). The default `limit` for replies is 500 — most threads load in one request.

### `chat.attachments`

Two-step upload: presign → PUT. The SDK has a one-call helper too.

```ts
chat.attachments.requestUpload(attrs, opts?): Promise<AttachmentUploadResponse>;  // POST /v1/attachments/upload-url
chat.attachments.upload(input, opts?): Promise<Attachment>;                       // presign + PUT, returns the row
chat.attachments.one(id): AttachmentHandle;
```

`AttachmentUploadInput`:

```ts
{
  body: BodyInit;            // Blob, File, ArrayBufferView, string, etc.
  contentType: string;       // matches what you'll PUT
  byteSize: number;          // matches Content-Length of `body`
  filename?: string;         // shown in the download UI
}
```

`AttachmentOptions`:

```ts
{
  signal?: AbortSignal;
  onProgress?: (event: { loaded: number; total: number }) => void;
}
```

`onProgress` switches the PUT to `XMLHttpRequest` (the only browser API that exposes upload progress). When you don't pass `onProgress`, the SDK uses `fetch` and you get no progress events. `XMLHttpRequest` is browser-only, so progress in Node will silently no-op.

To attach to a message, take the returned `attachment.id` and pass it as part of `attachment_ids` on the next `send`. The server links + flips status to `ready` in the same transaction.

`AttachmentHandle`:

```ts
handle.downloadUrl(opts?): Promise<{ url: string; method: 'get' }>;  // ~1h TTL
handle.delete(opts?): Promise<void>;
```

### `chat.users`

A small read-through cache for the **customer-supplied** profile (display name + avatar). The SDK doesn't store these — it asks your `config.userResolver` when it doesn't have them.

```ts
chat.users.peek(userId): PoolseUserProfile | null | undefined;
//   undefined → not yet fetched (or no resolver)
//   null      → resolver ran, returned null
//   profile   → cached hit

chat.users.get(userId): Promise<PoolseUserProfile | null>;
chat.users.subscribe(userId, listener): () => void;   // fires when an entry changes
chat.users.invalidate(userId): void;
chat.users.invalidateAll(): void;                     // sign-out, tenant swap
```

Concurrent `get(userId)` calls for the same id share one in-flight resolver promise — a busy chat with 50 messages from 5 senders calls your resolver 5 times.

### `chat.rest`

Escape hatch for endpoints not yet covered by the typed resources (e.g., admin routes). Same retry + auth + idempotency behavior as the typed methods.

```ts
const result = await chat.rest.request<MyShape>({
  method: 'POST',
  path: '/v1/something',
  body: { foo: 'bar' },
  query: { limit: 10 },
  idempotencyKey: 'my-custom-key', // or null to omit; defaults to a fresh UUID for non-GETs
  signal,
});
```

## Realtime

The WebSocket is **lazily opened** on the first `conversation()` or `user()` call — until then the realtime layer is dormant and won't try to authenticate.

```ts
chat.realtime.connect(): void;          // idempotent; usually you don't call this directly
chat.realtime.disconnect(): void;
chat.realtime.getStatus(): RealtimeStatus;
chat.realtime.onStatus(fn): Unsubscribe;
chat.realtime.conversation(id): ConversationChannel;
chat.realtime.user(id): UserChannel;
chat.realtime.leave(id): void;          // drop a conversation handle
```

`RealtimeStatus`: `'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed'`.

Reconnect with backoff is handled by the underlying Phoenix Socket. On reconnect the JWT is re-read via `getToken`, so a refreshed token lands on the next handshake without manual intervention.

### `ConversationChannel`

Returned by `chat.realtime.conversation(id)`. Reusing the same id returns the same handle (no second channel join).

```ts
channel.onMessage(fn): Unsubscribe;                    // message:new
channel.onMessageUpdated(fn): Unsubscribe;             // message:updated
channel.onMessageDeleted(fn): Unsubscribe;             // message:deleted
channel.onReactionAdded(fn): Unsubscribe;              // reaction:added
channel.onReactionRemoved(fn): Unsubscribe;            // reaction:removed
channel.onMemberRead(fn): Unsubscribe;                 // member:read (read receipts)
channel.onTypingStart(fn): Unsubscribe;
channel.onTypingStop(fn): Unsubscribe;
channel.onPresenceState(fn): Unsubscribe;              // initial snapshot (replayed to late subscribers)
channel.onPresenceDiff(fn): Unsubscribe;               // joins/leaves deltas
channel.getPresenceState(): PresenceSnapshot;          // synchronous read

channel.sendTyping(): void;                            // server is rate-limited; safe to spam
```

The server filters `typing` to peers — you won't receive your own typing event back.

Payload shapes are exact:

| Event                                 | Payload                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| `message:new` / `message:updated`     | `Message` (full row, with `attachments` preloaded and `quoted_message` set when applicable) |
| `message:deleted`                     | `{ id: Uuid; conversation_id: Uuid; deleted_at: string \| null }`                           |
| `reaction:added` / `reaction:removed` | `{ message_id, conversation_id, emoji, user_id }`                                           |
| `member:read`                         | `{ user_id, conversation_id, last_read_message_id, last_read_at }`                          |
| `typing:start` / `typing:stop`        | `{ user_id }`                                                                               |
| `presence_state`                      | `Record<user_id, { metas: Array<{ phx_ref, online_at, external_id? }> }>`                   |
| `presence_diff`                       | Same shape, partitioned into `{ joins, leaves }`                                            |

### `UserChannel`

Returned by `chat.realtime.user(id)`. Only the user matching the JWT can join their own channel — the server rejects other ids.

```ts
channel.onMention(fn): Unsubscribe;
channel.onConversationCreated(fn): Unsubscribe;
channel.onConversationUpdated(fn): Unsubscribe;
```

`onMention` corresponds to the `mention:new` push and carries `{ message_id, conversation_id, sender_id }` — fetch the full message via REST if you need the body.

`onConversationCreated` corresponds to the `conversation:created` push, which fires whenever the user is added to a conversation (including ones they created themselves) and carries the full `Conversation` row with `member_external_ids` preloaded.

`onConversationUpdated` corresponds to the `conversation:updated` push and fires after every message sent in any of the user's conversations. Payload shape is `{ conversation: Conversation, by_user_id: Uuid | null }` — `by_user_id` is the sender's id, so a client can avoid bumping its own unread when the server already advanced its read cursor in the same transaction. The `conversation` carries the freshly written `last_message_preview`, `last_message_at`, and `last_sequence` so an inbox UI can update without a refetch.

## Token caching

`config.getToken` is called once per JWT lifetime, not per request. The cache decodes the JWT's `exp` claim and refreshes 30s before expiry. Concurrent callers share the in-flight refresh promise.

On a 401, the SDK invalidates the cache and retries the request **once** with a fresh token. If the second attempt also 401s, `AuthError` is thrown.

If you sign the user out or rotate tenants, drop the current `Poolse` instance (or, in `@poolse/react`, give `<PoolseProvider>` a new `key`) — there's no in-place invalidate API at the SDK level because mutating connection-shaped config after construction doesn't reach the open socket anyway.

## Idempotency

Every non-GET request carries an auto-generated `Idempotency-Key` header. The server caches 2xx responses per `(tenant, method, path, key)` for 24 hours, so a retry after a flaky network drop returns the same row instead of creating a duplicate. Non-2xx responses are never cached — you can retry with the same key after fixing a validation error.

To override the key (e.g., to make a deliberate retry intentional), pass `idempotencyKey` on `chat.rest.request`. Pass `null` to omit the header entirely. Resource methods auto-generate a fresh key per call.

## Retry behavior

Transient failures (network errors, 5xx, 429) are retried with exponential backoff + full jitter, capped by `maxBackoffMs`. On a 429 the server's `Retry-After` (seconds) is honored if present and larger than the computed backoff. Aborts (`DOMException('AbortError')`) are propagated, never wrapped.

The retry budget is `maxRetries` (default 3) attempts after the initial request — up to 4 attempts total per logical call.

## Errors

All errors extend `PoolseError` and are `instanceof`-checkable:

```ts
import { ApiError, AuthError, RateLimitedError, NetworkError, PoolseError } from '@poolse/sdk';

try {
  await chat.messages.one(id).update({ body: 'edit' });
} catch (err) {
  if (err instanceof AuthError) {
    // 401: the JWT is invalid even after one refresh attempt. Re-auth the user.
  } else if (err instanceof RateLimitedError) {
    // 429: err.retryAfterMs is parsed from the Retry-After header (0 if absent).
  } else if (err instanceof ApiError) {
    // Other 4xx/5xx with a canonical envelope: err.status, err.code, err.docUrl, err.details
  } else if (err instanceof NetworkError) {
    // fetch() rejected; err.cause is the original failure.
  }
}
```

The server's error envelope is exposed via the `code` / `docUrl` / `details` fields on `ApiError`. Codes are stable strings like `validation_failed`, `forbidden`, `message_deleted`, `attachment_too_large` — see the docs at `err.docUrl` for the full list per endpoint.

## Sequence numbers

Every message has a monotonic per-conversation `sequence`. It's assigned in the same transaction as the insert, so server order is unambiguous regardless of clock skew. The SDK uses it for pagination (`before` / `after` cursors) and for sorting optimistic-vs-server-echo races: the optimistic local insert can sort to the very end until the server-assigned `sequence` arrives, at which point the dedup-by-id upsert puts it in the right place.

## Cancellation

Every method that touches the network accepts an `AbortSignal`. The SDK propagates abort to the underlying `fetch` (and to `XMLHttpRequest` on the progress-enabled upload path). Aborted requests throw `DOMException('AbortError')` — they are **not** retried.

```ts
const controller = new AbortController();
const promise = chat.messages.one(id).replies({ limit: 100 }, controller.signal);
// later:
controller.abort();
```

## Environments

- **Browsers (modern)** — works out of the box.
- **Node ≥ 18** — uses the global `fetch` and `WebSocket`. Upload progress is browser-only (silently no-ops in Node).
- **React Native** — works on RN ≥ 0.72 (`fetch` + `WebSocket` are built in). The `phoenix` client is bundled.
- **Bun / Deno** — works; same caveat on upload progress.
- **Web Workers** — works for REST; sockets work where `WebSocket` is available.

## Exports

The package exports the `Poolse` class, the resource and channel classes (`ConversationsResource`, `ConversationHandle`, `MessagesResource`, `MessageHandle`, `AttachmentsResource`, `AttachmentHandle`, `MeResource`, `UsersResource`, `PoolseRealtime`, `ConversationChannel`, `UserChannel`), all error classes, every interface from the wire protocol (`Message`, `Conversation`, `Membership`, `User`, `Attachment`, etc.), the `RealtimeStatus` union, the `POOLSE_API_URL` default, and a `version` constant for diagnostics.

## Links

- Full docs — <https://poolse.dev/docs>
- Source — <https://github.com/poolse-hq/js-sdk>
- Issues — <https://github.com/poolse-hq/js-sdk/issues>

## License

MIT
