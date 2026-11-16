# @poolse/native

Formerly `@poolse/react-native-calls` (0.x).

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
