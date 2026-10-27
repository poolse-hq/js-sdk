# poolse-js

TypeScript SDKs for [poolse](https://poolse.dev). Docs: <https://poolse.dev/docs/sdk>

This repository is a pnpm monorepo with **five packages**. They share one
version number and are released together (current release: 3.1).

| Package                                           | What                                                                                                               | Use when                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| [`@poolse/sdk`](./packages/sdk)                   | Headless TypeScript client: REST, the realtime WebSocket, rooms and call media on the web. No React, no UI.        | Node, vanilla JS, other frameworks, or your own layer on top. |
| [`@poolse/react`](./packages/react)               | React provider and hooks (`useMessages`, `useTyping`, `usePresence`, `useRoom`, …). No UI. Web and React Native.   | Your own UI with realtime state handled for you.              |
| [`@poolse/react-ui`](./packages/react-ui)         | Prebuilt web components (`PoolseInbox`, `ConversationView`, room UI), themed with CSS variables.                   | A working web chat quickly.                                   |
| [`@poolse/react-native`](./packages/react-native) | Prebuilt React Native / Expo components, a JS theme, the app-lifecycle hook, call-screen building blocks.          | An Expo or bare React Native app.                             |
| [`@poolse/native`](./packages/native)             | Native call core (CallKit/PushKit on iOS, call service on Android), chat-notification helpers, Expo config plugin. | Phone calls and poolse's push notifications on phones.        |

`ConversationView` uses the hooks from `@poolse/react`, which use the client
from `@poolse/sdk`, so you can drop down a layer at any point.

## Quick start (web)

```bash
npm install @poolse/sdk @poolse/react @poolse/react-ui
```

```tsx
import '@poolse/react-ui/styles.css';
import { PoolseProvider, type PoolseConfig } from '@poolse/react';
import { ConversationView } from '@poolse/react-ui';

const config: PoolseConfig = {
  // apiUrl defaults to https://api.poolse.dev
  getToken: async () => {
    const res = await fetch('/api/chat-token', { method: 'POST' }); // your backend mints the JWT
    const { token } = await res.json();
    return token;
  },
};

export default function App() {
  return (
    <PoolseProvider config={config}>
      <div style={{ height: '100vh' }}>
        <ConversationView conversationId="..." />
      </div>
    </PoolseProvider>
  );
}
```

Backend token minting and the rest of a production setup:
[INTEGRATION.md](./INTEGRATION.md).

### React Native (Expo)

```bash
npx expo install \
  @poolse/sdk @poolse/react @poolse/react-native \
  react-native-svg \
  react-native-markdown-display \
  react-native-safe-area-context \
  expo-clipboard \
  expo-image-picker \
  expo-document-picker \
  expo-image-manipulator
```

Every peer is required; see the [`@poolse/react-native` README](./packages/react-native#install).
Add `@poolse/native` (and `expo-notifications`) for calls and notifications.

## Hooks only (your own UI)

```tsx
import { useMessages, useTyping } from '@poolse/react';

function Chat({ conversationId }: { conversationId: string }) {
  const { messages, send, loadMore, hasMore } = useMessages(conversationId);
  const { typing, signalTyping } = useTyping(conversationId);

  return (
    <YourChatUI
      messages={messages}
      someoneTyping={typing.size > 0}
      onSend={(body) => send({ body })}
      onInput={signalTyping}
      onLoadOlder={hasMore ? loadMore : undefined}
    />
  );
}
```

## Headless core only (no React)

```ts
import { Poolse } from '@poolse/sdk';

const poolse = new Poolse({ getToken });

const conv = poolse.realtime.conversation(conversationId);
conv.onMessage((msg) => render(msg));
conv.sendTyping();

await poolse.conversations.one(conversationId).messages.send({ body: 'hello' });
```

## Customisation

`@poolse/react-ui` reads CSS variables, so you can rebrand without touching
JS:

```css
:root {
  --poolse-brand: #ff5722;
  --poolse-brand-soft: #ffe7df;
  --poolse-radius-md: 8px;
}
```

For more control, in order:

1. Render props, for example `<ConversationView renderMessage={(msg, currentUserId) => <MyRow … />} />`.
2. The individual components (`MessageBubble`, `MessageComposer`, `TypingIndicator`, …).
3. Your own components on the `@poolse/react` hooks.

## User names and avatars

poolse doesn't hold your users' names or avatars. Pass `userResolver` on the
provider. It receives **your** user id (the `external_id` you minted the
token for):

```tsx
<PoolseProvider
  config={{
    getToken,
    userResolver: async (externalId) => {
      const u = await fetch(`/api/users/${encodeURIComponent(externalId)}`).then((r) => r.json());
      return { displayName: u.full_name, avatarUrl: u.avatar_url };
    },
  }}
>
```

Results are cached and concurrent lookups are shared. See
<https://poolse.dev/docs/sdk/sdk#poolseusers>.

## Development

All work runs inside Docker; nothing in this project should be installed on
the host.

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
│   ├── sdk/            @poolse/sdk
│   ├── react/          @poolse/react
│   ├── react-ui/       @poolse/react-ui
│   ├── react-native/   @poolse/react-native
│   └── native/         @poolse/native
├── tsconfig.base.json      ← shared base for all packages
├── eslint.config.js        ← shared (flat config, ESLint 9)
├── .prettierrc.json
├── docker-compose.yml
└── Dockerfile.dev
```

## License

The packages are licensed under the [poolse SDK License](./LICENSE) from
3.0.0; versions before 3.0.0 remain MIT.
