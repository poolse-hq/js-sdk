# Integration guide

End-to-end walkthrough for integrating poolse into a production app. Pairs with [QUICKSTART.md](./QUICKSTART.md) (which is a 5-minute local sanity check) by going deeper on the parts you can't skip in production: auth, identity, storage, and the pitfalls that bite customers in the first week.

## Architecture

```
┌──────────────┐   API key     ┌──────────────┐   short-lived JWT   ┌──────────────┐
│ Your backend │ ────────────▶ │  poolse REST │ ◀────────────────── │ Your browser │
│              │ ◀──── user_id │              │                     │ (poolse SDK) │
│ /api/chat-   │               │              │  WebSocket + REST   │              │
│ token        │ ────────────────────────────────────────────────▶  │              │
└──────────────┘     JWT delivered to the browser via your own fetch └──────────────┘
```

**The poolse API key NEVER touches the browser.** Your backend exchanges it for short-lived End User JWTs (~1h TTL); the SDK uses those JWTs for REST + WebSocket. The SDK calls your `getToken` only when the cached JWT is missing or expired.

## 1. Backend — mint user JWTs

Your application backend owns the api key and brokers JWTs to the browser. On any authenticated request from a signed-in user, mint a JWT and return it:

```ts
// e.g. Next.js API route, Rails controller, anything — all your existing
// auth applies BEFORE this call. The API key proves YOUR identity to
// poolse; the JWT is for ONE specific End User.
async function POST(req: Request) {
  const session = await yourAuth(req); // returns { user_id: '...', ... }
  if (!session) return new Response('unauthorized', { status: 401 });

  // First time? Create the user in poolse. Idempotent on external_id.
  const userRes = await fetch('https://api.poolse.dev/v1/users', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.POOLSE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      external_id: session.user_id,
      display_name: session.display_name,
    }),
  });
  const { id: poolseUserId } = await userRes.json();

  // Mint a 1h JWT for that user.
  const tokenRes = await fetch(`https://api.poolse.dev/v1/users/${poolseUserId}/tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.POOLSE_API_KEY}` },
  });
  const { token } = await tokenRes.json();
  return Response.json({ token, user_id: poolseUserId });
}
```

## 2. Frontend — install + provider

```bash
npm install @poolse/sdk @poolse/react @poolse/react-ui
```

```tsx
import '@poolse/react-ui/styles.css';
import { PoolseProvider } from '@poolse/react';
import { ConversationView } from '@poolse/react-ui';

const config = {
  apiUrl: 'https://api.poolse.dev',
  getToken: async () => {
    const res = await fetch('/api/chat-token', { credentials: 'include' });
    const { token } = await res.json();
    return token;
  },
  // see step 3
  userResolver: async (poolseUserId) => {
    const u = await fetch(`/api/users/by-poolse-id/${poolseUserId}`).then((r) => r.json());
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

## 3. Identity — wire `userResolver`

poolse doesn't store user names or avatars. The SDK only knows a `user_id` (uuid). Your `userResolver` callback maps each `user_id` to the metadata stored in YOUR database:

```ts
{
  userResolver: async (poolseUserId) => {
    const u = await db.users.findOne({ poolse_user_id: poolseUserId });
    if (!u) return null; // SDK falls back to "User abc123" + initials avatar
    return {
      displayName: u.full_name,
      avatarUrl: u.avatar_url,
    };
  };
}
```

The SDK caches resolved profiles in-memory and dedupes concurrent lookups, so a 50-message render fires the resolver once per unique sender — not 50 times. `<MessageBubble>`, `<MemberList>`, `<TypingIndicator>`, `<MentionInput>`, and the avatar slot all pick this up automatically.

## 4. Attachments — bucket + CORS

Attachment uploads go directly from the browser to your storage bucket via presigned PUT URLs — the bytes never touch poolse's API server. Configure your bucket once:

### Cloudflare R2

```jsonc
// cors.json — apply via wrangler or the Cloudflare dashboard
{
  "AllowedOrigins": ["https://your-app.com", "http://localhost:3000"],
  "AllowedMethods": ["GET", "PUT", "HEAD"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3600,
}
```

```bash
wrangler r2 bucket cors put YOUR_BUCKET --file cors.json
```

**Custom domains caveat**: R2 custom domains serve public reads only — they DON'T accept signed PUTs (returns 401). Sign and PUT against the raw `<accountid>.r2.cloudflarestorage.com` host; expose downloads via the custom domain if you want.

### AWS S3

Standard S3 + CloudFront also works. Set bucket CORS to allow `PUT` from your origins and `GET` for the download URL.

## 5. Pitfalls

### React duplication in Next.js

**Don't** add `@poolse/*` to `transpilePackages` in `next.config.mjs`. The published packages already ship dual-format dists (ESM + CJS) with `'use client'` directives baked in by tsup. Walking into the source with `transpilePackages` causes Next to bind those modules to its own bundled React, which produces two React copies and a runtime error from `useContext`.

### Token refresh on 401

The SDK auto-invalidates its cached JWT on a 401 response and re-calls `getToken` once. If you return the same expired token twice, the SDK gives up and throws `AuthError`. Your `/api/chat-token` route must always return a fresh JWT — don't cache it on the server side.

### Markdown rendering safety

`@poolse/react-ui` renders message bodies as GFM via `react-markdown`. The default sanitization disables raw HTML, embedded scripts, javascript: URLs, and inline event handlers. Disable with `<ConversationView markdown={false}>` if you want raw-text rendering.

### CORS preflight cache

Browsers cache failed CORS preflights for a few minutes per origin. After fixing bucket CORS, hard-reload (or open an incognito window) before testing the upload again — otherwise the browser keeps replaying the failed preflight from cache.

## 6. Production checklist

- [ ] `POOLSE_API_KEY` lives in your backend env, never client-side
- [ ] `/api/chat-token` is authenticated by your existing user-session middleware
- [ ] `userResolver` returns `null` for unknown ids (SDK falls back gracefully)
- [ ] Bucket CORS allows your production origin AND any preview/staging origins
- [ ] Webhook (or polling) updates an attachment's `:pending` → `:ready` after the PUT completes
- [ ] `apiUrl` + `wsUrl` are HTTPS / WSS in prod (mixed-content blocks WebSocket otherwise)

## Reference implementation

The live showcase at <https://poolse.dev/chat> is the closest thing to a copy-pasteable production app — it's a Next.js 15 app deployed against the hosted poolse backend. Read it to see each piece of this guide wired up for real:

| File                             | What it demonstrates                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `app/api/chat-token/route.ts`    | Backend JWT-mint endpoint — creates the poolse user idempotently, then mints a token via the API key                  |
| `app/api/conversations/route.ts` | Creating a conversation as an admin "bot" so the bot retains `:manage_members` for invite-link joins                  |
| `app/chat/showcase-shell.tsx`    | Client provider wiring: `getToken`, `userResolver`, `apiUrl` override, sidebar + main pane + collapsible member panel |
| `app/chat/c/[id]/page.tsx`       | Invite-link landing — joins the visitor to the linked conversation before rendering chat                              |
| `lib/session.ts`                 | Per-browser session id stored in localStorage (stands in for "your auth system's user id")                            |
| `next.config.mjs`                | Minimal Next config — note the deliberate absence of `transpilePackages: ['@poolse/*']`                               |

## Reference

- Quickstart (local backend) — [QUICKSTART.md](./QUICKSTART.md)
- SDK API — [`@poolse/sdk`](./packages/sdk)
- React hooks — [`@poolse/react`](./packages/react)
- React UI — [`@poolse/react-ui`](./packages/react-ui)
- Showcase source — <https://github.com/poolse-hq/poolse-showcase>
- Docs site — <https://poolse.dev/docs>
