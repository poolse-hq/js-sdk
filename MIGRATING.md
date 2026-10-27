# Migrating to 3.0

3.0 is the first stable poolse SDK. The five packages share a version number
and are released together; the current release is 3.1. Upgrade them
together:

```bash
npm install @poolse/sdk@3 @poolse/react@3 @poolse/react-ui@3 @poolse/react-native@3 @poolse/native@3
```

Install only the ones you use: web apps need `sdk` and `react` (plus
`react-ui` for the prebuilt UI); React Native apps add `react-native`, and
`native` for calls and notifications on phones.

Coming from 1.x? Read [MIGRATING-2.0.md](./MIGRATING-2.0.md) first.

The same guide is on the docs site:
<https://poolse.dev/docs/guides/migrating-to-3>

## 1. `@poolse/react-native-calls` is now `@poolse/native`

The package carries calls and chat notifications, so it was renamed. The API
and the native module are the same.

```diff
- import * as calls from '@poolse/react-native-calls';
+ import * as calls from '@poolse/native';
```

In `app.json`:

```diff
  "plugins": [
    "expo-notifications",
-   ["@poolse/react-native-calls", { "ringback": "./assets/sounds/ringback.mp3" }]
+   ["@poolse/native", { "ringback": "./assets/sounds/ringback.mp3" }]
  ]
```

Then run `npx expo prebuild --clean` (with Node 20.19 or newer).

If your app still has copies of the old per-app config plugins
(`withNativeCallMedia`, `withCallDelegate`, `withLockscreenCalls`,
`withPictureInPicture`, `withRingback`), delete them; the one `@poolse/native`
plugin does their work (see its README, "Install and setup").

## 2. The JavaScript calling path is gone

Removed during 2.x and absent from 3.x:

| Removed                                                                                                              | Use instead                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `poolse.realtime.calls`, `useCalls`, `useVoipCalls`, `<CallScreen>`                                                  | On phones, `@poolse/native`: `place`, `answer`, `onCallState`, …                                                                                                                                         |
| `poolse.realtime.voice`, `useVoiceRoom`, `<VoiceRoomBar>`                                                            | Rooms: `startRoom` from `@poolse/native` on phones; on the web, `useRoom` (`@poolse/react`) with `<RoomJoinBar>` / `<RoomStage>` (`@poolse/react-ui`), or `poolse.rooms` and `poolse.call` without React |
| `poolse.iceServers`, `GET /v1/ice-servers`                                                                           | Nothing. Media goes through the SFU.                                                                                                                                                                     |
| `<CallProvider>`, `useCallInvite` (react-ui)                                                                         | The web joins rooms rather than receiving rings. To ring members' phones from the web, use `poolse.rooms.ring` or `useRoom().join(media, { ring: true })`.                                               |
| `react-native-webrtc`, `react-native-callkeep`, `react-native-voip-push-notification`, `react-native-incall-manager` | Remove them from your app.                                                                                                                                                                               |

Web rooms need `livekit-client` in your app, passed in as `{ livekit }`.

## 3. New licence

From 3.0.0 the packages are under the **poolse SDK License** (see `LICENSE`
in each package, or <https://poolse.dev/legal/sdk-license>). Versions before
3.0.0 remain under MIT.

## 4. Changes in 3.1

- `@poolse/sdk`: `realtime.pause()` / `realtime.resume()` close and reopen
  the socket while keeping every channel and listener.
- `@poolse/react`: `useMessages` and `useConversations` reload from REST after
  the socket reconnects.
- `@poolse/react-native`: `useAppStateLifecycle` pauses the socket on
  `background` and resumes it on `active`, instead of destroying every
  channel. Call it inside `<PoolseProvider>`.
- `@poolse/native`: declares `react` as a peer dependency.
- `@poolse/sdk`: `UserChannel.onRingEnded` / `onCallFinished` (use these
  instead of the internal `_channel()` to forward `call:ring_ended` /
  `call:finished` to `@poolse/native`); `ConversationChannel.onClosed`, and a
  server-closed channel is dropped so `realtime.conversation(id)` joins
  afresh; after a refused socket handshake the SDK fetches a new token from
  `getToken` (at most every 30 s).
- `@poolse/react`: the reconnect reload no longer runs on the socket's first
  connect.
- `@poolse/react-native`: `AttachmentPicker` declares the size of the bytes it
  uploads (the server refuses a file bigger than declared).

## 5. Server features you can use

- Call webhooks: `call.started`, `call.answered`, `call.finished`.
- Call history: `GET /v1/calls` (your backend), `GET /v1/me/calls` (the
  signed-in user's), `GET /v1/conversations/:id/calls`.
- Per-workspace call limits on the dashboard's Calls page. A live call
  carries `video_allowed` and `max_participants`; hide your camera button when
  video isn't allowed.

## Older versions

Every version before 3.0.0 is deprecated on npm and gets no fixes.
