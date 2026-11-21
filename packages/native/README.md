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

| Option             | Default | What it does                                                                                                                                                                                                                                                                                   |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ringback`         | none    | Ships this sound in both apps; pass its base name to `configure({ ringback })`. Lowercase letters, digits and underscores only.                                                                                                                                                                |
| `pictureInPicture` | `true`  | Android: the activity may float as a picture-in-picture window.                                                                                                                                                                                                                                |
| `lockscreen`       | `true`  | Android: the app shows over the lock screen when opened for a call.                                                                                                                                                                                                                            |
| `messageReplyRequiresUnlock` | `false` | Both: a chat notification's Reply asks for the passcode / Face ID / fingerprint before it sends. Off, Reply works straight from the lock screen (as in WhatsApp). Mark as read never asks. |
| `screenShare`      | `false` | iOS: adds the broadcast upload extension that sharing the screen needs, and the app group `group.<bundle id>` it shares with the app (`{ "appGroup": "…" }` for your own). Register that group in the Apple Developer portal and assign it to the app's and `<bundle id>.broadcast`'s App IDs. |

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
- Screen sharing: `screenShareSupported`, `startScreenShare`, `stopScreenShare`,
  `snapshot.screenSharing` (yours) and `participants[].screenSharing`; draw a
  shared screen with `<CallVideoView participantId source="screen" fit="contain" />`.
  iOS needs the `screenShare` plugin option.
- Video: `<CallVideoView participantId | local mirror fit pictureInPicture />`,
  `setPictureInPictureEnabled`, `isInPictureInPicture`,
  `pictureInPictureSupported`, `onPictureInPicture`.
- Android: `canUseFullScreenIntent`, `openFullScreenIntentSettings`,
  `setShowOnLockscreen`, `takeCallAction`, `onCallAction`.
- iOS VoIP token: `getVoipToken`, `onVoipToken`. Register it with
  `poolse.devices.register({ token, platform: 'ios', kind: 'voip', environment })`
  from `@poolse/sdk`, and the regular APNs token with `kind: 'alert'`.
- Chat notifications: `setActiveConversation`, `shouldPresentMessage`,
  `conversationOfNotification`, `onNotificationAction`,
  `onNotificationReply`, `takeNotificationActions` (see below).
- Socket forwarding (optional): `onCallFinished`, `onRingEnded`. Feed them
  from `@poolse/sdk` 3.1's user channel:

  ```ts
  const userChannel = poolse.realtime.user(me.id);
  userChannel.onRingEnded((e) => calls.onRingEnded(e.call_id, e.reason));
  userChannel.onCallFinished((e) => calls.onCallFinished(e.call_id, e.reason));
  ```

## Reply and Mark as read from a notification

poolse's chat pushes carry a reply grant (24 h, bound to the device and
conversation) and `actions: "reply,mark_read"`. The native core turns them
into a Reply button with a text field and a Mark as read button, and sends
them itself — from the lock screen, with the app closed, with no session
and no JS — to `POST /v1/notification-actions/reply` and `/read` on the API
origin you passed to `configure` (persisted, so call it once on every app
start as usual).

- **iOS**: the core registers the `poolse_message` category (actions `reply`
  and `mark_read`) beside the app's own categories at launch, and handles the
  taps through expo-notifications' delegate. A tap launches the app in the
  background; a background task keeps it alive for the request, retried
  (same reply id) on a network error, 5xx or 429 while iOS allows. On
  success the conversation's notifications go and the badge drops by them
  (the server's read-sync push then sets the exact count). A failed reply
  posts a "Couldn't send your reply" notification in the same thread, with
  Reply on it to try again. No Notification Service Extension is needed:
  the grant rides in the delivered notification itself.
- **Android**: one MessagingStyle notification per conversation. Reply shows
  your line at once ("Sending…"), then WorkManager sends it — waiting for a
  network, surviving the process being killed, retrying with the same id —
  and the line stays (sent) or turns "Not sent: …" with the reason and an
  alert. Mark as read cancels the notification at once. Launcher badges follow
  the notifications' counts.

Your app learns what happened:

```ts
import * as calls from '@poolse/native';

useEffect(() => {
  // Finished while the app was closed: oldest first, each once.
  for (const r of calls.takeNotificationActions()) apply(r);
  return calls.onNotificationAction(apply);
}, []);

function apply(r: calls.NotificationActionResult) {
  if (r.action === 'reply' && r.ok) refreshConversation(r.conversationId); // r.messageId
  if (r.action === 'mark_read' && r.ok) markReadLocally(r.conversationId);
  // !r.ok: r.error is the server code (device_signed_out, forbidden,
  // rate_limited, …) or network / no_grant / not_configured.
}
```

`onNotificationReply(cb)` is the same, replies only. Results that finish
with no `onNotificationAction` listener are queued (the last 50) for
`takeNotificationActions`.

Requirements: `configure` has run at least once on the device; the regular
APNs token is registered with `kind: 'alert'` (iOS) and the FCM token
(Android); `remote-notification` in `UIBackgroundModes` for the iOS
read-sync push. If your app calls expo-notifications'
`setNotificationCategoryAsync`, that keeps `poolse_message`; don't replace
the whole category set natively without it.

## Links

- Docs: <https://poolse.dev/docs/sdk/native>
- Source: <https://github.com/poolse-hq/js-sdk>

## License

Licensed under the [poolse SDK License](./LICENSE) from 3.0.0; versions
before 3.0.0 remain MIT.
