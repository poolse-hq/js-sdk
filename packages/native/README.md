# `@poolse/native`

The call engine for phones, for [poolse](https://poolse.dev). A native core
(Swift on iOS, Kotlin on Android) rings, answers and carries calls with the
app closed and the phone locked: CallKit and PushKit on iOS, a call service
and full-screen notifications on Android. You send commands; the core sends
back one `Snapshot` describing the call. The package also shows poolse's
chat notifications and gives you helpers for them.

Formerly `@poolse/react-native-calls`.

Full reference: <https://poolse.dev/docs/sdk/native>

## Requirements

- A development or release build. It is a native module, so it isn't in
  Expo Go; without the module every command does nothing and
  `nativeCallsAvailable` is `false`.
- Peers: `expo`, `expo-notifications`, `react`, `react-native`.
- Node 20.19 or newer for `expo prebuild`.
- iOS 15.1+; Android `minSdkVersion` 24.
- Push credentials (APNs key, FCM service account) for your workspace on the
  poolse dashboard.

## Install and setup

```bash
npx expo install @poolse/native expo-notifications
```

In `app.json`, after `expo-notifications`:

```json
"plugins": [
  "expo-notifications",
  ["@poolse/native", { "ringback": "./assets/sounds/ringback.mp3" }]
]
```

| Option             | Default | What it does                                                                                                                    |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ringback`         | none    | Ships this sound in both apps; pass its base name to `configure({ ringback })`. Lowercase letters, digits and underscores only. |
| `pictureInPicture` | `true`  | Android: the activity may float as a picture-in-picture window.                                                                 |
| `lockscreen`       | `true`  | Android: the app shows over the lock screen when opened for a call.                                                             |

Always applied on Android: the LiveKit media adapter, and `expo-notifications`
as the receiver for pushes that aren't calls. On iOS, add `UIBackgroundModes`
`audio`, `voip` and `remote-notification`, `NSMicrophoneUsageDescription`
(and `NSCameraUsageDescription` for video) and the `aps-environment`
entitlement yourself. Then run `npx expo prebuild --clean`.

## Usage

```ts
import * as calls from '@poolse/native';

await calls.configure('https://api.poolse.dev', {
  ringback: 'ringback',
  apnsEnvironment: 'production',
});

const stop = calls.onCallState((snapshot) => render(snapshot)); // Snapshot | null
render(calls.getCallState());

await calls.place(conversationId, { media: 'audio', sessionToken }); // sessionToken: the user's poolse JWT
calls.answer();
calls.decline();
calls.hangUp();
calls.setMuted(true);
calls.setCamera(true);

// Audio outputs: snapshot.audioOutputs lists the phone, the speaker and each
// connected headset or Bluetooth device; snapshot.audioOutputId is the one in use.
function onPickOutput(snapshot: calls.Snapshot, id: string) {
  if (snapshot.audioOutputs.some((o) => o.id === id)) calls.setAudioOutput(id);
}
calls.setSpeaker(true); // the one-tap speaker toggle
```

The full API:

- Setup: `configure`, `nativeCallsAvailable`, `getCallState`, `onCallState`.
- Calls: `place`, `join`, `answer`, `decline`, `hangUp`, `setMuted`,
  `setCamera`, `switchCamera`, `setSpeaker`, `setAudioOutput`,
  `ringIntoCall({ userIds?, externalIds? })`.
- Rooms (nobody rings): `startRoom(conversationId, { media, sessionToken })`,
  then `join` for the others and `hangUp` to leave.
- Call waiting: `snapshot.waiting`, `answerWaiting(callId)`,
  `declineWaiting(callId)`.
- Video: `<CallVideoView participantId | local mirror fit pictureInPicture />`,
  `setPictureInPictureEnabled`, `isInPictureInPicture`,
  `pictureInPictureSupported`, `onPictureInPicture`.
- Android: `canUseFullScreenIntent`, `openFullScreenIntentSettings`,
  `setShowOnLockscreen`, `takeCallAction`, `onCallAction`.
- iOS VoIP token: `getVoipToken`, `onVoipToken`. Register it with
  `poolse.devices.register({ token, platform: 'ios', kind: 'voip', environment })`
  from `@poolse/sdk`, and the regular APNs token with `kind: 'alert'`.
- Chat notifications: `setActiveConversation`, `shouldPresentMessage`,
  `conversationOfNotification`.
- Socket forwarding (optional): `onCallFinished`, `onRingEnded`. Feed them
  from `@poolse/sdk` 3.1's user channel:

  ```ts
  const userChannel = poolse.realtime.user(me.id);
  userChannel.onRingEnded((e) => calls.onRingEnded(e.call_id, e.reason));
  userChannel.onCallFinished((e) => calls.onCallFinished(e.call_id, e.reason));
  ```

## Links

- Docs: <https://poolse.dev/docs/sdk/native>
- Source: <https://github.com/poolse-hq/js-sdk>

## License

Licensed under the [poolse SDK License](./LICENSE) from 3.0.0; versions
before 3.0.0 remain MIT.
