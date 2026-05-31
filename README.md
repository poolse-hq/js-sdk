# poolse-js

TypeScript SDKs for the [poolse](https://github.com/jasirfetai/poolse) Chat-as-a-Service backend.

This repository is a pnpm monorepo. **Three packages**, each usable independently:

| Package                                   | What                                                                                                                  | Use when                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`@poolse/sdk`](./packages/sdk)           | Headless TypeScript SDK. REST + WebSocket + offline queue. No React, no DOM.                                          | Building for Node, vanilla JS, mobile (RN), or you want zero UI opinions.    |
| [`@poolse/react`](./packages/react)       | Headless React hooks built on `@poolse/sdk`. Provider + `useMessages` / `useTyping` / `usePresence` / etc. **No UI**. | You want real-time wired up but you're building your own UI from scratch.    |
| [`@poolse/react-ui`](./packages/react-ui) | Plug-and-play React components built on `@poolse/react`. CSS-variable theming + render-slot escape hatches.           | You want a working chat in 5 minutes; eject to lower layers later if needed. |

You can mix and match. `<ConversationView>` uses the hooks from `@poolse/react`, which use the client from `@poolse/sdk` — drop down a layer at any point without re-architecting.

## Quickstart (5-minute chat)

```bash
pnpm add @poolse/sdk @poolse/react @poolse/react-ui
```

```tsx
import '@poolse/react-ui/styles.css';
import { PoolseProvider } from '@poolse/react';
import { ConversationView } from '@poolse/react-ui';

const config = {
  apiUrl: import.meta.env.VITE_CHATAPP_URL ?? 'http://localhost:4000',
  getToken: async () => fetchJwtFromYourBackend(),
};

export default function App() {
  return (
    <PoolseProvider config={config}>
      <ConversationView conversationId="..." />
    </PoolseProvider>
  );
}
```

## Hooks-only (custom UI, real-time wired)

```tsx
import { PoolseProvider, useMessages, useTyping } from '@poolse/react';

function Chat({ conversationId }: { conversationId: string }) {
  const { messages, send, loadMore, hasMore } = useMessages(conversationId);
  const { typing, signalTyping } = useTyping(conversationId);

  return (
    <YourCustomChatUI
      messages={messages}
      typing={typing}
      onSend={(body) => send({ body })}
      onInput={signalTyping}
    />
  );
}
```

## Headless core only (no React)

```ts
import { Poolse } from '@poolse/sdk';

const chat = new Poolse({ apiUrl, getToken });

const conv = chat.realtime.conversation('conv-uuid');
conv.onMessage((msg) => render(msg));
conv.sendTyping();

await chat.conversations.one('conv-uuid').messages.send({ body: 'hello' });
```

## Customization

`@poolse/react-ui` defaults are driven by CSS variables — rebrand without touching JS:

```css
:root {
  --poolse-color-primary: #ff5722;
  --poolse-color-self-bubble: #ff5722;
  --poolse-radius: 8px;
}
```

Need more control? Three escape hatches in order:

1. **Render slots** — swap a specific subcomponent:
   ```tsx
   <ConversationView renderMessage={(msg, currentUserId) => <MyBubble {...} />} />
   ```
2. **Component composition** — use individual pieces (`<MessageBubble>`, `<MessageComposer>`, `<TypingIndicator>`) directly.
3. **Drop to `@poolse/react`** — write your own component using the same hooks `<ConversationView>` uses. No fork.

## Development

All work runs inside Docker — nothing in this project should be installed on the host (matches the backend repo's rule).

```bash
docker compose run --rm node pnpm install      # one-time
docker compose run --rm node pnpm check        # everything CI runs (typecheck + lint + format + test + build)
docker compose run --rm node pnpm test         # all packages
docker compose run --rm node pnpm -F @poolse/sdk test    # just one package
docker compose run --rm node pnpm build        # build all packages
```

### Layout

```
poolse-js-sdk/
├── packages/
│   ├── sdk/         @poolse/sdk
│   ├── react/       @poolse/react
│   └── react-ui/    @poolse/react-ui
├── tsconfig.base.json      ← shared base for all packages
├── eslint.config.js        ← shared (flat config, ESLint 9)
├── .prettierrc.json
├── docker-compose.yml
└── Dockerfile.dev
```

### Releasing

(Once 0.1.0 ships.) Bump all three package versions in lockstep when the wire protocol changes; bump only the leaf packages otherwise. `pnpm publish -r --access public` releases everything that's changed.
