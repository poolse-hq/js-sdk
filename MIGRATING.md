# Migrating to 3.0

3.0 is the first stable poolse SDK. All five packages ship together at
`3.0.0` — upgrade them together:

```bash
npm install @poolse/sdk@3 @poolse/react@3 @poolse/react-ui@3 @poolse/react-native@3 @poolse/native@3
```

Install only the ones you use: web apps need `sdk`, `react` and (for the
prebuilt UI) `react-ui`; React Native apps add `react-native` and, for
calls and notifications, `native`.

Coming from 1.x? Read [MIGRATING-2.0.md](./MIGRATING-2.0.md) first.

## What changed

### 1. `@poolse/react-native-calls` is now `@poolse/native`

The native package carries calls **and** notifications, so it has a
name that says so. Same code, same API, same native module.

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

Then `npx expo prebuild --clean`. Nothing else in your native projects
changes.

If you still list the old per-app config plugins (`withNativeCallMedia`,
`withCallDelegate`, `withLockscreenCalls`, `withPictureInPicture`,
`withRingback`), delete them: the one `@poolse/native` plugin replaces
them (see its README, "Setup").

### 2. The legacy JS calling path is gone

Removed during 2.x and absent from 3.0:

| Removed | Use instead |
| --- | --- |
| `poolse.realtime.calls`, `useCalls`, `useVoipCalls`, `<CallScreen>` | `@poolse/native`: `place`, `answer`, `onCallState`, … |
| `poolse.realtime.voice`, `useVoiceRoom`, `<VoiceRoomBar>` | rooms: `startRoom` on phones, `poolse.rooms` / `<CallRoom>` on the web |
| `poolse.iceServers`, `GET /v1/ice-servers` | nothing — the relay comes with LiveKit's join |
| `<CallProvider>` / `useCallInvite` (react-ui) | web never rings; place calls with the SDK option |
| `react-native-webrtc`, `react-native-callkeep`, `react-native-voip-push-notification`, `react-native-incall-manager` | remove them from your app |

### 3. New licence

From 3.0.0 the packages are under the **poolse SDK License**
(see `LICENSE` in each package): free to use, including commercially,
in apps built on poolse; not for use with other backends or to build a
competing service. Versions before 3.0.0 stay under MIT.

### 4. New server features you can use

No code change needed, but worth knowing:

- Call webhooks: `call.started`, `call.answered`, `call.finished`.
- Call history: `GET /v1/calls` (your backend), `GET /v1/me/calls` (a
  user's own), `GET /v1/conversations/:id/calls`.
- Per-workspace call limits (people per call, video, ring time) on the
  dashboard's Calls page. A call's summary carries `video_allowed` and
  `max_participants` — hide your camera button when video is off.

## Older versions

Every version before 3.0.0 is deprecated on npm and gets no fixes.
