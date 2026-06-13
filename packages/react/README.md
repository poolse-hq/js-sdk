# `@poolse/react`

React hooks library for realtime chat. Wraps [`@poolse/sdk`](https://www.npmjs.com/package/@poolse/sdk) in `PoolseProvider` + a typed hook per resource — `useMessages`, `useThread`, `useReactions`, `useTyping`, `usePresence`, `useMembers`, `useAttachmentUpload`. Works in both web React and React Native — same hook surface, same behaviour, same types. No UI: for components see [`@poolse/react-ui`](https://www.npmjs.com/package/@poolse/react-ui) (web) or [`@poolse/react-native`](https://www.npmjs.com/package/@poolse/react-native) (mobile).

> **MIT-licensed alternative to `sendbird-chat-react`, `stream-chat-react`, and `talkjs-react`.** Hooks-only by design — bring your own UI, or drop into the components when you don't want to.

> **⚠️ Upgrading from 1.x?** See [MIGRATING.md](https://github.com/poolse-hq/js-sdk/blob/main/MIGRATING.md). `useUser`, `useTyping`, `usePresence`, and `useMembers().removeMember` all key by your `external_id` now instead of poolse uuids.

## Install

```bash
npm install @poolse/react @poolse/sdk
```

`react@>=18` is a peer dependency. React 19 works.

## Quick start

```tsx
import { PoolseProvider, useMessages } from '@poolse/react';

function App() {
  return (
    <PoolseProvider
      config={{
        apiUrl: 'https://api.poolse.dev',
        getToken: async () => {
          const res = await fetch('/api/chat-token', { method: 'POST' });
          const { token } = await res.json();
          return token;
        },
      }}
    >
      <Chat conversationId="00000000-0000-0000-0000-000000000000" />
    </PoolseProvider>
  );
}

function Chat({ conversationId }: { conversationId: string }) {
  const { messages, send, loading } = useMessages(conversationId);

  if (loading) return <div>Loading…</div>;
  return (
    <ul>
      {messages.map((m) => (
        <li key={m.id}>{m.body}</li>
      ))}
      <button onClick={() => send({ body: 'Hi' })}>Send</button>
    </ul>
  );
}
```

## `<PoolseProvider>`

```tsx
<PoolseProvider config={config}>{children}</PoolseProvider>
```

`config` is the same `PoolseConfig` the bare SDK accepts (see [`@poolse/sdk`](https://www.npmjs.com/package/@poolse/sdk) for the full reference).

The provider builds **one** `Poolse` instance per mount. Connection-shaped fields (`apiUrl`, `wsUrl`, `socketPath`) are captured at construction and don't react to subsequent changes; the development build warns when you change them after mount. Function-valued fields (`getToken`, `fetch`, `userResolver`, `generateIdempotencyKey`, `onSocketError`) are read from a ref on every call, so passing fresh closures on every render is safe and expected:

```tsx
// Fine — getToken is re-read through a ref each call.
<PoolseProvider config={{ apiUrl, getToken: () => session.token }}>
```

To force a fresh client (sign-out, tenant swap, environment switch), remount the provider with a new `key`. On unmount, `chat.destroy()` runs, which closes the WebSocket and drops every joined channel.

### `usePoolse()`

Escape hatch — returns the underlying `Poolse` instance for callers that need direct REST or realtime access. Throws if there's no provider above it.

```ts
const chat = usePoolse();
const me = await chat.me.show();
```

## Hooks

Each hook below is briefly described, then documented in full. All hooks that touch a conversation subscribe to its realtime channel for the duration of the component's lifetime.

### `useMe(): { me, loading, error }`

Fetches `GET /v1/me` once on mount. Identity is stable for the JWT's lifetime, so the hook doesn't refetch on its own — remount the provider to switch users.

### `useConversation(id): { conversation, loading, error, refetch }`

Single conversation, REST-only. Settings changes (name, avatar) won't show up live on this hook — call `refetch()` after a mutation. Live message activity for the same conversation flows through `useMessages` instead. Pass `null` to skip the fetch.

### `useConversations(): { conversations, create, unreadCounts, markConversationRead, ... }`

The user's conversation list. On mount it fetches `GET /v1/conversations` and subscribes to the user's own `user:<id>` channel for two events: `conversation:created` (fires both when this user creates a conversation and when someone else adds them to one) and `conversation:updated` (fires after every message sent in any of their conversations).

Return shape:

```ts
const { conversations, loading, error, refetch, create, unreadCounts, markConversationRead } =
  useConversations();
```

`conversations` is the list of `Conversation` rows. `refetch()` does an explicit re-sync. `create(attrs)` calls `POST /v1/conversations` and optimistically prepends the result; when the realtime echo arrives with the same id, id-based dedup replaces the row in place so there's no double-insert.

`unreadCounts` is `Record<Uuid, number>`. Initial values come from the server's `Conversation.unread_count`. The `conversation:updated` subscription keeps them live without polling: when another member sends a message, the corresponding row's preview, timestamp, and unread badge update in place; when YOU send (`by_user_id` equals your id) the row floats to the top and unread stays at 0 (the server already advanced your read cursor in the same transaction). `markConversationRead(conversationId)` zeroes the badge locally — wire this from `ConversationView.onMarkedRead` so the sidebar clears immediately, before the server's read-receipt echo round-trips.

### `useMessages(conversationId): { messages, send, edit, delete, loadMore, hasMore, markReadUpTo, ... }`

Live messages for one conversation. Initial fetch is the newest 50; pagination loads older pages with `loadMore()`. Subscribes to `message:new`, `message:updated`, `message:deleted` on the channel.

```ts
const {
  messages, // Message[] — newest-LAST (the wire is newest-first; reversed)
  loading,
  error,
  hasMore,
  loadMore, // () => Promise<void>
  send, // (attrs: MessageCreateRequest) => Promise<Message>
  edit, // (messageId: Uuid, body: string) => Promise<Message>
  delete: del, // (messageId: Uuid) => Promise<void>
  markReadUpTo, // (messageId: Uuid) => Promise<void>
} = useMessages(conversationId);
```

**Optimistic sends with id-based dedup.** `send()` generates a UUID client-side, appends an optimistic row sorted to the very end (`sequence: MAX_SAFE_INTEGER`), then POSTs with that same id. Whichever lands first — the REST response or the realtime `message:new` echo — wins via `upsertById`; the other arrival is a no-op replace. Errors filter the temp row by id.

**Thread routing.** Realtime `message:new` events with `thread_root_id` set are **not** added to `messages` (replies live in the thread side-pane). Instead the hook finds the root locally and increments its `reply_count`. The REST list excludes replies too (`WHERE thread_root_id IS NULL`), so a refresh and a realtime burst stay consistent.

**Edits and deletes.** Both are optimistic with synchronous rollback on error. The hook captures a snapshot before mutating so the rollback isn't racing React's update queue.

**Read cursor.** `markReadUpTo(messageId)` fires the read against `POST /v1/conversations/:id/read`. The server broadcasts `member:read` to other clients; this hook itself doesn't mutate state (the `useMembers` hook does — see below).

### `useThread(conversationId, rootMessageId): { replies, sendReply, edit, delete, loadMore, hasMore, ... }`

Side-pane replies for one root message. The wire returns replies oldest-first; the hook keeps that order. The default fetch is 500 replies in one round-trip — most threads load whole. `loadMore()` paginates with an `after` cursor when a thread overflows.

```ts
const {
  replies, // Message[] — oldest-first
  loading,
  error,
  hasMore,
  loadMore,
  sendReply, // (attrs: Omit<MessageCreateRequest, 'reply_to_id'>) => Promise<Message>
  edit,
  delete: del,
} = useThread(conversationId, rootMessageId);
```

Subscriptions filter by `thread_root_id === rootMessageId` so unrelated messages in the same conversation don't end up here. `sendReply` auto-fills `reply_to_id` with the root id — same optimistic-id dedup pattern as `useMessages.send`.

### `useReactions(messageId, opts): { reactions, addReaction, removeReaction }`

Live reaction map for one message. Subscribes to `reaction:added` / `reaction:removed` filtered to the message id.

```ts
const { reactions, addReaction, removeReaction } = useReactions(messageId, {
  conversationId,
  initialReactions: msg.reactions, // seed from the Message you already have
  currentUserId: meId, // enables optimistic add/remove
});
```

`reactions` is a `Record<emoji, Uuid[]>` (matching `Message.reactions`). Adds + removes are optimistic when `currentUserId` is provided; the optimistic delta is rolled back on error.

### `useTyping(conversationId): { typing, signalTyping }`

```ts
const { typing, signalTyping } = useTyping(conversationId);
// typing: Set<Uuid> of users currently typing (your own id is filtered out)
// signalTyping: client-side debounced to ≤ 1 ping / 500ms
```

Call `signalTyping` on every keystroke; the hook drops events that arrive within 500ms of the last one, and the server has its own rate limit per (user, conversation) on top.

### `usePresence(conversationId): { online }`

```ts
const { online } = usePresence(conversationId);
// online: Set<Uuid> of users currently joined to the channel
```

Replays the initial `presence_state` snapshot on join, then applies `presence_diff` deltas. Pass an empty string id to opt out (the set stays empty).

### `useMembers(conversationId): { members, addMembers, removeMember, refetch, ... }`

Conversation roster. Initial fetch is `GET /v1/conversations/:id/members`. Subscribes to `member:read` on the channel and advances the matching membership's `last_read_message_id` and `last_read_at` in place — which is how `<MessageBubble>`'s read-receipt glyph (in `@poolse/react-ui`) flips from sent to read in real time.

```ts
const {
  members, // Membership[]
  loading,
  error,
  refetch,
  addMembers, // (externalIds: string[], { role? }?) => Promise<Membership[]>
  removeMember, // (userId: Uuid) => Promise<void>
} = useMembers(conversationId);
```

`addMembers` deduplicates by id (server returns an idempotent add). `removeMember` is optimistic with snapshot rollback.

Empty `conversationId` opts out of the fetch (returns `{ members: [], loading: false }`).

`member:read` events that arrive before the initial fetch lands are buffered and replayed after `setMembers` commits — without that, reads in the subscribe → fetch-response gap would silently no-op against an empty member list.

### `useAttachmentUpload(): { queue, upload, uploadAll, cancel, remove, reset, ... }`

Queued multi-file uploads with per-item progress and cancel.

```ts
const { queue, upload, uploadAll, cancel, remove, reset, uploading, error } = useAttachmentUpload();

// Single file
const att = await upload({
  body: file,
  contentType: file.type,
  byteSize: file.size,
  filename: file.name,
});

// Batch (parallel PUTs, returned in input order)
const atts = await uploadAll(
  files.map((f) => ({ body: f, contentType: f.type, byteSize: f.size, filename: f.name })),
);
```

Each `UploadItem` carries `{ localId, filename, contentType, byteSize, status, loaded, attachment, error }` with `status` cycling through `'pending' → 'uploading' → 'ready' | 'error' | 'cancelled'`. `loaded` is byte progress (browser-only — `fetch` doesn't expose upload progress, so the hook switches to XHR when `onProgress` is wired internally). Cancellation per item via `cancel(localId)`; full teardown via `reset()`.

The hook tracks a `mountedRef` so a fast unmount aborts all in-flight uploads instead of leaking promises.

### `useAttachmentUrl(attachmentId): { url, loading, error }`

Fetches a presigned GET URL for an attachment. Pass `null` to skip.

The URL has a ~1 hour TTL server-side. The hook doesn't auto-refresh — most UI lifetimes are shorter than the TTL anyway, and silently re-fetching mid-render would break image elements. If you have a long-lived dashboard, remount the hook (or wrap it in a parent that re-keys on a timer).

### `useUser(userId): { profile, loading }`

Resolves a poolse `user_id` to your customer-supplied display name + avatar via the `userResolver` you configured on the provider. Cached + deduplicated across the app.

```ts
const { profile, loading } = useUser(message.sender_id);
// profile: { displayName: string; avatarUrl: string | null } | null
```

If you don't configure `userResolver`, the hook always returns `{ profile: null, loading: false }`. Components in `@poolse/react-ui` (sender labels, mention dropdowns, member lists) fall back to a stable color-tinted initials avatar in that case.

Pass falsy `userId` to no-op the hook (used internally by self-message bubbles, which don't need to resolve the sender).

### `useRealtimeStatus(): RealtimeStatus`

```ts
const status = useRealtimeStatus();
// 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed'
```

For "Reconnecting…" banners without coupling to socket internals.

## Wiring user identity

The SDK doesn't store names or avatars — that's your app's data. Wire `userResolver` once on the provider and every component that renders a sender lights up:

```tsx
<PoolseProvider
  config={{
    apiUrl,
    getToken,
    userResolver: async (poolseUserId) => {
      // Translate poolse's user_id to your own user record.
      const u = await fetch(`/api/users/by-poolse-id/${poolseUserId}`).then((r) => r.json());
      return { displayName: u.full_name, avatarUrl: u.avatar_url };
    },
  }}
>
```

Resolved profiles are cached in-memory and concurrent lookups for the same id share one in-flight promise. Resolver errors are logged once (via `console.error` with `[poolse]` prefix) and cached as `null` so a single transient failure doesn't trigger a retry storm.

## What you can rely on

- **Mount-once SDK instance.** Stable WebSocket and channel subscriptions for the life of the provider; safe to pass fresh inline callbacks on every render.
- **Auto-rejoin on reconnect.** Phoenix handles channel rejoin internally; the JWT is re-read from `getToken` each handshake.
- **Optimistic dedup by client-generated id.** `useMessages.send` and `useThread.sendReply` insert under the same id the server will assign, so the realtime echo upserts in place rather than duplicating.
- **Synchronous rollback for optimistic edits.** Edit / delete / `removeReaction` / `removeMember` capture a ref snapshot before mutating, then restore the snapshot on error rather than relying on `setState((prev) => ...)`.
- **Buffered early events.** `useMembers` buffers `member:read` events that race the initial member fetch.
- **Abort-safe.** Hooks that fetch on mount cancel in-flight requests on unmount and ignore `AbortError`. Aborted fetches don't surface as "Failed to load" errors.

## Exports

```ts
// Provider
export { PoolseProvider, usePoolse, type PoolseProviderProps };

// Hooks
export { useMe, useConversation, useConversations, useMembers, useMessages };
export { useReactions, type ReactionMap };
export { useThread, useTyping, usePresence, useRealtimeStatus };
export { useAttachmentUpload, type UploadItem, type UploadItemStatus };
export { useAttachmentUrl, useUser, type UseUserState };

// Re-exported SDK types (so you don't have to add @poolse/sdk to your imports)
export type {
  Attachment,
  AttachmentStatus,
  AttachmentUploadInput,
  AttachmentUploadRequest,
  AttachmentUploadResponse,
  Conversation,
  ConversationCreateRequest,
  Me,
  MemberRole,
  Membership,
  Message,
  MessageCreateRequest,
  MessageType,
  PoolseConfig,
  PoolseUserProfile,
  RealtimeStatus,
  Uuid,
};

// Re-exported error classes
export { ApiError, AuthError, PoolseError, NetworkError, RateLimitedError };
```

## Links

- Full docs — <https://poolse.dev/docs/react>
- SDK reference — [`@poolse/sdk`](https://www.npmjs.com/package/@poolse/sdk)
- UI components — [`@poolse/react-ui`](https://www.npmjs.com/package/@poolse/react-ui)
- Source — <https://github.com/poolse-hq/js-sdk>

## License

MIT
