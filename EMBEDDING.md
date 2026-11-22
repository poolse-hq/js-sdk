# Embedding Workspace chat and calls in your own product (IN12)

Your product can show a member's Workspace channels, messages and calls
with the @poolse SDK — the same packages the Workspace apps are built on.
The member signs in to **your app** (a Workspace app with OAuth), your
server swaps that for a short-lived **poolse token**, and the SDK talks to
the customer's poolse server with it. Nothing goes through poolse's cloud:
every install is the customer's own.

```
your UI ──@poolse/react-ui──► poolse server (chat, calls, files)
   │                                ▲
   └── your server ──OAuth──► Workspace API ──auth.poolse_token──┘
```

## 1. Register an app

A Workspace admin registers your app from its manifest and installs it
(apps/workspace/INTEGRATIONS.md §2 in the server repo). Ask for the
`embed` scope (it allows `auth.poolse_token`) and whatever else you call
directly (`channels:read`, `messages:read`, …). A browser-only or desktop
app is `public: true` (PKCE, no client secret).

## 2. Sign the member in (OAuth 2.1 + PKCE)

1. Send the browser to
   `https://<workspace>/workspace/oauth/authorize?response_type=code&client_id=…&redirect_uri=…&scope=embed&state=…&code_challenge=…&code_challenge_method=S256`.
2. The member approves in the Workspace app; you get `?code=…&state=…`.
3. Your server: `POST https://<workspace>/workspace/oauth/token` with
   `grant_type=authorization_code&code&redirect_uri&client_id&code_verifier`
   (+ `client_secret`) → `{access_token: "wsat_…", refresh_token, expires_in}`.
   Keep both on your server.

## 3. Mint a poolse token for the SDK

Your server, with the member's `wsat_…` token:

```ts
// POST /workspace/api/auth.poolse_token → {token, expires_at, poolse_url, user_id}
app.post('/api/chat-token', async (req, res) => {
  const wsat = await tokensFor(req.user); // refresh with refresh_token when expired
  const r = await fetch(`${WORKSPACE}/workspace/api/auth.poolse_token`, {
    method: 'POST',
    headers: { authorization: `Bearer ${wsat}`, 'content-type': 'application/json' },
    body: '{}',
  });
  res.json(await r.json());
});
```

The token lasts about an hour; the SDK calls `getToken` again whenever it
needs a fresh one, so hand it a function that asks your server.

## 4. Render chat

```tsx
import '@poolse/react-ui/styles.css';
import { PoolseProvider } from '@poolse/react';
import { PoolseInbox, PoolseTheme } from '@poolse/react-ui';
import { themeFromBrand } from '@poolse/theme';

let poolseUrl = '';
async function getToken() {
  const t = await fetch('/api/chat-token', { method: 'POST' }).then((r) => r.json());
  poolseUrl = t.poolse_url;
  return t.token;
}
await getToken(); // learn the server address first

export function Chat({ brand }: { brand: { name: string; colors: { primary: string } } }) {
  return (
    <PoolseProvider config={{ apiUrl: poolseUrl, getToken }}>
      <PoolseTheme theme={themeFromBrand(brand.colors, { name: brand.name })}>
        <PoolseInbox />
      </PoolseTheme>
    </PoolseProvider>
  );
}
```

- **One conversation only**: `<ConversationView conversationId={…} />`
  (a channel's `conversation_id` comes from `channels.list`).
- **Names, not ids**: messages carry the sender's `external_id`; give the
  provider a `userResolver` that maps it to a display name and avatar
  (`people.list`), and never show the raw id.
- **Your brand**: `themeFromBrand` takes the Workspace's branding colours
  (`GET /workspace/v1/branding`) and keeps every text colour readable.
- **Workspace extras** in the composer: pass `commands`
  (`slashCommandsFromWorkspace` of `GET /workspace/v1/commands`), `groups`
  (`GET /workspace/v1/groups`) and a `<CustomEmojiProvider>`
  (`GET /workspace/v1/emoji`) — see [examples/chat-panel.tsx](./examples/chat-panel.tsx).
- **React Native**: the same with `@poolse/react-native`.

## 5. Calls

Calls need no extra sign-in: the same provider runs them.

- Web: `useRoom` (`@poolse/react`) with `<RoomJoinBar>` and `<RoomStage>` (`@poolse/react-ui`) join a conversation's
  room (a huddle or meeting) in the page.
- Phones: `@poolse/native` brings CallKit / the Android call service so
  calls ring when your app is closed. It needs your own push credentials
  on the poolse server (APNs key, FCM) and the native setup in its README.

## Security notes

- Keep `wsat_…` and refresh tokens on your server. The browser only ever
  sees the hour-long poolse token.
- The poolse token acts as the member with their rights: what they can't
  read in the Workspace they can't read in your product either.
- Revoking the app (or deactivating the member) stops new poolse tokens
  at once; a minted one stops working when it expires.
