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

| Option                       | Default | What it does                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ringback`                   | none    | Ships this sound in both apps; pass its base name to `configure({ ringback })`. Lowercase letters, digits and underscores only.                                                                                                                                                                               |
| `ringtone`                   | system  | The incoming-call ring: a file path, or `{ "ios": "…", "android": "…" }`. iOS: caf, aiff or wav, 30 s or shorter (CallKit rings with the system tone otherwise). Android: ogg, mp3 or wav. Lowercase letters, digits and underscores in the name, not the same name as `ringback`. See [Ringtone](#ringtone). |
| `incomingCall`               | none    | Android: the full-screen incoming call's `accentColor`, `backgroundColor` and `avatarUrl` template, or `activity` — your own Activity to launch instead. See [Incoming call screen (Android)](#incoming-call-screen-android).                                                                                 |
| `pictureInPicture`           | `true`  | Android: the activity may float as a picture-in-picture window.                                                                                                                                                                                                                                               |
| `lockscreen`                 | `true`  | Android: the app shows over the lock screen when opened for a call.                                                                                                                                                                                                                                           |
| `messageReplyRequiresUnlock` | `false` | Both: a chat notification's Reply asks for the passcode / Face ID / fingerprint before it sends. Off, Reply works straight from the lock screen (as in WhatsApp). Mark as read never asks.                                                                                                                    |
| `screenShare`                | `false` | iOS: adds the broadcast upload extension that sharing the screen needs, and the app group `group.<bundle id>` it shares with the app (`{ "appGroup": "…" }` for your own). Register that group in the Apple Developer portal and assign it to the app's and `<bundle id>.broadcast`'s App IDs.                |

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
- Several workspaces: `addServer`, `removeServer`, `listServers`,
  `serverOfNotification`, `DEFAULT_SERVER_ID`, `serverId` on `place` / `join`
  / `startRoom` and in snapshots, taps and action results (see below).
- Recording and transcripts: `snapshot.recording` / `snapshot.transcription`
  (the server's state as of joining), `snapshot.canPublish`,
  `onCanPublishChange`, `republish` (see below).
- Socket forwarding (optional): `onCallFinished`, `onRingEnded`. Feed them
  from `@poolse/sdk` 3.1's user channel:

  ```ts
  const userChannel = poolse.realtime.user(me.id);
  userChannel.onRingEnded((e) => calls.onRingEnded(e.call_id, e.reason));
  userChannel.onCallFinished((e) => calls.onCallFinished(e.call_id, e.reason));
  ```

## Recording, consent and transcripts

When the server records or transcribes a call (docs/RECORDING.md on the
server), the core:

- leaves poolse's own participants out of everything it reports — the
  transcript assistant (`poolse:assistant:…`, LiveKit kind agent) and the
  recorder (LiveKit Egress, `EG_…`). They are never in
  `snapshot.participants`, never get a video tile, never count as someone
  answering, and don't keep a call alive when everyone else has left.
  Phone (SIP) participants are listed as usual.
- carries the call's `recording` and `transcription` objects into the
  snapshot, as the server sent them on answer / join / place and each
  reconnect, so the indicator shows without another request. Later changes
  come on the conversation socket (`recording:*`, `transcript:*`): use those
  for anything after joining.
- follows the server's publish permission. With `consent: "required"`, the
  server turns publishing off until you accept: `snapshot.canPublish` turns
  `false`, nothing of yours goes out (you still hear and see the call), and
  mute / camera taps are remembered rather than refused. Once you accept,
  the server turns it back on and the core publishes the mic and camera as
  you last had them. Call `republish()` from ConsentPrompt's `onAccepted` as
  well; it is harmless before the permission is back.

```ts
<ConsentPrompt onAccepted={() => calls.republish()} … />

const off = calls.onCanPublishChange((allowed) => setListenOnly(!allowed));
```

## Ringtone

```json
["@poolse/native", { "ringtone": "./assets/sounds/ring.wav" }]
["@poolse/native", { "ringtone": { "ios": "./assets/sounds/ring.caf", "android": "./assets/sounds/ring.ogg" } }]
```

`expo prebuild` copies the file into the iOS app bundle and Android's
`res/raw`, and records its name (Info.plist `PoolseRingtone`, application
meta-data `dev.poolse.calls.ringtone`) so a ring that wakes a closed app uses
it before any JS runs. Convert an mp3 for iOS with
`afconvert -f caff -d LEI16 ring.mp3 ring.caf`.

To switch at runtime (a ringtone picker), ship each sound with the app (for
example as extra `res/raw` files and bundle resources) and pass its name:

```ts
await calls.configure(apiOrigin, { ringtone: 'ring_classic' }); // Android: res/raw name; iOS: 'ring_classic.caf' or the base name
```

Leaving `ringtone` out of `configure` falls back to the plugin's sound, and
without that to the system ringtone. A name the app doesn't contain also rings
with the system ringtone.

Android plays the sound itself, looping on the ringtone stream (so it follows
the ringer volume), and stops it the moment the ring resolves. The
`poolse_incoming_calls` notification channel has no sound of its own on
purpose: Android fixes a channel's sound once the channel exists, and a
channel sound would ring twice and could not be stopped. Changing the
ringtone therefore never needs a new channel id, and an existing install picks
up a new sound on its next ring. Silent and vibrate modes silence it like the
system ringtone.

## Incoming call screen (Android)

When a call rings on a locked or idle Android phone, the module shows its own
full-screen call screen. Give it your app's look:

```json
[
  "@poolse/native",
  {
    "incomingCall": {
      "accentColor": "#FF5A1F",
      "backgroundColor": "#101014",
      "avatarUrl": "https://cdn.example.com/avatars/{externalId}.jpg"
    }
  }
]
```

| Field             | Default   | What it does                                                                                                                                                                          |
| ----------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accentColor`     | `#5B54E8` | `#RRGGBB` or `#AARRGGBB`: the glow, the pulsing ring and the initials disc. Also tints the ring notification.                                                                         |
| `backgroundColor` | `#0B0B14` | The screen's ground. A light colour switches the text to dark.                                                                                                                        |
| `avatarUrl`       | none      | The caller's picture: `{externalId}` (your id for the caller) and `{userId}` (the poolse user id) are filled in, URL-encoded. A ring push's own `caller_avatar_url` takes precedence. |
| `activity`        | none      | Your own Activity to launch instead (below).                                                                                                                                          |

The picture is downloaded off the main thread (6 s timeout, 4 MB cap) and
covers the caller's initials once it has loaded; if there is no URL, or the
download fails, the initials stay. The URL must be reachable without
authentication. `configure({ incomingCall: { … } })` overrides any field at
runtime (for example a theme the user picked) and is persisted, so a ring that
wakes a closed app uses it too; a field left out keeps the plugin's value. iOS
ignores all of this: CallKit draws the call screen.

### Your own incoming-call Activity

Set `activity` to a fully qualified class name (or `.RingActivity`, relative
to the application id). Declare the Activity in your manifest (for example
with your own config plugin) with `android:showWhenLocked="true"`,
`android:turnScreenOn="true"`, `android:exported="false"` and
`android:launchMode="singleInstance"`. If the class isn't in the manifest the
built-in screen is used and a warning is logged.

The ring notification's full-screen intent and heads-up tap start it with
`FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_CLEAR_TOP` and these extras (constants
on `dev.poolse.callcore.android.PoolseIncomingCall`):

| Extra                     | Key                        | Type                   |
| ------------------------- | -------------------------- | ---------------------- |
| `EXTRA_CALL_ID`           | `poolse_call_id`           | String                 |
| `EXTRA_CONVERSATION_ID`   | `poolse_conversation_id`   | String                 |
| `EXTRA_CONVERSATION_NAME` | `poolse_conversation_name` | String, may be null    |
| `EXTRA_CALLER_NAME`       | `poolse_caller_name`       | String, may be null    |
| `EXTRA_CALLER_AVATAR_URL` | `poolse_caller_avatar_url` | String, may be null    |
| `EXTRA_MEDIA`             | `poolse_media`             | `"audio"` or `"video"` |
| `EXTRA_RING_DEADLINE`     | `poolse_ring_deadline`     | Long, epoch ms         |

plus an opaque `poolse_ring` bundle that the functions below read; pass them
the Intent you were started with (and the new one in `onNewIntent`):

- `PoolseIncomingCall.isLive(context, intent): Boolean`: whether the ring can
  still be answered. Finish at once when it can't (a stale tap).
- `PoolseIncomingCall.answer(activity, intent): Boolean`: answers and brings
  the app forward from your Activity (only a foreground Activity may). On
  `true`, finish in `onStop`, once the app covers you; finishing immediately
  dropped the launch on some devices. On `false`, finish.
- `PoolseIncomingCall.decline(context, intent)`: declines; then finish.
- `PoolseIncomingCall.ACTION_RING_CLOSED`: a package-local broadcast with
  `EXTRA_CALL_ID` when the ring ends anywhere else (caller hung up, answered
  on another device, timed out). Register for it with
  `ContextCompat.RECEIVER_NOT_EXPORTED` and finish, except after you
  answered: it is sent then too.

The ring tone, the notification and its Answer / Decline buttons stay the
module's. Answer on the notification still goes through the built-in
trampoline, which answers and opens the app without showing your Activity.
See the KDoc on `PoolseIncomingCall` for a complete example.

## Reply and Mark as read from a notification

poolse's chat pushes carry a reply grant (24 h, bound to the device and
conversation) and `actions: "reply,mark_read"`. The native core turns them
into a Reply button with a text field and a Mark as read button, and sends
them itself — from the lock screen, with the app closed, with no session
and no JS — to `POST /v1/notification-actions/reply` and `/read` on the API
origin you passed to `configure` (persisted, so call it once on every app
start as usual), or on the notification's own server with several (see
[Signed in to several workspaces](#signed-in-to-several-workspaces)).

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
expo-notifications also hands these responses to its own JS listeners: in
`addNotificationResponseReceivedListener`, ignore an `actionIdentifier` of
`reply` or `mark_read` (only the default tap should open the chat).

## Signed in to several workspaces

The core can serve several API servers at once — one per workspace the user
is signed in to. `configure(apiBaseUrl)` is still all a single-server app
needs: that server is `default` (`DEFAULT_SERVER_ID`), and everything below
is optional. Add the others (or all of them, with `configure(options)` for
the options alone):

```ts
await calls.configure({ ringback: 'ringback', apnsEnvironment: 'production' });
await calls.addServer({
  id: 'acme', // your id: 1–64 of A–Z a–z 0–9 . _ : -
  apiBaseUrl: 'https://chat.acme.example',
  tenantId: me.tenant_id, // the poolse tenant of this sign-in
  name: 'Acme',
});
// …and register the device's push tokens with each server's client
// (`devices.register`, VoIP + alert on iOS, FCM on Android).

await calls.place(conversationId, { media: 'audio', sessionToken, serverId: 'acme' });
await calls.join(callId, conversationId, sessionToken, 'acme');

// Signed out of one workspace (unregister its tokens there first):
await calls.removeServer('acme');
```

- **Routing.** A push's `tenant_id` picks its server — the one added with that
  `tenantId` (pass it as soon as there are two servers). Rings are answered and
  declined on their own server, with their own grant; place / join / rooms go
  where `serverId` says, and hang-up, reconnect and `ringIntoCall` follow the
  call. A push with no known tenant goes to the only server, else the only one
  without a `tenantId`, else `default`.
- **One call at a time.** A ring from another workspace during a call is call
  waiting, exactly like one from the same workspace: CallKit's End & Accept /
  Decline, Android's heads-up with End & answer / Decline. Each goes to the
  server the ring came from.
- **Names.** With two or more servers added, CallKit and the Android ring
  screen, call-waiting heads-up and notifications show the workspace: "Ana ·
  Acme" (the push's `workspace_name`, else the server's `name`).
  `snapshot.serverId` / `snapshot.workspaceName` and the same on
  `snapshot.waiting` tell the app which workspace a call is on. Custom
  incoming-call Activities get `EXTRA_SERVER_ID` (`poolse_server_id`) and
  `EXTRA_WORKSPACE_NAME` (`poolse_workspace_name`, set only with several
  servers).
- **Notifications.** Reply and Mark as read go to the notification's own
  server; `NotificationActionResult.serverId` says which. Android: a missed call
  or chat tap delivers `CallAction.serverId`; each server other than `default`
  gets its own notification group, summary and "Messages" channel inside a
  channel group named after the workspace (so it can be muted on its own); the
  workspace is the notification's subtext while several are signed in. iOS: the
  tap reaches your notification library — `serverOfNotification(data)` names
  the workspace to open. Pass `setActiveConversation(conversationId, serverId)`.
- **Upgrading** keeps everything: the server a single-server build configured
  becomes `default`, and its notifications, channel and stored chats are left
  as they are.

## Links

- Docs: <https://poolse.dev/docs/sdk/native>
- Source: <https://github.com/poolse-hq/js-sdk>

## License

Licensed under the [poolse SDK License](./LICENSE) from 3.0.0; versions
before 3.0.0 remain MIT.
