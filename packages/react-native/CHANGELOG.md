# Changelog

All notable changes to `@poolse/react-native` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [semver](https://semver.org).

## [2.23.1] — 2026-10-14

### Fixed

- **The 2x2 video grid's bottom row sat under Android's navigation
  bar.** The filling grid spanned the whole edge-to-edge window; it
  now pads by the safe area, so tiles never sit under system UI. The
  auto-hiding call chrome may still float over a tile — tap to clear
  it — but the OS bars never cover a face.

## [2.23.0] — 2026-10-14

### Fixed

- **Leaving a group call no longer ends it for everyone.** With two or
  more others still connected, hanging up just walks out — the room's
  presence tells them — and the end-the-call signal is only sent when
  at most one other person remains. WhatsApp semantics.
- **The video grid clears the control dock.** The grid's bottom
  clearance matched the old chrome; a group call's last row of tiles
  hid behind the new dock and hang-up button.
- Errors only show while the call is NOT working — a stale "timed out"
  banner no longer sits over a healthy connected call.

## [2.22.1] — 2026-10-14

### Fixed

- **Bubble text rendered doubled on Android.** The inline timestamp
  reserved its spot with an invisible twin of itself — but
  `color: transparent` on a nested Text does not reliably apply on
  Android, so the twin rendered visibly at the end of every plain
  message, with the real meta overlaid. The reservation trick is gone:
  the last text line and the meta are measured (`onTextLayout`), and
  the meta shares the line only when it provably fits, else takes its
  own flush-right row.

## [2.22.0] — 2026-10-14

### Added

- `CallScreen onSpeakerChange` — fires with `(speakerOn,
  externalDevice)` whenever the audio route changes. Hosts use it to
  drive the proximity sensor: the screen should only go dark near an
  ear when the sound is actually at the ear.

## [2.21.1] — 2026-10-14

### Fixed

- **The composer sat underneath Android's navigation bar.** The
  internal safe-inset hook lazy-required react-native-safe-area-context
  inside a try/catch; in the ESM bundle `require` doesn't exist, so
  every app silently got hardcoded fallback insets — 34 on iOS (right
  by coincidence) and 0 on Android. The hook now imports the library
  statically, which CallScreen already did anyway.

## [2.21.0] — 2026-10-13

### Added

- `CallScreen conversationLabel` — a named conversation titles the
  call ("Fix the boiler"), and the people move into the status line.
  A group call is a call FROM the group.
- The VoIP push path reads `conversation_name` from the payload and
  prefers it over `caller_name` for CallKit, so the lock-screen ring
  and the Recents entry carry the conversation's name once servers
  send the field. Old payloads behave exactly as before.

### Changed

- **The call scene, rebuilt.** A brand glow rises behind the identity
  block instead of a flat void; pulse rings breathe while a call
  rings; the name and status sit centered in the scene (status in a
  glass pill, with a green dot and tabular duration once connected);
  the in-call controls gather into one floating glass dock with the
  hang-up below; incoming calls get labeled, spaced Decline/Accept.
  No call logic changed.

## [2.20.1] — 2026-10-13

### Fixed

- **Long-press on an image-only message never opened the actions
  sheet.** The mosaic tiles are Pressables (tap opens the viewer) and
  a nested Pressable wins the gesture, so the row's long-press never
  fired when the image WAS the whole bubble. The long-press now
  threads through `MessageBubble onLongPress` into every tile.

## [2.20.0] — 2026-10-13

### Changed

- **The message bubble, rebuilt.** Same props, new rendering:
  - The timestamp (with `edited` and the read ticks) sits on the last
    line of plain-text bodies — an invisible twin reserves its exact
    footprint, so it shares the line or wraps flush right. Short
    messages are one-line bubbles again; the `minWidth` floor that
    padded them out is gone.
  - Media bleeds to a 3px frame of bubble color, capped at 420pt,
    corners concentric with the bubble (default radius 16 → 18). When
    a caption or file cards follow, the mosaic squares its bottom
    corners into the text instead of leaving "ears" of bubble color.
  - Image-only messages float the meta on a scrim pill over the
    picture, matching the web package.
  - 1–3 emoji and nothing else render large, without bubble chrome.
  - Quote cards: 10pt radius, darker-than-bubble tint on both sides,
    and a quoted-of-deleted fallback matching web.
  - A deleted message renders its tombstone even when the body was
    cleared server-side.

- **The always-visible corner chevron is gone.** It stamped a control
  into the bubble's rounded corner and duplicated affordances a phone
  already has — long-press opens the actions sheet, swipe quotes.
  `MessageBubble`'s `actionsTrigger` slot remains for custom rows.

### Added

- `AttachmentPreview tone="onBrand"` — restyles the file card for
  brand-colored self bubbles (translucent white instead of a surface
  patch). `MessageBubble` passes it automatically.
- `ImageMosaic squareBottom` — small bottom radii for mosaics that
  flow into a caption; `radius` now applies per-corner. The mosaic
  also takes an explicit pixel width from the bubble, fixing a layout
  where a percentage against the auto-sized bubble could collapse or
  blow the row open.

## [2.19.0] — 2026-08-25

### Added

- **The end of a call now travels by push, like its start.** A device
  woken by a VoIP push is ringing on a lock screen with a socket that
  may not be connected, so the broadcast that ends a call reaches
  nothing there. `useVoipCalls` now understands a teardown push
  (`event: "ended"`) and tears the ring down instead of starting one.
  Needs a server that sends them, and an AppDelegate that reports the
  call before ending it — see the sample's `plugins/withVoipPush.js`.

- `readPush()` — exported and pure, so what a push MEANS can be tested
  apart from what CallKit does about it. A missing `event` reads as a
  ring, which is what servers predating the field send.

### Fixed

- **A ring that arrived by push is now registered with `useCalls`**, so
  every signal that ends a call can match it. Previously only CallKit
  knew about it. See `@poolse/react` 2.19.0.

### Changed

- A finished call — declined, busy, no answer — closes itself after a
  short pause instead of waiting behind a Close button.

## [2.18.0] — 2026-08-24

### Fixed

- **The device was often never registered for VoIP push, so no call
  ever rang a backgrounded or closed app.** `useVoipCalls` registered
  the PushKit token the instant iOS issued it — which is moments after
  launch, and routinely before the host app has a session. Registering
  is an authenticated call, so it 401'd, and the error was swallowed as
  "offline at launch". No device row meant poolse had nothing to push
  to.

  The token is now held until a signed-in user exists, and registered
  when both are present — in whichever order they arrive. A failure no
  longer marks the pair as done, so it retries rather than giving up
  until the next launch.

## [2.17.1] — 2026-08-24

### Fixed

- Ringback actually asks for `_BUNDLE_` now. 2.17.0 shipped the
  changelog entry for this without the code change.

## [2.17.0] — 2026-08-24

### Fixed

- **Ringback played an iPhone ringtone.** On iOS the library resolves
  `startRingback("_DEFAULT_")` to `/Library/Ringtones/Marimba.m4r`, so
  the caller heard the sound the callee's phone makes. `_DTMF_` is
  remapped to `_DEFAULT_`, so the only correct option is to ship a tone:
  `CallScreen` now asks for `_BUNDLE_`, and the app supplies
  `incallmanager_ringback.mp3`. If it is absent the library falls back
  to the ringtone, which is no worse than before.

## [2.16.3] — 2026-08-24

### Fixed

- `RingToneModule` is loose again, like `LiveKitModule`. Spelling the
  real signatures out made `react-native-incall-manager` unassignable —
  function parameters are contravariant, so any difference at all (an
  argument required rather than optional, `number | number[]` rather
  than `number[]`) means no app can pass the module in, and it breaks
  again on the next upstream change. Narrowed at the point of use.

  2.16.1 and 2.16.2 both attempted this and shipped without it.

## [2.16.2] — 2026-08-24

### Fixed

- `RingToneModule` is loose again, like `LiveKitModule`. Spelling the
  real signatures out made `react-native-incall-manager` unassignable —
  function parameters are contravariant, so any difference at all (an
  argument required rather than optional, `number | number[]` rather
  than `number[]`) means no app can pass the module in, and it breaks
  again on the next upstream change. Narrowed at the point of use.

## [2.16.1] — 2026-08-24

### Fixed

- `RingToneModule` declared its tone argument optional, which made the
  real `react-native-incall-manager` unassignable to it — function
  parameters are contravariant, so a signature that demands an argument
  cannot stand in for one that does not.

## [2.16.0] — 2026-08-24

### Added

- **Ring tones.** `CallScreen` takes an optional `inCallManager` module
  and plays ringback while an outbound call rings, and a ringtone for an
  inbound one — but only when it is actually showing the incoming UI,
  since CallKit already rings and a second tone underneath is noise.
  A silent outbound call is indistinguishable from one that failed to
  place at all.

### Changed

- **Media opens while the call rings, not after it is answered.** The
  caller used to stare at a blank screen for the whole ring and then
  watch their own preview pop in a second late — and the microphone was
  not open either, so the first word of every call was clipped. The room
  is now joined on `ringing-out`, so it is warm the moment the far side
  picks up. Safe for the alone-detection: a caller in an empty room has
  never seen a peer, which is the guard that already exists.
- **Tapping the call screen toggles the controls.** It only ever showed
  them before, and a timer took them away — so there was no way to
  deliberately clear the chrome and look at the video. The idle timer
  remains, on top rather than as the only way they disappear.

## [2.15.2] — 2026-08-23

### Fixed

- **The floating self-preview had a visible seam around its edge.** The
  bubble clips to its own rounding, but the tile inside rounded itself
  as well and carried a 2px border — transparent or not, that inset the
  video from the edge it should meet, and the two radii disagreeing left
  a hairline along the curve. The inner tile is borderless now, and the
  bubble is rounder.

## [2.15.1] — 2026-08-23

### Changed

- **The floating self-preview now sits in the screen's corners.** It was
  bounded by the call chrome, which left it parked well inside the
  screen rather than tucked into a corner — and on a connected video
  call the chrome is hidden most of the time anyway, so it was reserving
  room for something that was not there. `CallVideoGrid` takes a new
  `safeArea` prop for this; `chromeInsets` still governs the scrolling
  group grid's clearance under the control bar.

### Fixed

- Picks up the camera-on-answer fix from `@poolse/react@2.15.1`.

## [2.15.0] — 2026-08-23

Republished for the call-lifecycle fixes in `@poolse/sdk` and
`@poolse/react` — a callee being unable to hang up on the caller, a late
cancel tearing down a live call, and media left connected with no UI
behind it all affected React Native too. See those changelogs.

## [2.14.1] — 2026-08-23

Republished in lockstep. The device fix in `@poolse/sdk` is a web
concern; React Native routing goes through `useCallAudio`.

## [2.14.0] — 2026-08-23

Republished in lockstep. Device selection landed in `@poolse/sdk` and
`@poolse/react`; on React Native, routing continues to go through
`useCallAudio` and the platform audio session.

## [2.13.1] — 2026-08-23

### Fixed

- Controls no longer vanish mid-tap on a video call: pressing one now
  restarts the idle countdown, which a screen-wide handler never saw
  because a child `Pressable` wins the touch outright.
- The iOS audio policy is released when a call ends while its session is
  still starting, instead of being left installed.
- The floating self-preview follows the stage across a rotation rather
  than keeping a pixel position from the old bounds.
- The auto-hang-up on an emptied call fires once rather than on every
  render in the window before the phase flips.

## [2.13.0] — 2026-08-23

A near-total rebuild of the calling surface.

### Added

- **Audio output routing — `useCallAudio`.** Speaker, earpiece, wired
  headset and Bluetooth, driven through LiveKit's `AudioSession`. Audio
  calls start at the earpiece and video calls on the speaker, but a
  connected headset outranks both, so plugging in AirPods mid-call does
  the obvious thing. Android enumerates real devices and gets a picker
  (`AudioRouteSheet`); iOS exposes only default/force-speaker, so the
  system route picker is opened instead. This moves the audio session
  out of host apps — `CallScreen` now owns it on the SFU path.
- **Camera flip.** A control in the bar, and tapping your own preview.
- **Draggable local preview (`LocalVideoPip`)** that snaps to the
  nearest corner.
- **Call duration timer**, anchored to a timestamp so a throttled or
  sleeping phone cannot make it drift.
- Exported building blocks: `CallControlButton`, `CallParticipantTile`,
  `CallAvatar`, `LocalVideoPip`, `AudioRouteSheet`, `callColors`,
  `useCallDuration`, `useCallAudio`.
- Call icons: `phone`, `phone-off`, `mic-off`, `video`, `video-off`,
  `speaker`, `speaker-off`, `camera-flip`, `bluetooth`, `headphones`,
  `chevron-up`.

### Changed

- **`CallScreen` rebuilt.** Round icon controls with captions, engaged
  controls inverted so they read at a glance, full-bleed video, a
  header carrying the name and call duration, and controls that fade
  out on a connected video call and return on tap. The call surface is
  deliberately dark regardless of the app theme, as every serious
  calling app renders one.
- **`CallVideoGrid` is layout-aware**: spotlight plus floating preview
  for a 1:1 call, a scrolling grid for three or more.
- **A call ends when everyone else leaves**, including when they never
  sent a hang-up.

### Fixed

- **Video calls open with the camera on.** See `@poolse/react@2.13.0`.

## [0.1.5] — 2026-06-03

### Added

- **`<ImageMosaic>`** — WhatsApp-style multi-image grid (n1 / n2 /
  n3 / n4+ with `+N more` overlay) used inside `<MessageBubble>`
  whenever a message has more than one image attachment. Tapping a
  tile opens a full-screen modal viewer with tap-anywhere-to-close.
  Exported standalone so you can use the layout outside the bubble
  if you want.
- **Haptic feedback on long-press** in `<MessageRow>` —
  `Haptics.impactAsync(ImpactFeedbackStyle.Medium)` fires when the
  action sheet opens. `expo-haptics` is loaded via a cached lazy
  `require()` — falls back to a silent no-op if you haven't
  installed it, so no peer dep is forced on consumers that don't
  want haptics.

### Changed

- **Cleaner bubble meta row**: relative timestamp formatting
  (`HH:MM`, `Yesterday HH:MM`, `Mon HH:MM`, `MMM D`), tabular-num
  font variant so the time width stays stable, the read tick sits
  flush with the timestamp, and `edited` is its own italic pill
  rather than inline text.

### Notes

- `expo-image-picker`, `expo-document-picker`, and `expo-haptics`
  remain OPTIONAL peer dependencies. (0.1.4 briefly promoted them
  to required — that caused npm to reorganize the dep tree on
  consumer installs, ended up with two copies of `@poolse/react` in
  Metro's bundle, and broke `PoolseProvider` context resolution.
  0.1.5 reverts that. 0.1.3 and 0.1.4 were both burned slots and
  should not be used.)

## [0.1.0] — 2026-06-03

First release. Plug-and-play React Native UI for poolse, mirroring
the `@poolse/react-ui` component surface for native targets.

### Added

- **Composed surface**: `<ConversationView>` with feature flags
  (`reactions`, `mentions`, `attachments`, `actions`, `threads`,
  `quotations`, `readReceipts`) — same defaults as web.
- **Message components**: `<MessageBubble>`, `<EditableMessageBubble>`,
  `<MessageRow>`, `<MessageComposer>`, `<MessageActions>`,
  `<MessageList>` (inverted FlatList with stick-to-bottom +
  hold-position).
- **Realtime feedback**: `<TypingIndicator>` (animated dots).
- **Conversation + member panels**: `<ConversationList>` (FlatList +
  unread badges), `<MemberList>`.
- **Rich content**: `<AttachmentPreview>` (image + file card),
  `<UploadQueueStrip>`, `<ReactionStrip>`, `<ReactionPicker>` (modal
  sheet), `<MentionInput>` (autocomplete popover),
  `<AttachmentPicker>` (wraps `expo-image-picker` and
  `expo-document-picker` when present).
- **Threads**: `<ThreadView>` (modal screen).
- **User display**: `<UserName>`, `useDisplayName` — both keyed by
  `externalId` to match SDK 2.0.
- **Brand chrome**: `<PoolseIcon>` (SVG via `react-native-svg`),
  `<PoolseLogo>` (mark/lockup/wordmark/mono), `<Avatar>` (initials
  - URL fallback + stable userColor hashing).
- **Theme system**: `<PoolseTheme>` provider + `usePoolseTheme()`
  hook. JS theme object with the same token groups as the web
  `--poolse-*` CSS variables (colors, type, radii, shadows,
  spacing). Light + dark defaults ship in.
- **AppState lifecycle**: `useAppStateLifecycle()` hook — closes
  the SDK WebSocket on background, reopens + refetches the active
  conversation tail on foreground. Designed to pair with
  push-notification delivery on the dev's backend (no in-app
  background socket maintenance).

### Notes

- Peer dependencies: `react >=18`, `react-native >=0.73`,
  `react-native-svg >=14`. `expo-image-picker` and
  `expo-document-picker` are optional peer deps — `<AttachmentPicker>`
  only requires them if you mount it.
- Theming via JS object (no CSS variables). Override any token:
  `<PoolseTheme theme={{ colors: { brand: '#ff5733' } }}>`.
- Shares the same `<PoolseProvider config={...}>` from
  `@poolse/react` — one provider for both web and RN.
