# Changelog

All notable changes to `@poolse/react-ui` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org).

## [0.2.0] — 2026-06-01

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
