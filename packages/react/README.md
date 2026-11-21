# `@poolse/react`

React provider and hooks for [poolse](https://poolse.dev), on top of
[`@poolse/sdk`](https://www.npmjs.com/package/@poolse/sdk). No UI. The same
hooks work on the web and in React Native. For components, see
[`@poolse/react-ui`](https://www.npmjs.com/package/@poolse/react-ui) (web)
or [`@poolse/react-native`](https://www.npmjs.com/package/@poolse/react-native).

Full reference: <https://poolse.dev/docs/sdk/react>

## Install

```bash
npm install @poolse/react @poolse/sdk
```

Peer: `react` ≥ 18. `@poolse/sdk` is a dependency; keep the same major
version if you also install it.

## Quick start

```tsx
import { PoolseProvider, useMessages, type PoolseConfig } from '@poolse/react';

const config: PoolseConfig = {
  getToken: async () => {
    const res = await fetch('/api/chat-token', { method: 'POST' });
    const { token } = await res.json();
    return token;
  },
  userResolver: async (externalId) => {
    const u = await fetch(`/api/users/${externalId}`).then((r) => r.json());
    return { displayName: u.name, avatarUrl: u.avatar_url };
  },
};

export function App() {
  return (
    <PoolseProvider config={config}>
      <Chat conversationId="…" />
    </PoolseProvider>
  );
}

function Chat({ conversationId }: { conversationId: string }) {
  const { messages, send, loading } = useMessages(conversationId);
  if (loading) return <p>Loading…</p>;
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

The provider creates one `Poolse` instance per mount. Function options are
read through a ref, so new closures on each render are fine. Remount with a
new `key` to switch user.

### Several workspaces

Create one client per workspace outside React and hand each to its own
provider. Providers side by side never share state, and a provider never
destroys a client it was given — unmounting or hiding a workspace keeps its
socket and its warm cache, so switching back is a view change:

```tsx
<PoolseProvider client={acme} background={current !== acme}>
  <Workspace />
</PoolseProvider>
```

The conversation list store lives with the client (`chat.scoped`), so a
remounted provider shows it at once; `useMessages` shows the client's cached
messages at once (`fromCache: true`) while the page refetches. `background`
closes the socket while true (phones; leave it unset on desktop). Sign out
of one with `client.destroy({ clearStorage: true })`.

## Hooks

| Hook                                                                             | Returns                                                                                                                                                             |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `usePoolse()`                                                                    | The `Poolse` instance.                                                                                                                                              |
| `useMe()`                                                                        | `{ me, loading, error }`                                                                                                                                            |
| `useConversation(id \| null)`                                                    | `{ conversation, loading, error, refetch }`                                                                                                                         |
| `useConversations()`                                                             | `{ conversations, loading, error, refetch, hasMore, loadingMore, loadMore, create, unreadCounts, mentionUnreadCounts, markConversationRead }`                       |
| `useUnreadTotals(client?)`                                                       | `{ unread, mentions, conversations, source, loading, error, refresh }` for one client, live — pass a client to read one outside its provider (a workspace rail)     |
| `useUnreadQueue({ mentionsFirst?, filter? })`                                    | `{ queue, current, remaining, next(), skip(), markRead(id), reset() }` — unread conversations by latest activity; `next()` marks `current` read and moves on        |
| `useOutbox({ conversationId?, client? })`                                        | `{ entries, pending, failed, retry, remove, flush }`                                                                                                                |
| `useClientTimings(client?)`                                                      | the client's `timings.get()`, re-rendering as timings land                                                                                                          |
| `useMessages(conversationId)`                                                    | `{ messages, loading, error, hasMore, loadMore, loadUntil(messageId), send, retry(id), discard(id), edit, delete, markReadUpTo, fromCache, refetch }`, oldest first |
| `useThread(conversationId, rootId)`                                              | `{ replies, loading, error, hasMore, loadMore, sendReply, edit, delete }`                                                                                           |
| `useReactions(messageId, { conversationId, initialReactions?, currentUserId? })` | `{ reactions, addReaction, removeReaction }`                                                                                                                        |
| `useTyping(conversationId)`                                                      | `{ typing: Set<externalId>, signalTyping }`                                                                                                                         |
| `usePresence(conversationId)` / `useConversationPresence`                        | `{ online: Set<externalId> }` — who has the conversation open                                                                                                       |
| `useUserPresence(id \| null)`                                                    | `Presence \| null` — `state`: `online`, `away`, `in_call`, `offline`                                                                                                |
| `usePresenceMany(ids)`                                                           | `Record<id, Presence>` (known ids only)                                                                                                                             |
| `useMembers(conversationId)`                                                     | `{ members, loading, error, refetch, addMembers(externalIds, { role? }), removeMember(externalId) }`                                                                |
| `useAttachmentUpload()`                                                          | `{ queue, attachment, uploading, error, upload(input), uploadAll(inputs), cancel(localId), remove(localId), reset }`                                                |
| `useAttachmentUrl(id \| null)`                                                   | `{ url, loading, error }` (not renewed; URLs last one hour)                                                                                                         |
| `useUser(externalId)`                                                            | `{ profile, loading }`                                                                                                                                              |
| `useAppEvent(handler)`                                                           | Calls `handler({ type, data })` for each `app:event` sent to the user                                                                                               |
| `useRealtimeStatus()`                                                            | `'idle' \| 'connecting' \| 'connected' \| 'reconnecting' \| 'closed'`                                                                                               |
| `useReadReceipts()`                                                              | `{ visible, mode, shared, canChange, setShared }`                                                                                                                   |
| `useLiveCall(conversationId \| null)`                                            | `{ call, participantIds, refresh }`                                                                                                                                 |
| `useRoom(conversationId \| null, { livekit })`                                   | `{ live, presentIds, joined, joining, join, leave, media, error }`                                                                                                  |
| `useCallRoom(conversationId \| null, { livekit, … })`                            | Call media: participants, mic, camera, devices, `canPublish`, `republish()`                                                                                         |
| `useRecording(callId, conversationId, initial?)`                                 | `{ available, active, capturing, consentRequired, myConsent, needsConsent, notice, lastRecording, start(mode?), stop, consent(decision), pending, error }`          |
| `useLiveTranscript(callId, { enabled? })`                                        | `{ segments, finals, interim, transcript, live, joined, start, stop, error }` — the call's live transcript topic                                                    |
| `useTranscript(callId)`                                                          | `{ transcript, loading, missing, error, renameSpeakers(names), refresh }`                                                                                           |
| `useTranscripts(conversationId)` / `useRecordings(conversationId)`               | `{ items, loading, error, refresh }`, newest first, re-read as they change                                                                                          |

Helpers: `canEditOwnMessage`, `EDIT_WINDOW_MS`, `receiptsOf`,
`computeGroupPosition`, `sameGroup`, `sameDay`, `formatDayLabel`, plus
re-exports of the SDK's error classes, call-log helpers and wire types.

Notes that trip people up:

- `useTyping`, `usePresence`, `useUser` and `useMembers().removeMember` use
  **your** user ids (`external_id`). `useReactions`' `currentUserId` and the
  `reactions` map use **poolse** user ids (`me.id`).
- `useMessages().send` goes through the client's outbox (3.8): offline, the
  row stays as `local_status: 'queued'` and goes out on reconnect (the promise
  rejects with `MessageQueuedError` — not a failure to show); refused (4xx), it
  stays as `'failed'` with `local_error` until `retry(id)` / `discard(id)`.
  With `outbox: false` in the config it removes the row and rejects, as
  before. Thread replies (`useThread`) don't use the outbox yet.
- `useAttachmentUpload().upload` takes `{ body, contentType, byteSize, filename? }`,
  not a bare `File`. Send `item.attachment.id`, not `item.localId`.
- From 3.1, `useMessages` (the newest 50, merged in) and `useConversations`
  reload from REST after the socket reconnects. The first connect doesn't
  count as a reconnect.
- Every `useConversations()` under one provider shares one list, so a
  `markReadUpTo` (or `markConversationRead`) anywhere clears the badge in
  every view, and a read on another device arrives as `conversation:read`.
- After `chat.users.invalidate(externalId)` — or a `member:updated` app event,
  which does it for you — `useUser` re-resolves, keeping the old profile on
  screen until the new one lands.
- If the user is removed from a conversation, its mounted hooks stop
  updating; hooks mounted later join a fresh channel.
- `useUserPresence` / `usePresenceMany` take user ids or external ids and
  share one store per provider: hooks mounted together make one lookup, and
  `presence:changed` keeps them live. `<PoolseProvider>` reports the browser
  tab `active` / `idle` (`trackActivity`, on by default; a no-op in React
  Native, where you call `usePoolse().presence.setActivity()` from `AppState`).
- `useConversations` loads the first page (50); call `loadMore()` while
  `hasMore` for the rest.
- `useMessages` / `useThread` merge `message:updated` (edits, link previews
  arriving in `link_previews`), keep deleted messages as tombstones
  (`deleted_at` set, `body: null`) and apply `thread:updated` to the root's
  `reply_count`, `last_reply_at` and `thread_participants`.

## Links

- Docs: <https://poolse.dev/docs/sdk/react>
- Source: <https://github.com/poolse-hq/js-sdk>

## License

Licensed under the [poolse SDK License](./LICENSE) from 3.0.0; versions
before 3.0.0 remain MIT.
