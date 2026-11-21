# @poolse/native

Formerly `@poolse/react-native-calls` (0.x).

## 3.6.2 — 2026-11-21

- Android: `takeNotificationActions` compiles (3.6.1's
  `PoolseCallsModule.kt` failed with "Not enough information to infer type
  argument"). Releases now compile the Android code before publishing.

## 3.6.1 — 2026-11-21

- No changes; released with the other `@poolse/*` packages at 3.6.1.

## 3.6.0 — 2026-11-21

- No changes; released with the other `@poolse/*` packages at 3.6.0.

## 3.5.0 — 2026-11-21

- Reply and Mark as read from a chat notification now use
  `POST /v1/notification-actions/{reply,read}` (grant as bearer and `token`,
  reply text as `text`) instead of the first `/v1/notifications/*` paths.
- iOS: a reply is retried with the same id on a network error, 5xx or 429
  while iOS keeps the app alive; success clears the conversation's
  notifications and lowers the badge; a failed reply posts a "Couldn't send
  your reply" notification with Reply on it. The background task now starts
  before expo-notifications completes the response.
- Android: Reply shows your line at once ("Sending…") and is sent by
  WorkManager (new dependency `androidx.work:work-runtime-ktx`), which waits
  for a network, survives the process being killed and retries with the
  same id; a failed reply reads "Not sent: …" with the reason and alerts.
  The read-sync push still clears the conversation.
- New `onNotificationAction(cb)`, `onNotificationReply(cb)` and
  `takeNotificationActions()` with `NotificationActionResult`: what a Reply
  or Mark as read from a notification did, live or queued while the app
  was closed.
- Config plugin: `messageReplyRequiresUnlock` (default `false`) makes Reply
  ask for the passcode / biometrics first on both platforms.

## 3.4.0 — 2026-11-21

- No changes; released with the other `@poolse/*` packages at 3.4.0.

## 3.3.0 — 2026-11-20

- No changes; released with the other `@poolse/*` packages at 3.3.0.

## 3.2.0 — 2026-11-17

- Stable release of everything in the 3.2.0 prereleases below (streaming agent replies, screen sharing, full screen, the redesigned call screen, screen sharing from iOS).
- Screen sharing's config plugin now gives the `PoolseBroadcast` Podfile
  target the app's `use_frameworks!` setting, so apps with
  `ios.useFrameworks` (e.g. `"static"`) pass `pod install`.

## 3.2.0-dev.5 — 2026-11-17 (prerelease, npm tag `dev`)

- Screen sharing from iOS. Add `"screenShare": true` to the config plugin's
  options: it adds a Broadcast Upload Extension (`PoolseBroadcast`, bundle id
  `<app>.broadcast`), the app group `group.<app>` on the app and the
  extension (`{ "screenShare": { "appGroup": "…" } }` for your own) and
  LiveKit to the extension's Podfile target. Then `screenShareSupported()` is
  true, `startScreenShare()` shows the system's broadcast sheet, and the
  snapshot's `screenSharing` turns true once the user taps Start Broadcast.
  Stopping from the app, from the status bar or by ending the call all end
  the broadcast.
- Signing: register the app group in the Apple Developer portal and assign it
  to both App IDs; automatic signing then provisions the extension.

## 3.2.0-dev.4 — 2026-11-16 (prerelease, npm tag `dev`)

- No changes; released with the other packages.

## 3.2.0-dev.3 — 2026-11-16 (prerelease, npm tag `dev`)

- No changes; released with the other packages.

## 3.2.0-dev.2 — 2026-11-16 (prerelease, npm tag `dev`)

- Screen sharing. Android: `startScreenShare()` (the system asks first; resolves
  whether the user allowed it), `stopScreenShare()` and `screenShareSupported()`;
  the snapshot's `screenSharing` follows the published screen. Both platforms:
  each participant's `screenSharing`, and `<CallVideoView source="screen">` draws
  their shared screen (never mirrored). Sharing from iOS comes in a later release.

## 3.2.0-dev.1 — 2026-11-04 (prerelease, npm tag `dev`)

- Moves with `@poolse/sdk` 3.2.0-dev.1.

## 3.2.0-dev.0 — 2026-11-04 (prerelease, npm tag `dev`)

- Moves with `@poolse/sdk` 3.2.0-dev.0.

## 3.1.0 — 2026-10-27

- Declares `react` as a peer dependency (the package imports it).
- `expo prebuild` needs Node 20.19 or newer (the config plugin entry is
  an ES module, loaded with `require`).

## 3.0.0 — 2026-10-26

- **Renamed** from `@poolse/react-native-calls`: import from
  `@poolse/native` and list `"@poolse/native"` in `app.json` plugins.
  Same API and native module.
- **License.** From 3.0.0 under the poolse SDK License (see `LICENSE`);
  earlier versions remain MIT.
- First stable release, together with the other `@poolse/*` packages.

## 0.13.0

- **One config plugin.** `["@poolse/react-native-calls", { ringback }]` in
  `app.json` replaces the five per-app plugins (`withNativeCallMedia`,
  `withCallDelegate`, `withLockscreenCalls`, `withPictureInPicture`,
  `withRingback`). Options: `ringback`, `pictureInPicture`, `lockscreen`.
  See "Setup" in the README for the move.

## 0.12.0

- `setShowOnLockscreen(enabled)`: keeps the Android activity over the lock
  screen while a call rings or runs (iOS: no-op, CallKit owns it).
