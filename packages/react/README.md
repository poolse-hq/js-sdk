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

## Hooks

| Hook                                                                             | Returns                                                                                                              |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `usePoolse()`                                                                    | The `Poolse` instance.                                                                                               |
| `useMe()`                                                                        | `{ me, loading, error }`                                                                                             |
| `useConversation(id \| null)`                                                    | `{ conversation, loading, error, refetch }`                                                                          |
| `useConversations()`                                                             | `{ conversations, loading, error, refetch, create, unreadCounts, markConversationRead }`                             |
| `useMessages(conversationId)`                                                    | `{ messages, loading, error, hasMore, loadMore, send, edit, delete, markReadUpTo, refetch }`, oldest first           |
| `useThread(conversationId, rootId)`                                              | `{ replies, loading, error, hasMore, loadMore, sendReply, edit, delete }`                                            |
| `useReactions(messageId, { conversationId, initialReactions?, currentUserId? })` | `{ reactions, addReaction, removeReaction }`                                                                         |
| `useTyping(conversationId)`                                                      | `{ typing: Set<externalId>, signalTyping }`                                                                          |
| `usePresence(conversationId)`                                                    | `{ online: Set<externalId> }`                                                                                        |
| `useMembers(conversationId)`                                                     | `{ members, loading, error, refetch, addMembers(externalIds, { role? }), removeMember(externalId) }`                 |
| `useAttachmentUpload()`                                                          | `{ queue, attachment, uploading, error, upload(input), uploadAll(inputs), cancel(localId), remove(localId), reset }` |
| `useAttachmentUrl(id \| null)`                                                   | `{ url, loading, error }` (not renewed; URLs last one hour)                                                          |
| `useUser(externalId)`                                                            | `{ profile, loading }`                                                                                               |
| `useRealtimeStatus()`                                                            | `'idle' \| 'connecting' \| 'connected' \| 'reconnecting' \| 'closed'`                                                |
| `useReadReceipts()`                                                              | `{ visible, mode, shared, canChange, setShared }`                                                                    |
| `useLiveCall(conversationId \| null)`                                            | `{ call, participantIds, refresh }`                                                                                  |
| `useRoom(conversationId \| null, { livekit })`                                   | `{ live, presentIds, joined, joining, join, leave, media, error }`                                                   |
| `useCallRoom(conversationId \| null, { livekit, … })`                            | Call media: participants, mic, camera, devices                                                                       |

Helpers: `canEditOwnMessage`, `EDIT_WINDOW_MS`, `receiptsOf`,
`computeGroupPosition`, `sameGroup`, `sameDay`, `formatDayLabel`, plus
re-exports of the SDK's error classes, call-log helpers and wire types.

Notes that trip people up:

- `useTyping`, `usePresence`, `useUser` and `useMembers().removeMember` use
  **your** user ids (`external_id`). `useReactions`' `currentUserId` and the
  `reactions` map use **poolse** user ids (`me.id`).
- `useMessages().send` removes the optimistic row and rejects if the request
  fails.
- `useAttachmentUpload().upload` takes `{ body, contentType, byteSize, filename? }`,
  not a bare `File`. Send `item.attachment.id`, not `item.localId`.
- From 3.1, `useMessages` and `useConversations` reload from REST after the
  socket reconnects, so nothing sent while it was down is missed.

## Links

- Docs: <https://poolse.dev/docs/sdk/react>
- Source: <https://github.com/poolse-hq/js-sdk>

## License

Licensed under the [poolse SDK License](./LICENSE) from 3.0.0; versions
before 3.0.0 remain MIT.
