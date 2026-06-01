# `@poolse/react`

Headless React hooks for **[poolse](https://poolse.dev)** — realtime chat infrastructure.

Provider + hooks for `useMe`, `useConversations`, `useMessages`, `useTyping`, `usePresence`, `useReactions`, `useThread`, `useAttachmentUpload`, and more. No UI — bring your own, or use the prebuilt components in **[`@poolse/react-ui`](https://www.npmjs.com/package/@poolse/react-ui)**.

## Install

```bash
npm install @poolse/react @poolse/sdk
```

## Quick start

```tsx
import { PoolseProvider, useMessages } from '@poolse/react';

function App() {
  return (
    <PoolseProvider
      config={{
        apiUrl: 'https://chat.example.com',
        getToken: async () => {
          const res = await fetch('/api/chat-token', { method: 'POST' });
          const { token } = await res.json();
          return token;
        },
      }}
    >
      <Chat conversationId="<conversation-id>" />
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
      <button onClick={() => send({ body: 'Hi!' })}>Send hi</button>
    </ul>
  );
}
```

## Hooks at a glance

| Hook                            | Returns                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `useMe()`                       | The signed-in End User                                                               |
| `useConversations()`            | List + `create` + realtime new-conversation push                                     |
| `useConversation(id)`           | Single conversation read + refetch                                                   |
| `useMembers(convId)`            | Membership list + add/remove helpers                                                 |
| `useMessages(convId)`           | Live messages + `send` + pagination + optimistic dedup                               |
| `useThread(convId, rootId)`     | Replies + `sendReply` + pagination                                                   |
| `useTyping(convId)`             | Live `typing` set + `signalTyping` (debounced)                                       |
| `usePresence(convId)`           | Live `online` set                                                                    |
| `useReactions(messageId, opts)` | Live reaction map + add/remove                                                       |
| `useAttachmentUpload()`         | Upload queue with per-item progress, `upload` / `uploadAll` / `cancel` / `remove`    |
| `useAttachmentUrl(id)`          | Presigned download URL                                                               |
| `useUser(userId)`               | Customer-supplied profile via `config.userResolver`, cached + dedup'd                |
| `useRealtimeStatus()`           | Socket lifecycle (connecting / connected / reconnecting / closed)                    |
| `usePoolse()`                   | Raw `Poolse` instance (escape hatch)                                                 |

## Identity resolution (`userResolver`)

The SDK doesn't know your users' names or where their avatars live. Wire a `userResolver` once on the provider and every component that renders a sender (`<MessageBubble>`, `<MemberList>`, `<TypingIndicator>`, `<MentionInput>`, …) lights up automatically:

```tsx
<PoolseProvider
  config={{
    apiUrl,
    getToken,
    userResolver: async (userId) => {
      const u = await fetch(`/api/users/by-poolse-id/${userId}`).then((r) => r.json());
      return { displayName: u.full_name, avatarUrl: u.avatar_url };
    },
  }}
>
  …
</PoolseProvider>
```

Resolved profiles are cached in-memory and concurrent lookups dedupe — a busy chat with 50 messages from 5 senders fires the resolver 5 times, not 50.

## What the provider gives you

- **One `Poolse` instance per mount.** Stable WebSocket and channel subscriptions for the life of the provider. Pass a fresh inline `config={{ getToken: … }}` on every render — `getToken` is read from a ref each call, so the SDK doesn't tear down.
- **Auto-rejoin** when the socket drops + reconnects.
- **Optimistic message dedup** by client-generated id — `useMessages.send()` adds the row under the same id the server will assign, so the realtime echo upserts in place rather than appending a duplicate.

## Documentation

- Full hook reference + recipes — <https://poolse.dev/docs/react>
- Source — <https://github.com/poolse-hq/js-sdk>
- Issues — <https://github.com/poolse-hq/js-sdk/issues>

## License

MIT
