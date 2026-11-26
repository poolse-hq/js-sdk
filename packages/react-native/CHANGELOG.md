# Changelog

All notable changes to `@poolse/react-native` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [semver](https://semver.org).

## [Unreleased]

### Fixed

- `ConversationView`: a `beforeSend` that throws puts the text back (with a
  notice); the files stay.
- `ConversationView`: a send that settles after the host switched
  `conversationId` in place no longer clears the new conversation's reply
  chip or drops the old text into it; the outcome goes to the draft of the
  conversation it was sent from.
- Images in messages and the viewer fetch a fresh URL when one fails to load
  (an expired signature in a chat left open).
- A reaction picked from the long-press sheet or the emoji picker that fails
  no longer becomes an unhandled promise rejection (the pill rolls back).
- Names never show a raw id: rows, bubbles, quote cards, the reply chip,
  mentions (the inserted `@name` too), the typing line, `MemberList`,
  `UserName` / `useDisplayName`, `ChatHeader`, `ConversationList` and
  `PoolseInbox` fall back to "Unknown user" (thread avatars: "Someone"). One
  order everywhere, the same as web (`displayNameOf` from `@poolse/react`):
  `labelFor`, then the `userResolver` profile — the bubble header used to
  prefer the profile, so it could disagree with the row's screen-reader
  label. `UserName`'s `fallback` is now only for a null `externalId` (as its
  doc said).
- `ForwardSheet` starts clean each time it opens (no picks, comment or
  search left from the last forward), and shows an error when the
  forward fails instead of nothing.
- `BlockRenderer` shows an error when an action fails, and opens a link
  button or a link preview only when its URL is
  `http:`/`https:`/`mailto:`.
- `MeetingCard` shows "Your answer wasn’t saved. Try again." when an
  RSVP fails (as on web) and disables the answers while one is saving.
  `onRsvp` may now return `false` to report a failure.
- `meetingTimeText` names the end day when a meeting runs past midnight
  ("Tue 21 Nov · 23:00 – Wed 22 Nov 01:00"), as web does, and takes an
  optional `locale`.
- `ClipPlayer` renews a broken link at most three times a minute and
  then shows "The clip couldn’t be played." instead of fetching a new
  link on every media error; `RecordingPlayer` shows an error once its
  renewals run out.

### Changed

- `formatCountdown`, `useCallDuration` and the agent-invite error text
  use the shared `formatClock` and `callAgentInviteErrorMessage` helpers
  instead of private copies (same output).

## [3.10.3] - 2026-11-26

### Added

- `MessageComposer` (and `MentionInput`, `composerProps`): `onMic` shows a
  mic in the send button's place while there is nothing to send, and
  `recordingBar` is drawn instead of the input row while set — an inline
  voice message recorder.

## [3.10.2] - 2026-11-23

### Added

- `ConversationView` / `ThreadView`: `composerProps` (passed through to the
  composer), `composerAccessory` (rendered above it), `composerHandle`
  (ref: `focus`, `insertText`, `setText`, `getText`, `clear`,
  `setSelection`, `addFiles`) and `beforeSend` (`async (draft) => draft |
false`: change or cancel a send; cancelled, the text and files stay).
  `ConversationView` passes them on to its thread sheet.
- `extraActions={(msg) => MessageExtraAction[]}`: the app's own entries in
  the long-press menu (`MessageActions` takes `extraActions` too; rows take
  the resolved list).
- Deleting a message asks first: a native "Delete message?" alert by
  default, or `confirmDelete={(msg) => boolean | Promise<boolean>}`.
- `MessageComposerHandle` gains `getText`, `setText` and `insertText`;
  `MentionInput` forwards a ref; a composer's `onSend` resolving to `false`
  keeps the draft. Types `BeforeSend`, `ComposerPassThroughProps`,
  `MessageExtraAction`, `ConfirmDelete`.

### Fixed

- `Avatar` works outside a `PoolseProvider` (a public booking page):
  `presence={true}` then draws no badge instead of throwing, and a broken
  `src` falls back to the initials.

### Changed

- `MessageComposer` clears its file queue once the send returns (it used to
  clear as Send was pressed), so a held-back send keeps the files.

## [3.10.1] - 2026-11-23

### Added

- `useNativeBreakouts(conversationId, callId, { moveToRoom })` (CL5):
  `useBreakouts` that moves the @poolse/native call into your breakout
  room as the split opens and back as it closes (`auto`, default on);
  `inBreakout`, `joinRoom`, `returnToMainRoom`. `BreakoutBanner` takes it
  and uses it for Join room / Return to main.
- `AnnotationOverlay` draws (CL4): `annotations` (from
  `useScreenAnnotations`) with `drawing` and `color` make a finger draw
  lines everyone in the call sees. With @poolse/native's `callData` the
  overlay and `useCallReactions` work on phones.

## [3.10.0] - 2026-11-23

### Added

- Agents in calls: `CallAgentTag`, `InviteAgentMenu`, `WhisperPanel`
  ("Only you see this"), `EscalationCard`, `EscalationList` — the same props
  as @poolse/react-ui. `StagePanel` takes `agents` (and
  `MeetingParticipant.agent` / `.speaking`) and lists them with the badge.
- `MessageComposer` / `MentionInput`: `formattingToolbar`, `commands`,
  `groups`, the DLP warning (`DlpWarningSheet`); `FormattingToolbar`,
  `CommandSuggestions`.
- `PollCard`, `BlockRenderer`, `PinsList`, `ForwardSheet`, `FilesList`,
  `ForumPostList`, `CatchUpCard`, `TranslatedText`, `NoteCard`,
  `VoiceRecorder` (hold to record), `VoiceMessagePlayer`,
  `VideoMessagePlayer` — media through the `MediaPlayback` and
  `AudioRecorderAdapter` adapters (expo-audio / expo-video in the app).
- `MessageActions`: pin, forward, translate. `ThreadView`: `follow`,
  `alsoSendToChannel`. Custom emoji in `EmojiPicker` and `ReactionStrip`
  (`EmojiGlyph`).

- Live meetings on the final server contract: guests and phones named by
  the call, `RoomPresence` with `useRoomPresence` entries (guests and phones
  counted), `MeetingCard` RSVPs through `poolse.live.meetings.rsvp` by
  default (`onRsvp` overrides, `false` hides).
- The same agents and meetings components as `@poolse/react-ui`
  (`AgentBadge`, `AgentBadgeInline`, `ApprovalCard`, `MessageApproval`,
  `ApprovalList`, `MessageCitations`, `SummaryCard`, `AskMeetings`,
  `ClipPlayer`, `RecordingPlayer`) and `Avatar agent`, with the badge on
  names, members, mentions, senders and the DM header.
- `renderMedia` (`PoolseMediaProps`): plays recordings and clips through the
  app's own player (README: an expo-video adapter); no new peer dependency.
- `ConversationView` `onOpenCitation`, `onOpenMoment`, `renderMedia`.
- Live meeting components (docs/MEETINGS.md; each takes the matching
  `@poolse/react` hook): `StagePanel` (speakers, audience, raise hand, Bring
  up / Move to audience), `QuestionsPanel` (Q&A with upvotes, anonymous,
  Answered / Dismiss), `BreakoutBanner` (room, countdown, Join room / Return
  to main), `LobbyWaiting` (the guest's waiting screen) and `LobbyAdmitList`
  (Admit / Deny / Admit all), `MarkMomentButton`, `AgendaPanel` (owner,
  minutes, check off, over-time nudge), `RoomPresence` (who's in a room, for
  sidebars), `MeetingCard` and `MeetingCardMessageRow` (Accept / Maybe /
  Decline, Join).
- Call overlays: `CaptionsOverlay` (live captions from the transcript),
  `ReactionsOverlay` and `ReactionPickerBar`, `ConnectionIndicator` (signal
  bars for web or native quality), `NetworkBanner` (plain-language network
  problems), `WhiteboardView` (view, or simple pen drawing with a model) and
  `AnnotationOverlay` (pointer and drawing on a shared screen, view only).
- Helpers: `formatCountdown`, `captionLines`, `avatarOverflow`,
  `overrunText`, `meetingTimeText`, `rsvpSummary`.

## [3.9.0] - 2026-11-22

### Added

- `RecordingBanner`, `RecordingIndicator`, `ConsentPrompt`,
  `RecordingNoticeRow`, `LiveTranscriptPanel`, `TranscriptViewer` — the same
  props as `@poolse/react-ui` (`style` in place of `className`).
- `MessageRow` renders the `{"kind":"recording"}` system message as a line
  instead of raw JSON (`nameForUserId`), and `ConversationList` /
  `PoolseInbox` word it in previews.

## [3.8.0] - 2026-11-21

### Added

- `useBackgroundClients(clients, active)` / `applyBackground`: only the
  workspace on screen keeps its socket; all close in the background.
- `<SendStatus>` under unsent messages (Retry / Delete), `<EmptyState>`
  defaults for the conversation list (and `query` / `noResultsState`), an
  empty conversation and an empty thread.

### Changed

- Drafts are per client and namespaced (the pre-3.8 key is moved), cleared
  by `destroy({ clearStorage: true })`.
- `useAppStateLifecycle` uses `client.setBackground`.
- Message rows read as "Ana: text" with a "Message actions" accessibility
  action (they all read "Message actions" before); reaction chips, header,
  composer buttons and the text input have roles and labels.

## [3.7.1] - 2026-11-21

### Fixed

- `list` layout: the time beside later messages of a run no longer wraps
  ("2:00P" / "M"). It stays on one line, without the space before AM/PM, and
  shrinks to fit the gutter, so "10:00 PM" and "12:45 AM" fit too.
- @-mention suggestions show only the person's name, not their id next to it.

## [3.7.0] - 2026-11-21

- No changes; released with the other `@poolse/*` packages at 3.7.0.

## [3.6.2] - 2026-11-21

### Fixed

- `usePoolseTheme()` is exported again (deprecated; use `useTheme()`). 3.4.0
  removed the export by mistake, although the changelog called it deprecated.
- Re-exports from `@poolse/theme`, as the 3.4.0 notes said: `BUILT_IN_THEME_IDS`,
  `DEFAULT_THEME_ID`, `createTheme`, `encodeTheme`, `decodeTheme`, plus the new
  `tokensFromFlat` and the types `BuiltInThemeId`, `ColorScheme`,
  `ColorSchemePreference`, `FlatThemeTokens`, `Theme`, `ThemeInput`.
- Threads follow the app's settings: `ThreadView` takes `density`, and the
  thread `ConversationView` opens gets its `avatarFor` and `density`.

## [3.6.1] - 2026-11-21

- No changes; released with the other `@poolse/*` packages at 3.6.1.

## [3.6.0] - 2026-11-21

### Added

- Presence: `PresenceBadge` (`state`, `doNotDisturb`, `size`, `ringColor`) —
  online in `success`, away in `warning`, in a call in `accent` with a phone,
  do not disturb as a moon, nothing for offline. `Avatar` takes `presence`
  (a `PresenceState`, or `true` to look it up with `useUserPresence` for
  `userId` / `seed`) and `doNotDisturb`. `ChatHeader` (direct chats) says
  "Online", "Away", "In a call" or "Last seen …" and badges the avatar.
  `showPresence` on `ConversationView` (message avatars, default off),
  `ConversationList`, `MemberList` and `PoolseInbox` (default on).
- `useAppStatePresence(enabled?)`: `presence.setActivity('active' | 'idle')`
  from `AppState`. `useAppStateLifecycle()` does it too (`{ presence: false }`
  to opt out) and `PoolseInbox` by default (`trackActivity`).
- `LinkPreviewCard` (`preview`, `onRemove`, `maxWidth`, `tone`,
  `onLongPress`) under the text in every layout; "Remove preview" in the
  sender's long-press sheet (`chat.messages.update(id, { remove_link_previews:
[url] })`). Props `linkPreviews` on `ConversationView`, `ThreadView`,
  `MessageRow`, `MessageBubble`; `onRemoveLinkPreview` on `MessageRow`.
- `ThreadSummary`: "N replies · last reply 5m ago" with up to three stacked
  avatars of `thread_participants`; replaces the "N replies" link.
- "New messages" line (`NewMessagesDivider`) above the first message unread
  when the conversation opened, and a pill that jumps to it, loading older
  pages, while it's off screen (`ConversationView newMessagesDivider`).
- "Mark unread" on other people's messages (`chat.conversations.one(id)
.markUnread(messageId)`); auto mark-read pauses until the next send.
  `ConversationView markUnread`, `onMarkedUnread`; `MessageRow onMarkUnread`;
  `MessageActions onMarkUnread`.
- Drafts per conversation (text and quote target) in memory across switches,
  persisted with `ConversationView draftStorage` (`DraftStorage`: `get`,
  `set`, `remove`; async allowed) unless `persistDrafts={false}`; cleared on
  send. Types `DraftStorage`, `ConversationDraft`.
- `EmojiPicker` (`visible`, `onClose`, `onPick`, `keepOpen`, `title`): a
  built-in sheet with search, recently used and categories. Opened from the
  composer's emoji button (`emojiPicker` on `ConversationView` /
  `MessageComposer`), from "+" in the long-press reactions
  (`MessageActions onMoreReactions`) and after reaction chips
  (`ReactionStrip onMorePress`).
- `EditHistorySheet` (`messageId`, `currentBody`, `onForbidden`): tap
  "edited" for earlier versions (`chat.messages.edits`); a 403 closes it and
  hides the affordance. `MessageRow editHistory`, `MessageBubble
onEditedPress`.
- `ConversationList`: `header`, `sections` (`ConversationSection`:
  `{ title, filter }`) or `groupBy="type"` (`ConversationGroupBy`; "Channels"
  then "Direct messages") through a `SectionList`, infinite scroll on
  `useConversations().loadMore` (controlled: `hasMore`, `loadingMore`,
  `onLoadMore`), `density`, a relative time per row. `PoolseInbox` pages its
  list.
- Attachments: `maxFileSize` and `acceptedFileTypes` on `ConversationView`
  (`maxFileSize`, `acceptedTypes`, `onError`, `multiple` on
  `AttachmentPicker`); refused files and a denied camera show a notice.
  Several photos can be picked at once.
- `MessageComposer`: `value` / `onChangeText` (controlled), `onSelectionChange`,
  `accessory`, `emojiPicker`; `MessageComposerHandle.setSelection`, and the
  handle type is exported. `MessageList onVisibleItemsChange`.

### Changed

- A deleted message reads "This message was deleted" and has no actions,
  reactions, quote or swipe-to-reply in any layout; its thread link stays.
- A failed send keeps the text in the composer and shows why above the list;
  `quoted_message_deleted` reads "The message you replied to was deleted." and
  drops the quote.
- Editing a message no longer touches the unsent draft.
- The typing indicator also shows in an empty conversation.
- `MemberList` badges come from `useUserPresence` (workspace presence) rather
  than who has the conversation open, unless `onlineExternalIds` is passed.
- The picker's "Photo or video" item is "Photo library" (it only ever picked
  photos).

### Fixed

- `MentionInput`: typing `@` never opened the member list and picking a member
  didn't reach the input. Suggestions now appear inline as you type `@name`,
  and `mentions` carries the ids whose `@Name` is still in the text.

## [3.5.0] - 2026-11-21

- No changes; released with the other `@poolse/*` packages at 3.5.0.

## [3.4.0] - 2026-11-21

### Added

- `PoolseTheme` takes `theme` = a `@poolse/theme` built-in id (`coral`,
  `ocean`, `forest`, `grape`, `slate`, `sunset`, `rose`, `mono`) or a `Theme`,
  and `colorScheme` = `'light' | 'dark' | 'system'` (`'system'` follows
  `useColorScheme()` live and is the default when `theme` is given). `fonts`
  maps the theme onto font families you loaded. Switching re-renders without
  remounting.
- `useTheme()` returns the active tokens as a `NativeTheme`
  (`@poolse/theme` names: `colors.accent`, `colors.surfaceAlt`, `fonts.body`,
  `radii.bubble`, …). Every component now reads its tokens from it.
- Re-exports `BUILT_IN_THEME_IDS`, `DEFAULT_THEME_ID`, `createTheme`,
  `encodeTheme`, `decodeTheme` and the theme types from `@poolse/theme`.
- `ConversationView` chat layouts: `layout="bubbles" | "list" | "compact"`
  (default `bubbles`, unchanged). `list` is Slack-style — full-width
  left-aligned rows, avatar + name + time once per run, later messages' time
  dimmed in the gutter, "N replies" under thread roots. `compact` is
  Discord/IRC-style — time, the name in the sender's `userColor` and the text
  on one line, 20px avatars only with `showAvatars`. Both mark messages that
  @-mention the viewer with an accent bar, draw day dividers as a rule, and
  open the same long-press actions sheet as bubbles.
- `ConversationView` props `density` (`'comfortable' | 'compact'`),
  `showAvatars` (overrides `avatars`; defaults `list` on, `compact` off),
  `timeFormat` (`'12h' | '24h' | (date) => string`), `groupWindowMinutes`
  (default 5, was fixed), `daySeparators` (default `true`), and `slots` —
  `header`, `body`, `attachments`, `reactions`, `thread`, `actions`, each
  `(props) => ReactNode` receiving the message, sender, layout, `isRunStart`
  and its default rendering as `children`, in every layout. Types
  `ChatLayout`, `ChatDensity`, `TimeFormat`, `MessageSlots`, `MessageSlot`,
  `MessageSlotProps`, `RenderMessageContext`.
- `renderMessage` gets a third argument, `{ layout, groupPosition, isRunStart,
renderDefault }`.
- `MessageRow` `layout`, `density`, `timeFormat`, `slots`, `mentionsMe`;
  `MessageBubble` `timeFormat`, `density`, `slots` / `slotContext`;
  `ThreadView` `layout`, `timeFormat`; `DaySeparator` `variant="rule"`;
  `Avatar` `size="xs"` (20px).

### Deprecated

- The legacy `PoolseTheme` override object (`theme={{ colors: { brand } }}`),
  `mode` (use `colorScheme`) and `usePoolseTheme()` (use `useTheme()`). All
  still work: overrides merge over the original palette as before, and
  `usePoolseTheme()` returns the original shape for any theme.

### Changed

- Own-bubble text, links and quote cards read `ownBubbleText` / `link`, and
  the edit backdrop reads `overlay`; their values without a theme are
  unchanged.

## [3.3.0] - 2026-11-20

### Added

- `ConversationView` props: `focusMessageId` (load older pages until the
  message is there, scroll to it and highlight it) with
  `onFocusMessageNotFound`; `onSenderPress(user)` and `onAvatarPress(user)`
  (`MessageUser`, exported); `composer={false}` / `readOnly` hide the
  composer (and quote-reply and the attachment picker with it).
- Tapping a quoted message jumps to the original.
- `MessageRow` `onSenderPress` / `onAvatarPress`, `MessageBubble`
  `onSenderPress`, `MessageList` `scrollToMessageId` / `scrollRequest`.

### Changed

- `ConversationView` always marks messages read; `readReceipts={false}`
  now only hides the read ticks. Before, it also stopped marking read, so
  unread counts never cleared.
- `onMarkedRead` fires once the server accepts the read (it fired before the
  request). The badge in every `useConversations()` under the provider is
  already cleared by then.

## [3.2.0] — 2026-11-17

Stable release of everything in the 3.2.0 prereleases below (streaming agent replies, screen sharing, full screen, the redesigned call screen, screen sharing from iOS).

## [3.2.0-dev.5] — 2026-11-17 (prerelease, npm tag `dev`)

No changes; released with the other packages.

## [3.2.0-dev.4] — 2026-11-16 (prerelease, npm tag `dev`)

### Added

- Filled call icons: `mic-fill`, `mic-off-fill`, `video-fill`,
  `video-off-fill`, `screen-share-fill`, `screen-share-off-fill`,
  `phone-off-fill`, `speaker-fill`.

## [3.2.0-dev.3] — 2026-11-16 (prerelease, npm tag `dev`)

### Added

- Icons `fullscreen` and `fullscreen-exit`.

## [3.2.0-dev.2] — 2026-11-16 (prerelease, npm tag `dev`)

### Added

- Icons `screen-share` and `screen-share-off`.

## [3.2.0-dev.1] — 2026-11-04 (prerelease, npm tag `dev`)

### Added

- `<ConversationView>` streams AI agent replies as they're written, like `@poolse/react-ui`: typing first, then a growing bubble, replaced by the finished message.

## [3.2.0-dev.0] — 2026-11-04 (prerelease, npm tag `dev`)

### Changed

- Moves with `@poolse/sdk` 3.2.0-dev.0.

## [3.1.0] — 2026-10-27

### Fixed

- `useAppStateLifecycle` no longer tears down every channel when the app
  goes to the background. It pauses the socket and resumes it on return,
  so mounted hooks keep receiving events; before, they went silent until
  remounted. It now pauses only on `background`, not on iOS `inactive`
  (notification centre, app switcher).
- `AttachmentPicker` declares the size of the bytes it actually uploads.
  The server now refuses a file bigger than its declared size.

## [3.0.0] — 2026-10-26

### Changed

- **License.** From 3.0.0 this package is under the poolse SDK License
  (see `LICENSE`): free to use, including commercially, in apps built on
  poolse; not for use with other backends or to build a competing
  service. Versions before 3.0.0 remain MIT.
- First stable release; all `@poolse/*` packages move to 3.0.0 together.
  Earlier versions are deprecated. See `MIGRATING.md`.
- The native call core is now `@poolse/native` (was `@poolse/react-native-calls`).

## [2.29.0] — 2026-10-22

### Removed

- **The legacy JS call path**: `CallScreen`, `useVoipCalls` (PushKit +
  CallKit via react-native-callkeep / react-native-voip-push-notification),
  `VoiceRoomBar`, `CallVideoGrid`, `CallParticipantTile`, `LocalVideoPip`,
  `useCallAudio`, `describeRoute` and the `react-native-webrtc` adapter
  (`createNativeWebRtcAdapter`, `isNativeWebRtcAvailable`). The optional
  `react-native-webrtc` peer dependency is gone. Calls run in
  `@poolse/react-native-calls`; the building blocks for drawing its
  snapshot stay — `CallControlButton`, `CallAvatar`, `AudioRouteSheet`
  (now exporting `AudioRoute` / `AudioRouteKind` itself), `callColors`,
  `useCallDuration`.

## [2.24.0] — 2026-10-14

### Fixed

- **The call UI finally respects Android's navigation bar.** A Modal
  is its own Android window, and safe-area insets inherited from the
  root provider are stale or zero inside it — so the dock, grid and
  controls all sat under the system bar while every non-modal screen
  behaved. CallScreen now mounts its own SafeAreaProvider inside the
  Modal and measures insets there.
- CallScreen feeds `reportOthersOnCall` so EVERY hang-up path — not
  just its own button — knows a group call must survive a leaver (see
  @poolse/react 2.24.0).

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
