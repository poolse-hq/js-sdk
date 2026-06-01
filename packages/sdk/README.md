# `@poolse/sdk`

The headless TypeScript SDK for **[poolse](https://poolse.dev)** — realtime chat infrastructure.

REST + WebSocket + presence + typing + reactions + threads + attachments, all in one runtime-agnostic package. Works in browsers, Node, Deno, Bun, and React Native. No UI.

> Most React apps will want **[`@poolse/react`](https://www.npmjs.com/package/@poolse/react)** (hooks) or **[`@poolse/react-ui`](https://www.npmjs.com/package/@poolse/react-ui)** (prebuilt chat surface) instead. This package is the foundation underneath both.

## Install

```bash
npm install @poolse/sdk
```

## Quick start

```ts
import { Poolse } from '@poolse/sdk';

const chat = new Poolse({
  apiUrl: 'https://chat.example.com',
  // Your backend mints a JWT for the signed-in End User and returns it.
  // The SDK caches + refreshes via this callback — never embed an API key
  // in the browser.
  getToken: async () => {
    const res = await fetch('/api/chat-token', { method: 'POST' });
    const { token } = await res.json();
    return token;
  },
});

// REST
const me = await chat.me.show();
const { data: conversations } = await chat.conversations.list();

// Send + receive in real time
const conv = chat.conversations.one('<conversation-id>');
const sent = await conv.messages.send({ body: 'Hello' });

const off = chat.realtime
  .conversation('<conversation-id>')
  .onMessage((msg) => console.log('new message', msg));

// Later
off();
chat.destroy();
```

## What it covers

- **REST resources**: `me`, `conversations` (incl. members), `messages` (send / edit / delete / replies / reactions / mark-read / quote-replies), `attachments` (presigned upload + download + delete with upload progress), `users` (customer-supplied profile cache).
- **Realtime channels**: `message:new`, `message:updated`, `message:deleted`, `typing:start/stop`, `reaction:added/removed`, presence state + diff, per-user `mention:new` + `conversation:created`.
- **Token caching** — `getToken` is called once per JWT lifetime, not per request. Auto-invalidates on 401 and re-issues.
- **Idempotency** — every non-GET request carries an auto-generated `Idempotency-Key`, so retries (network or 5xx) never insert duplicates.
- **Backoff** — exponential with full jitter, honors `Retry-After` on 429, never retries `AbortError`.
- **Typed errors** — `AuthError` / `ApiError` / `NetworkError` / `RateLimitedError`, all `instanceof`-checkable.
- **Upload progress** — pass `onProgress` to `attachments.upload(...)` and the SDK switches to XHR for the PUT so byte-level progress events fire during the upload to your storage backend.
- **User resolution** — pass `userResolver(userId)` and `chat.users.get(userId)` returns customer-supplied `{ displayName, avatarUrl }` (in-memory cached + dedup'd). The React UI components pick this up automatically; vanilla callers can read it directly.

## Architecture pattern

```
┌──────────────┐   API key      ┌──────────────┐    JWT     ┌──────────────┐
│ Your backend │ ─────────────▶ │ poolse REST  │ ◀───────── │ Your browser │
│              │ ◀───  user_id  │              │            │  (uses SDK)  │
│  /api/chat-  │                │              │            │              │
│   token      │ ───────────────────────────────────────▶   │              │
└──────────────┘     JWT to browser via your own fetch       └──────────────┘
```

The poolse API key NEVER touches the browser. Your backend exchanges it for short-lived End User JWTs (`POST /v1/users/:id/tokens`); the SDK uses those JWTs for everything else.

## Documentation

- Full SDK + integration docs — <https://poolse.dev/docs>
- Source — <https://github.com/poolse-hq/js-sdk>
- Issues — <https://github.com/poolse-hq/js-sdk/issues>

## License

MIT
