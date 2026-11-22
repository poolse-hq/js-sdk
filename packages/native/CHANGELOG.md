# @poolse/native

Formerly `@poolse/react-native-calls` (0.x).

## [Unreleased]

### Added

- Agents in calls (AGENTS_IN_CALLS.md): `participants` lists agents in the
  call with `isAgent`, `agentLabel` and `agentMode` (token metadata `agent:
true`); they never keep a call alive (the alone check skips them) and an
  agent joining is not someone answering.
- Escalations from the lock screen: Android posts the `agent_escalation`
  data push natively with Approve / Decline / Answer (RemoteInput); iOS
  registers the `poolse_agent_escalation` category (Approve, Decline and a
  `UNTextInputNotificationAction` Answer). Both reply natively — `POST
/v1/agent-escalations/:id/reply` with the push's `reply_token`, no
  session, no JS — and report through `onNotificationAction` with `action:
"escalation"` (`escalationId`, `decision`, `ok`, `error`); new
  `onEscalationAction`. `messageReplyRequiresUnlock` covers these actions
  too.

- Meeting rings (CA4): a ring push with `ring_type: "meeting"` and
  `meeting_title` shows "Weekly sync is starting" on CallKit and on the
  Android ring notification and screen, with Join / Not now buttons on
  Android. `RingContext` gains `ringType`, `meetingTitle` and `meetingId`
  (defaulted). Snapshots and `waiting` carry `ringType` and `meetingTitle`.
  Custom Android ring activities get `EXTRA_RING_TYPE`, `EXTRA_MEETING_TITLE`
  and `EXTRA_TITLE`.
- Meeting notices (MEETINGS.md §11.3). Android posts `type: "meeting"` data
  pushes (`starting` with Join, `brief`) on a new "Meetings" channel. iOS
  registers the `poolse_meeting` category with a Join action. A tap and Join
  reach JS as a `CallAction` of type `open` / `join_meeting`, with the new
  `scheduledMeetingId`. `takeCallAction` and `onCallAction` now work on iOS
  too, for meeting notices.
- Noise suppression and background blur (CL7): `setNoiseSuppression`,
  `noiseSuppressionSupported`, `setBackgroundBlur` and
  `backgroundBlurSupported`. Snapshots carry `noiseSuppression` and
  `backgroundBlur`. Blur works on iOS 15+ (LiveKit's
  BackgroundBlurVideoProcessor). It is not available on Android yet.
- Move a call to this device (CL11): `moveCallHere(callId, options)`. The
  device that lost the call gets `movedElsewhere: true` and ends with the new
  reason `'moved'`, detected from LiveKit's duplicate-identity disconnect.

## 3.9.0 — 2026-11-22

- Recording and transcripts (server docs/RECORDING.md). poolse's transcript
  assistant (`poolse:…`, LiveKit kind agent) and LiveKit Egress's recorder
  (`EG_…`, kind egress) are no longer reported as people: they are left out of
  `participants`, video tiles, "someone answered" and the count that ends a
  call left alone (SIP participants stay).
- Snapshots carry `canPublish`, `recording` and `transcription` (the
  CallSummary's objects from answer / join / place / reconnect; `null` from a
  server without them). New types `CallRecordingState`, `CallTranscriptionState`.
- Recording consent: when the server revokes publishing, the core stops
  publishing without errors and keeps the mic / camera choices; when it comes
  back it republishes them. `republish()` (for ConsentPrompt's `onAccepted`)
  and `onCanPublishChange(cb)`.

## 3.8.0 — 2026-11-21

- Several workspaces (servers) at once:
  `addServer({ id, apiBaseUrl, tenantId?, name? })`, `removeServer(id)`,
  `listServers()`, `serverOfNotification(data)` and `DEFAULT_SERVER_ID`; `configure(apiBaseUrl, options)` is unchanged and
  sets the `default` server, `configure(options)` sets the options alone.
  Persisted, so a ring or a notification action with the app closed finds its
  server; a single-server install migrates to `default` on upgrade.
- Calls: a push's `tenant_id` picks its server; answer, decline, busy-decline,
  hang-up and reconnect go to the server the call came from. `place` /
  `startRoom` take `serverId`, `join` a 4th `serverId` argument;
  `ringIntoCall` uses the call's own server. A ring from another workspace
  during a call is call waiting (CallKit End & Accept, Android End & answer).
  Snapshots and `waiting` carry `serverId` and `workspaceName`.
- With two or more servers, CallKit, the Android ring screen and the
  call-waiting heads-up read "Ana · Acme" (`workspace_name` from the push, else
  the server's `name`). Custom ring Activities get `EXTRA_SERVER_ID` and
  `EXTRA_WORKSPACE_NAME`.
- Notifications: Reply / Mark as read are sent to the notification's server and
  report `serverId`; Android taps carry `CallAction.serverId`. Android groups
  chats per workspace (own group, summary, and a "Messages" channel in a
  channel group named after it) and shows the workspace as subtext; iOS clears
  per workspace (thread ids may be `<tenant_id>:<conversation_id>`) and a
  failed-reply notice keeps the workspace. `setActiveConversation` takes an
  optional `serverId`; `removeServer` takes the workspace's notifications down.
- Fix (Android): Mark as read from a notification lost its grant when the
  notification was cleared first, and failed with `no_grant`.

## 3.7.1 — 2026-11-21

- No changes; released with the other `@poolse/*` packages at 3.7.1.

## 3.7.0 — 2026-11-21

- Custom incoming ringtone. Plugin option `ringtone` (a file path, or
  `{ ios, android }`) ships the sound in both apps; `configure({ ringtone })`
  overrides it at runtime and is persisted for closed-app rings. iOS: CallKit's
  `ringtoneSound` (caf/aiff/wav, 30 s or shorter, read from Info.plist
  `PoolseRingtone` at a PushKit cold wake). Android: the module plays
  `res/raw/<name>` looping on the ringtone stream; the incoming-call channel
  stays silent, so the sound can change without a new channel. Default is
  still the system ringtone.
- Android: the full-screen incoming call takes the app's look. Plugin option
  `incomingCall` / `configure({ incomingCall })` with `accentColor`,
  `backgroundColor` (a light one switches the text to dark) and `avatarUrl`, a
  template with `{externalId}` / `{userId}` (a push's `caller_avatar_url` wins).
  The picture loads off the main thread over the initials, which are now up to
  two letters. The ring notification is tinted with an app-set accent.
- Android: `incomingCall.activity` launches the app's own Activity instead of
  the built-in screen, with `PoolseIncomingCall.EXTRA_*` extras; it answers
  and declines through `dev.poolse.callcore.android.PoolseIncomingCall`
  (`isLive`, `answer`, `decline`, `ACTION_RING_CLOSED`).

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
