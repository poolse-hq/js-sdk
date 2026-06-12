# Testing the full poolse flow end-to-end

This doc walks through a single live test: backend running, JWT minted, browser-side React app exchanging messages over WebSocket.

## 1. Start the backend

In the `poolse` repo:

```bash
docker compose up -d postgres redis
docker compose run --rm dev mix ecto.setup    # creates DB + runs seeds (prints a demo API key)
docker compose run --rm --service-ports dev iex -S mix phx.server
```

The seed script prints a `pk_live_…` API key — **copy it**, you'll need it server-side to mint user JWTs.

The API serves on `http://localhost:4000`; the WebSocket gateway on `ws://localhost:4001/socket`.

## 2. Mint a JWT for a test End User

In another terminal:

```bash
PK="pk_live_…paste from seeds output…"

# Create a user (idempotent on external_id within tenant)
USER_ID=$(curl -s -X POST -H "Authorization: Bearer $PK" \
     -H "Content-Type: application/json" \
     -d '{"external_id":"test-user-1","display_name":"Test"}' \
     http://localhost:4000/v1/users | jq -r .id)

# Mint a 1h JWT for that user
JWT=$(curl -s -X POST -H "Authorization: Bearer $PK" \
      http://localhost:4000/v1/users/$USER_ID/tokens | jq -r .token)

echo "JWT: $JWT"
```

## 3. Create a conversation (as the End User)

```bash
CONV_ID=$(curl -s -X POST -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{"type":"group","name":"test"}' \
     http://localhost:4000/v1/conversations | jq -r .id)

echo "Conversation: $CONV_ID"
```

## 4. Drop into a React app

Anywhere outside this repo:

```bash
mkdir test-poolse && cd test-poolse
pnpm create vite@latest . --template react-ts
pnpm install
pnpm install @poolse/sdk @poolse/react @poolse/react-ui

# OR if you want to link against the local SDK monorepo before publishing:
pnpm install /Users/jasir/Documents/Work/poolse-js-sdk/packages/sdk \
             /Users/jasir/Documents/Work/poolse-js-sdk/packages/react \
             /Users/jasir/Documents/Work/poolse-js-sdk/packages/react-ui
```

Replace `src/App.tsx`:

```tsx
import '@poolse/react-ui/styles.css';
import { PoolseProvider } from '@poolse/react';
import { ConversationView } from '@poolse/react-ui';

// Paste the JWT + conversation id from the curl steps above.
const JWT = 'eyJhbGciOiJIUzI1NiI…';
const CONV_ID = 'paste-conv-uuid-here';

const config = {
  apiUrl: 'http://localhost:4000',
  // Realtime defaults to apiUrl with http→ws. Override if the WS
  // gateway runs on a different port (caas_realtime listens on :4001):
  wsUrl: 'ws://localhost:4001',
  getToken: () => JWT,
};

export default function App() {
  return (
    <div style={{ height: '100vh', maxWidth: 600, margin: '0 auto' }}>
      <PoolseProvider config={config}>
        <ConversationView conversationId={CONV_ID} />
      </PoolseProvider>
    </div>
  );
}
```

```bash
pnpm dev
```

Open http://localhost:5173. You should see the conversation UI; type and send. To verify real-time:

> **React Native instead of web?** Skip the Vite step and follow
> [`packages/react-native/README.md`](./packages/react-native#install)
> for the install (a single `npx expo install` line with **all**
> peer deps — none are optional). The same JWT + conversation id
> from the curl steps above drop straight in.

- Open a second browser tab to the same URL — both tabs should receive each other's messages instantly.
- Or send via curl: `curl -X POST -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"body":"from curl"}' http://localhost:4000/v1/conversations/$CONV_ID/messages` and watch the message appear in the browser within ~50ms.

## What gets exercised

| Path                                  | Layer                                            | Test                     |
| ------------------------------------- | ------------------------------------------------ | ------------------------ |
| `GET /v1/me`                          | REST via `@poolse/sdk`                           | useMe                    |
| `GET /v1/conversations/:id/messages`  | REST via `@poolse/sdk`                           | useMessages initial load |
| `POST /v1/conversations/:id/messages` | REST via `@poolse/sdk`                           | composer send            |
| `wss://…/socket conversation:<id>`    | WebSocket via `phoenix` + `@poolse/sdk` realtime | live message:new pushes  |
| `typing` push                         | WebSocket                                        | typing indicator         |

If any of those fail, the SDK package's tests + the backend's `mix check` cover the unit-level surface; the end-to-end is the integration of the two.
