# Changelog

All notable changes to `@poolse/react-ui` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org).


## [3.0.0] — 2026-10-26

### Changed

- **License.** From 3.0.0 this package is under the poolse SDK License
  (see `LICENSE`): free to use, including commercially, in apps built on
  poolse; not for use with other backends or to build a competing
  service. Versions before 3.0.0 remain MIT.
- First stable release; all `@poolse/*` packages move to 3.0.0 together.
  Earlier versions are deprecated. See `MIGRATING.md`.

## [2.25.0] — 2026-10-22

### Removed

- **`CallProvider` / `useCallInvite`** — the legacy ringing call surface,
  built on the removed `useCalls`. Rooms are `RoomJoinBar` + `RoomStage`
  over `useRoom`; `useRoom().join(media, { ring: true })` rings phones.

## [2.20.0] — 2026-10-13

### Changed

- **The message bubble, rebuilt.** Same props, new rendering:
  - The timestamp (with `edited` and the read ticks) sits on the last
    line of plain-text bodies — an invisible spacer twin reserves its
    exact footprint, so it shares the line or wraps flush right.
  - Media bleeds to a 3px frame of bubble color, capped at 420px
    (`.poolse-message--has-media`), and squares its bottom corners
    into a following caption. Mosaic seams carry the bubble's color
    instead of a grey backing. Bubble radius 16px → 18px.
  - 1–3 emoji and nothing else render large, without bubble chrome
    (`.poolse-message--jumbo`).
  - Markdown bodies no longer inherit `white-space: pre-wrap`, which
    rendered react-markdown's inter-element newlines as phantom blank
    lines in lists.
  - The hover actions chevron floats half outside the bubble's
    top-right corner as a bordered disc, instead of a translucent
    stamp overlapping the corner radius. The bubble no longer clips
    its contents (`overflow: hidden` removed); the mosaic clips
    itself.
  - Quote cards: 10px radius; deleted messages read "Message deleted".

### Fixed

- **In-bubble file cards overflowed the bubble** — `width: 100%` plus
  padding with no `box-sizing: border-box`, previously masked by the
  bubble's overflow clip.

## [2.19.0] — 2026-08-25

### Changed

- Version bump to stay in step with the rest of the workspace.

## [2.18.0] — 2026-08-24

Republished in lockstep.

## [2.17.1] — 2026-08-24

Republished in lockstep.

## [2.17.0] — 2026-08-24

Republished in lockstep.

## [2.16.3] — 2026-08-24

Republished in lockstep.

## [2.16.2] — 2026-08-24

Republished in lockstep.

## [2.16.1] — 2026-08-24

Republished in lockstep.

## [2.16.0] — 2026-08-24

Republished in lockstep with `@poolse/react-native@2.16.0`.

## [2.15.2] — 2026-08-23

### Fixed

- Same edge seam as `@poolse/react-native@2.15.2`: the floating preview's
  inner tile is borderless, so the bubble owns the only rounding.

### Changed

- `CallVideoGrid`'s tile takes `fit` separately from `bleed`. The two
  were coupled, but the spotlight and the floating preview are both
  bleed tiles that want opposite fits — the spotlight letterboxes so a
  phone's portrait frame survives a landscape window, while the preview
  is a small fixed-ratio bubble that should be filled edge to edge.

## [2.15.1] — 2026-08-23

### Fixed

- Picks up the camera-on-answer fix from `@poolse/react@2.15.1`.

## [2.15.0] — 2026-08-23

### Added

- **`CallProvider` and `useCallInvite`** — the web counterpart to
  `@poolse/react-native`'s `CallScreen`. Mount `CallProvider` once at
  the root and it owns ringing, answering, media and the call UI;
  buttons anywhere below reach it through `useCallInvite`.

  This exists because the alternative kept going wrong: a call surface
  mounted inside a conversation view means the app cannot be called at
  all while no conversation is open, and unmounts the call state machine
  if the user navigates back to the list mid-call. Both present as
  calling being unreliable rather than as a mounting mistake.

### Changed

- The camera control is disabled when the machine has no camera, instead
  of being a button that reports an error each time it is pressed.

## [2.14.1] — 2026-08-23

### Changed

- `CallDeviceMenu` renders a single-entry list instead of hiding. One
  entry answers "is my microphone even being seen?", which a hidden
  control does not. Only an empty list renders nothing.

## [2.14.0] — 2026-08-23

### Fixed

- **A phone's video is no longer cropped to a sliver.** The spotlight
  tile filled its box with `object-fit: cover`, so portrait video in a
  landscape window was cropped to roughly the caller's nose. The
  spotlight now letterboxes; fixed-ratio tiles still crop, where the
  alternative is a grid of pillarboxed slivers. Set on the element
  rather than left to host CSS — it is behaviour, not theme.

### Added

- **`CallControlButton`** and **`CallDeviceMenu`** — round call controls
  and a device picker, matching `@poolse/react-native`'s controls so the
  two platforms read the same. Still no CSS: the host owns the look.
- **`CallVideoGrid`'s local preview is draggable**, snapping to the
  nearest corner, with an `onLocalClick` prop for switching camera.
- New class hooks: `.callstage__pip--c0…c3`, `.callstage__pip--dragging`,
  `.calldevices*`, `.callbtn__caret`, `.callbtn__wrap`.

## [2.13.1] — 2026-08-23

Republished in lockstep with `@poolse/react-native@2.13.1`. No changes
to this package.

## [2.13.0] — 2026-08-23

### Changed

- **`CallVideoGrid` is now layout-aware.** One other person gets the
  whole frame with your own camera in a corner tile; three or more get a
  grid, two columns up to six and three beyond that. Splitting a
  two-person call into equal boxes spent most of the screen on
  letterboxing.
- Camera-off participants render a coloured initials avatar rather than
  a bare letter, matching the mobile SDK.
- Mute is shown with the `mic-off` icon instead of the word "muted".

### Added

- Call icons: `phone`, `phone-off`, `mic-off`, `video`, `video-off`,
  `speaker`, `speaker-off`, `camera-flip`, `bluetooth`, `headphones`,
  `chevron-up`.
- New class hooks: `.callstage`, `.callstage__pip`,
  `.callgrid__tile--bleed`, `.callgrid__avatar`. No CSS ships with the
  component — the host app still owns the look.

## [2.0.0] — 2026-06-03

Lockstep release with `@poolse/sdk@2.0.0` and `@poolse/react@2.0.0`.

### Breaking

- **`UserNameProps.externalId`** — was `userId`. Same applies to
  `useDisplayName(externalId, …)`.
- **`MemberListProps.labelFor: (externalId) => string`** — was keyed
  by uuid. Same change to `avatarFor`.
- **`MemberListProps.onlineExternalIds`** — was `onlineUserIds`.
- **`TypingIndicatorProps.labelFor: (externalId) => string`**.
- **`MessageBubbleProps.labelFor: (externalId) => string`** — both
  the main `labelFor` and the QuotedCard's. The bubble reads
  `message.sender_external_id` to drive `useUser`.
- **`MessageComposerProps.labelFor: (externalId) => string`**.
- **`MentionInputProps.labelFor: (externalId) => string`**. The
  dropdown filters and inserts by external_id; the wire `mentions`
  array stays uuid-keyed (backend storage hasn't changed there).
- **`ConversationViewProps.labelFor: (externalId) => string`** —
  passes through to every consuming child.

### Migration

See `MIGRATING.md` at the repo root.

## [1.1.0] — 2026-06-02

Lockstep release with `@poolse/sdk@1.1.0` and `@poolse/react@1.1.0`.
`@poolse/react-ui` carries the actual feature work this version; the
other two packages bumped to keep the three in sync, so customers can
pin one version across the whole client surface.

### Added — attachments inside the bubble (WhatsApp-style)

- `<MessageBubble>` now renders attachments INSIDE the bubble rather
  than as a separate block underneath. Images compose a mosaic at the
  top of the bubble, file cards stack below the mosaic, and the
  message body (if any) sits beneath them all. Layout chooses a grid
  template by image count: n1 → single full-bleed tile (natural
  aspect, capped at 360px), n2 → two equal squares, n3 → one 16:9
  hero + two squares beneath, n4+ → 2×2 grid with the 4th tile
  showing a `+N more` overlay. The bubble has `overflow: hidden` so
  the mosaic is clipped to the bubble's rounded corners and the
  asymmetric tail.
- `<MessageBubble showAttachments?: boolean>` — new prop, defaults
  to `true`. Pass `false` if you want the bubble to skip the
  in-bubble attachments (so you can render them yourself).
  `<MessageRow>` forwards its existing `attachments` flag to this
  prop, and `<ConversationView>`'s `attachments` flag forwards to
  `<MessageRow>`. Existing callers don't need to do anything to get
  the new layout.
- New CSS classes: `.poolse-message__media`,
  `.poolse-message__media--n1` / `--n2` / `--n3` / `--n4`,
  `.poolse-message__media-tile`, `.poolse-message__media-overflow`,
  `.poolse-message__files`, `.poolse-message__meta--overlay`, plus
  the parent-state modifiers `.poolse-message--has-media` and
  `.poolse-message--media-only`.
- When a message has only images (no body text and no file cards),
  the meta (time + read tick) renders as a small dark pill overlaid
  on the bottom-right of the mosaic, matching the WhatsApp
  convention.
- File-card attachments on self bubbles get a tinted white-on-coral
  variant so they read against the brand colour.

### Changed

- `<MessageRow>` no longer renders the standalone attachments block
  below the bubble — attachments now live inside the bubble via the
  new `showAttachments` plumbing.
- README rewritten as a full component reference with the in-bubble
  attachment layout documented, the migration note for the removed
  CSS class, the full design-token list, the customization layers,
  and the accessibility surface.

### Removed

- CSS class `.poolse-message-row__attachments` and its `--self`
  modifier are no longer rendered or defined. Any customer rule that
  selected on them will silently no-op. Re-target the new classes
  above to restore custom styling.

### Migration notes

- If you never touched the `.poolse-message-row__attachments`
  selector and you don't pass `attachments={false}` to
  `<ConversationView>` / `<MessageRow>`, nothing changes for you —
  attachments still appear, just inside the bubble.
- If you styled the old class, switch your selectors to
  `.poolse-message__media` / `.poolse-message__files`. The new
  classes carry the same semantic content (images and file cards
  respectively), and the design-token-driven defaults already match
  the surrounding bubble styling.
- If you previously rendered your own attachments outside the bubble
  while passing a `<MessageBubble>` directly, pass
  `showAttachments={false}` to keep that arrangement.

### Internal

- Test harness: `XMLHttpRequest` is undefined'd in `test/setup.ts`
  so the bundled Phoenix LongPoll fallback can't schedule a
  setTimeout that fires after happy-dom teardown. Resolves the
  unhandled-error exits previously seen on `pnpm test`.

## [1.0.0-beta.0] — 2026-06-01

First beta of the stable component surface. Promotes the full 0.2.x
UI kit (ConversationView with reactions / mentions / attachments /
threads / quotations / readReceipts flags, MessageRow with thread
pill + quote card, MessageComposer / MentionInput with the quote
chip, MessageBubble with the WhatsApp-style QuotedCard + fallback
placeholder, ConversationList with unread badges) to a stable
namespace. No breaking changes relative to `0.2.0-alpha.7`.

## [0.2.0] — 2026-06-01

### Changed — quote card polish

- WhatsApp-style quote card visuals: compact padding, 4px Pulse Coral
  accent stripe flush with the bubble edge, body text at 0.62 opacity
  so the eye lands on the actual message. Self-bubble variant tints
  with a dark overlay; other-bubble variant tints slightly darker than
  the surface for visual "depth."
- Optimistic quote preview: when you quote-reply, the card renders
  immediately on the locally-inserted bubble (looked up from the
  in-memory message list) instead of flashing in once the realtime
  echo arrives ~100ms later.

### Added — quote replies (WhatsApp-style)

- `<ConversationView quotations?>` (default `true`) — new feature
  toggle. Adds a "Reply" action to the hover menu distinct from
  "Reply in thread". Reply pre-fills the composer with a quote chip
  above the input; on send, the new message carries `quoted_message_id`
  and stays in the main feed (no thread promotion).
- `<MessageBubble>` renders a small quoted-message card above the body
  when `message.quoted_message` is set. Click → scroll-to-original
  with a 1.6s highlight pulse on the target row.
- `<MessageComposer>` + `<MentionInput>` gain controlled
  `replyingTo?: Message` and `onCancelReply?: () => void` props.
  Renders a quote chip above the input with an (x) to cancel; Esc
  also dismisses.
- `<MessageActions>` gains `onQuote?: () => void` — wired in
  `<MessageRow>` to call back to the caller's quote state.

### Added — unread badges on `<ConversationList>`

- `<ConversationList unreadCounts>` now accepts a per-conversation
  unread map and renders a small Pulse Coral pill on each row when
  `unread > 0`. Auto-falls-back to `useConversations().unreadCounts`
  when the component runs in uncontrolled mode, so sidebars work
  out of the box with no extra wiring.

### Added — thread pill + copy action

- `<MessageRow>` renders a subtle "💬 N replies" pill below any message
  whose `reply_count > 0`. Clicking the pill opens the thread side-pane
  via the existing `onOpenThread` callback. Hidden in `<ThreadView>`
  (threads-within-threads aren't supported in 0.2).
- `<MessageActions>` gains an optional `onCopy` action. `<MessageRow>`
  wires it to `navigator.clipboard.writeText(message.body)` whenever
  the message has a non-empty body.

### Changed — better error visibility

- `<MemberList>` now renders `error.message` under the "Failed to load
  members." headline so callers see the actual cause without opening
  DevTools.

### Added — new components

- `<MessageActions>` — hover-triggered popover with react / reply
  (open thread) / edit / delete affordances. Built on `PoolseIcon`
  and reuses the existing `ReactionPicker`.
- `<EditableMessageBubble>` — extends `MessageBubble` with an
  inline-edit mode (controlled `editing` prop, textarea with
  Enter-to-save / Esc-to-cancel).
- `<ThreadView>` — side-pane component for thread replies.
  Composes `useThread` + `MessageBubble` + `MessageComposer` with
  the same brand styling as the main view. Includes a root-message
  preview at the top.

### Added — `<ConversationView>` feature toggles (all default ON)

- `reactions` — render `<ReactionStrip>` under each message.
- `mentions` — swap `<MessageComposer>` for `<MentionInput>` when
  the conversation has loaded members.
- `attachments` — paperclip icon in the composer triggers a file
  picker → presigned upload → send with `attachment_ids`. Inline
  renders attached images / file cards via `<AttachmentPreview>`.
- `actions` — hover-revealed `<MessageActions>` next to each message,
  with edit/delete only shown for own messages.
- `threads` — clicking "reply in thread" from a message opens a
  right-side `<ThreadView>`.
- `readReceipts` — check-double glyph on own messages once another
  member's `last_read_message_id` advances past them. Auto-computed
  from `useMembers`. Now updates in real time via the new
  `member:read` realtime event.

Each toggle defaults to `true`, so dropping in
`<ConversationView conversationId={id} />` gets you the full chat
surface out of the box. Set any to `false` to slim down the view.

### Added — new props

- `<ConversationView onMarkedRead={(convId) => ...}>` — fires once
  per fresh tail after auto-mark-read commits. Pair with
  `useConversations().markConversationRead` to clear a sidebar
  unread badge immediately (before the realtime echo).

## [0.1.2] — 2026-06-01

### Added

- `<ConversationList>` gains optional controlled-mode props:
  `conversations`, `loading`, `error`. When passed, the component
  renders from those instead of calling `useConversations()`
  internally. Lets a parent own the conversations list state — useful
  when the host app creates conversations via a custom backend route
  (e.g., the showcase's `/api/conversations`) and needs to push the
  new conversation into the list immediately, without waiting for
  the realtime push. When omitted, auto-fetches as before (no
  breaking change for existing callers).

## [0.1.1] — 2026-06-01

### Fixed

- `<ConversationView>` no longer wraps each rendered message in a
  `<div>`. The wrapper was a block-level element that took 100% of
  the flex row width, which pinned every bubble (self + other) to
  the left regardless of `MessageBubble`'s `align-self` rule. Now
  using a `<Fragment>` so the bubble is the direct flex child.
- Pulls `@poolse/react@^0.1.1` for the matching `useMessages`
  sender_id fix on optimistic sends.

## [0.1.0] — 2026-06-01

First publishable release.

### Added

- Composed `<ConversationView>` — full chat surface in one drop-in.
- Individual pieces: `<MessageBubble>`, `<MessageComposer>`,
  `<TypingIndicator>`, `<Avatar>`.
- Conversation + member panels: `<ConversationList>`, `<MemberList>`.
- Rich content: `<AttachmentPreview>` (image / file),
  `<ReactionStrip>` + `<ReactionPicker>`, `<MentionInput>`.
- Brand chrome: `<PoolseIcon>` (41 icons), `<PoolseLogo>` (mark / lockup
  / wordmark / mono), `<PoolseFonts />` (auto-loaded by
  `<ConversationView>`).
- Full `--poolse-*` CSS variable system mirroring the brand kit:
  colors, type, radii, warm-tinted shadows, light + dark themes.
- Render-prop escape hatches on every list/conversation component.
