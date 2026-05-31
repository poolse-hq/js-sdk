# Changelog

All notable changes to `@poolse/react-ui` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org).

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
