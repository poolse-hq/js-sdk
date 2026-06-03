# Changelog

All notable changes to `@poolse/react-native` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [semver](https://semver.org).

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
