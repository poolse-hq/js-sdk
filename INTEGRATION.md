# Integration guide

How to take a poolse integration to production: the token route on your
backend, the provider in your frontend, names and avatars, attachments,
connection handling and the common mistakes. The same guide, kept current, is
at <https://poolse.dev/docs/guides/integration>.

## How the pieces fit

```
┌──────────────┐   API key     ┌──────────────┐
│ Your backend │ ────────────▶ │  poolse API  │
│ /api/chat-   │ ◀──────────── │              │
│ token        │   user + JWT  │              │
└──────┬───────┘               └──────▲───────┘
       │ JWT (your own request)       │ REST + WebSocket with the JWT
       ▼                              │
┌──────────────────────────────────────┴──┐
│ Your frontend (poolse SDK)              │
└─────────────────────────────────────────┘
```

- Your backend holds the API key; it never reaches the browser or the phone.
- Your backend mints end-user JWTs, valid for one hour, for signed-in users.
- The SDK uses the JWT for REST and the WebSocket and asks your `getToken`
  for a new one shortly before it expires.

## 1. Backend: the token route

```ts
// e.g. app/api/chat-token/route.ts (Next.js); the same two calls work in any backend
const API = 'https://api.poolse.dev';
const KEY = process.env.POOLSE_API_KEY!;

export async function POST(req: Request) {
  const session = await yourAuth(req);
  if (!session) return new Response('unauthorized', { status: 401 });

  const userRes = await fetch(`${API}/v1/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ external_id: session.userId }),
  });
  if (!userRes.ok) return new Response('upsert failed', { status: 502 });
  const user = await userRes.json();

  const tokenRes = await fetch(`${API}/v1/users/${user.id}/tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!tokenRes.ok) return new Response('mint failed', { status: 502 });
  const { token } = await tokenRes.json();

  return Response.json({ token });
}
```

- Minting needs the `users:manage` scope on the key (selected by default for
  new dashboard keys); without it the mint answers `403 forbidden`.
- `POST /v1/users` is an upsert keyed on `external_id`. Only the fields you
  send are written (`display_name`, `avatar_url`, `custom_data`,
  `is_blocked`); fields you leave out keep their values.
- Mint a new token on every request; don't cache tokens on the server.
- Users you add with `member_external_ids` or `external_ids` are created
  automatically, up to 50 new users per caller per hour
  (`429 lazy_provision_rate_limited` past that).

## 2. Frontend: install and provider

Web:

```bash
npm install @poolse/sdk @poolse/react @poolse/react-ui
```

React Native (Expo):

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

Every React Native peer is required; a missing one breaks the bundle. See
[`packages/react-native/README.md`](./packages/react-native#install).

```tsx
'use client';

import '@poolse/react-ui/styles.css';
import { PoolseProvider, type PoolseConfig } from '@poolse/react';
import { ConversationView } from '@poolse/react-ui';

const config: PoolseConfig = {
  getToken: async () => {
    const res = await fetch('/api/chat-token', { method: 'POST', credentials: 'include' });
    if (!res.ok) throw new Error(`chat-token failed: ${res.status}`);
    const { token } = await res.json();
    return token;
  },
  userResolver: async (externalId) => {
    const res = await fetch(`/api/users/${encodeURIComponent(externalId)}`);
    if (!res.ok) return null;
    const u = await res.json();
    return { displayName: u.display_name, avatarUrl: u.avatar_url };
  },
};

export default function Chat({ conversationId }: { conversationId: string }) {
  return (
    <PoolseProvider config={config}>
      <ConversationView conversationId={conversationId} />
    </PoolseProvider>
  );
}
```

- `getToken` must use the method your route accepts (`POST` here).
- Remount the provider with a new `key` when the signed-in user changes.

## 3. Identity: `userResolver`

poolse doesn't store names or avatars for the UI. Every user the SDK shows
(`message.sender_external_id`, `member.external_id`, the typing and presence
sets) is identified by the `external_id` you gave poolse, and `userResolver`
maps it to your data:

```ts
userResolver: async (externalId) => {
  const u = await db.users.findById(externalId);
  if (!u) return null;
  return { displayName: u.fullName, avatarUrl: u.avatarUrl ?? null };
};
```

You don't need to store any poolse id. Results are cached in memory and
concurrent lookups for one id share a call. When the resolver returns `null`
or throws, the UI shows the external id and an initials avatar.

## 4. Attachments

Files go from the client straight to poolse's storage through a presigned
URL. There is no bucket or CORS for you to configure. `ConversationView`'s
composer handles uploads; for your own UI, use `poolse.attachments.upload` or
`useAttachmentUpload`, declare the file's real size, then send the
attachment ids with the message. Details:
<https://poolse.dev/docs/guides/attachment-uploads>.

## 5. Connection handling

- **Web:** the socket reconnects after a network drop. Events sent while it
  was down aren't replayed; from 3.1 `useMessages`, `useConversations` and
  `useLiveCall` reload from REST after a reconnect.
- **React Native:** call `useAppStateLifecycle()` once inside the provider.
  It pauses the socket in the background and resumes it on return. New
  messages and calls reach a backgrounded app as push notifications from
  poolse, which needs `@poolse/native`, push credentials on the dashboard and
  registered devices (`poolse.devices.register`).

## 6. Pitfalls

### Next.js: don't transpile the packages

Don't add `@poolse/*` to `transpilePackages`. The packages are already
compiled, and `@poolse/react` and `@poolse/react-ui` start with
`'use client'`.

### A second 401 ends the session

On a 401 the SDK asks `getToken` once for a new token and retries. If that
also fails it throws `AuthError` (for example `token_revoked`, or
`user_blocked` for a blocked user). A route that returns a cached or expired
token ends up here.

### Markdown in messages

`@poolse/react-ui` renders bodies as GitHub-flavoured Markdown with
`react-markdown`. Raw HTML isn't rendered; links open in a new tab with
`rel="noopener noreferrer nofollow"`. Pass `markdown={false}` for plain text.

### Idempotency keys are per caller

The SDK sends an `Idempotency-Key` on every write and reuses it on retries.
The server keeps successful responses for 24 hours per workspace, caller,
method, path and key; error responses aren't kept.

## 7. Production checklist

- [ ] `POOLSE_API_KEY` is only in your backend's environment, with only the scopes it needs.
- [ ] `/api/chat-token` requires your user session.
- [ ] `getToken` and the route use the same HTTP method.
- [ ] `userResolver` returns `null` for unknown ids.
- [ ] The provider is remounted when the user changes.
- [ ] React Native: `useAppStateLifecycle()` is called inside the provider.
- [ ] Phones: push credentials are on the dashboard; devices are registered, and unregistered on sign-out.
- [ ] Webhook receivers verify the signature.

## Reference

- Docs: <https://poolse.dev/docs>
- `@poolse/sdk`: [packages/sdk](./packages/sdk)
- `@poolse/react`: [packages/react](./packages/react)
- `@poolse/react-ui`: [packages/react-ui](./packages/react-ui)
- `@poolse/react-native`: [packages/react-native](./packages/react-native)
- `@poolse/native`: [packages/native](./packages/native)
