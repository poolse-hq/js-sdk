# `@poolse/react-ui`

Drop-in React chat components — `<ConversationView>` mounts the whole chat surface in one component, or compose the building blocks (`<MessageBubble>`, `<MessageComposer>`, `<ConversationList>`, `<MemberList>`, `<ThreadView>`, `<MentionInput>`, `<TypingIndicator>`, `<ReactionPicker>`) for custom layouts. CSS-variable theming — re-skin without a rebuild. Built for Next.js + React 18+.

> **MIT-licensed alternative to Sendbird UIKit, Stream Chat React UI, TalkJS, and CometChat React UI Kit.** Same component names + prop shapes as [`@poolse/react-native`](https://www.npmjs.com/package/@poolse/react-native) so cross-platform code stays mechanical to port.

Sits on top of [`@poolse/react`](https://www.npmjs.com/package/@poolse/react) (hooks) and [`@poolse/sdk`](https://www.npmjs.com/package/@poolse/sdk) (client).

> **⚠️ Upgrading from 1.x?** See [MIGRATING.md](https://github.com/poolse-hq/js-sdk/blob/main/MIGRATING.md). Every `labelFor` / `avatarFor` / `onlineUserIds` prop is now keyed by `external_id`. `<UserName>` and `useDisplayName` switched from `userId` to `externalId`.

## Install

```bash
npm install @poolse/react-ui @poolse/react @poolse/sdk
```

```tsx
import '@poolse/react-ui/styles.css';
```

Import the stylesheet **once** at your app root. It defines the `--poolse-*` design tokens and the component styles.

## Quick start

```tsx
import { PoolseProvider } from '@poolse/react';
import { ConversationView } from '@poolse/react-ui';
import '@poolse/react-ui/styles.css';

export function App() {
  return (
    <PoolseProvider
      config={{
        getToken: async () => {
          const res = await fetch('/api/chat-token', { method: 'POST' });
          const { token } = await res.json();
          return token;
        },
      }}
    >
      <ConversationView conversationId="00000000-0000-0000-0000-000000000000" />
    </PoolseProvider>
  );
}
```

That's a complete chat surface. On mount it injects the brand fonts (Bricolage Grotesque, Hanken Grotesk, JetBrains Mono) via a Google Fonts `<link>`. Pass `loadFonts={false}` if your host app already loads them or your CSP forbids dynamic injection.

## `<ConversationView>`

The default composed surface. Every feature is on a flag you can turn off.

```tsx
<ConversationView
  conversationId={id}

  // Feature toggles (all default true unless noted)
  reactions
  mentions
  attachments
  actions
  threads
  quotations
  readReceipts
  markdown
  grouping
  daySeparators

  // Behavioral knobs
  maxBodyLength={200}        // 0 disables the "Read more" trim
  groupingWindowMs={300000}  // 5 min — same-sender messages within this window cluster
  senderLabels="auto"        // 'auto' (on for 3+ members) | 'always' | 'never'
  avatars="auto"             // same

  // Customer wiring
  labelFor={(userId) => /* … */}
  onMarkedRead={(convId) => /* clear sidebar badge */}
  renderMessage={(msg, currentUserId) => /* fully custom row */}
  emptyState={<div>Say hi.</div>}
  loadFonts                  // default true
/>
```

### What it gives you

- **Message list with infinite-scroll-up.** Top-sentinel `IntersectionObserver` fires `loadMore()` when the user gets within ~400px of the top.
- **Smart auto-scroll.** Stays pinned to the bottom while the user is at the bottom; otherwise increments a "N new messages" badge.
- **Auto mark-read.** When the latest message is in view, fires `markReadUpTo` once per fresh tail. Drives both your own progress (`onMarkedRead` callback) and the server-broadcast read receipt that flips other users' double-check glyph.
- **Drag-and-drop attachments.** The whole conversation pane accepts a file drop and forwards it to the composer's upload queue.
- **Quote-reply chip** above the composer when `quotations` is on. The chip carries the quoted sender + a snippet, and Esc dismisses it.
- **Realtime status banner.** Renders "Connecting…" / "Reconnecting…" / "Disconnected" pills when the socket isn't connected.
- **Thread side-pane** opens on the right when the user clicks "Reply in thread"; below 760px it goes full-screen.
- **Day separators.** "Today" / "Yesterday" / weekday name / `26 May 2024` between calendar days.
- **Message clustering.** Same sender, same day, within `groupingWindowMs` (default 5 min) — clustered with a single asymmetric tail on the last bubble (iMessage / WhatsApp convention).
- **Markdown bodies.** GitHub-flavored, sanitized: bold/italic/lists/code/blockquotes/strikethrough/autolinks. URLs render with `target="_blank" rel="noopener noreferrer nofollow"`.
- **Long-message trim.** Bodies past `maxBodyLength` collapse to a `Read more` toggle.

### `renderMessage` escape hatch

`renderMessage` completely replaces the default `<MessageRow>` for each message — you own the layout from the bubble outward. Group position, avatars, sender labels, hover actions: none of that is wired automatically when you take the slot.

```tsx
<ConversationView
  conversationId={id}
  renderMessage={(msg, currentUserId) => (
    <MyCustomBubble message={msg} isSelf={msg.sender_id === currentUserId} />
  )}
/>
```

If you want to keep most of the default behavior, render `<MessageRow>` yourself with the props you'd like to flip.

## Components

### Composed surfaces

| Component            | What                                                                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `<PoolseInbox>`      | Full inbox shell — two-column side-by-side list + detail on wide viewports, push-pane on ≤720px. Imperative ref API for `open`, `openDirect`, `openGroup`, `promptNewChat`, `promptNewGroup`, `close`. Built-in user picker + group-details sheet when a `users` directory is provided.    |
| `<ConversationView>` | Full chat (above) — `useMessages` + `useMembers` + `useTyping` + composer + thread pane wired together.                                                                                                                                                                                    |
| `<ChatHeader>`       | Standalone title bar — direct chats resolve the OTHER member's name + avatar via `labelFor` / `avatarFor`, groups show member count, presence-driven green dot. Optional `onBack`, `onPress`, `onMembersPress`, plus a free-form `rightSlot` for custom actions (e.g. an "Invite" button). |
| `<ThreadView>`       | The right-side reply pane. `useThread`-driven; close button + Esc + drag-drop. Used internally by `<ConversationView>`; export it for custom layouts.                                                                                                                                      |

### Sheets / modals

| Component             | What                                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<UserPickerSheet>`   | Modal for picking a direct-chat target or a group's members. `mode: 'single'` is one-tap-to-start, `mode: 'group'` adds a name input + multi-select. Accepts an `InboxUser` directory. |
| `<GroupDetailsSheet>` | Modal showing a group's name, avatar, and the existing `<MemberList>` roster with presence dots. Optional `footer` slot for "Leave group" / "Invite" actions.                          |

### Message surface

| Component                 | What                                                                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<MessageRow>`            | One fully-wired row: bubble + (optional) avatar + reaction strip + thread pill + hover actions. Owns a single `useReactions` instance shared by the inline strip and the picker. |
| `<MessageBubble>`         | Just the bubble — sender label, quoted card, attachments, body, meta. Pure presentational; takes `Message` + `currentUserId`.                                                    |
| `<EditableMessageBubble>` | `<MessageBubble>` plus an in-place edit mode (textarea, Enter to save, Esc to cancel). Controlled via the `editing` prop.                                                        |
| `<MessageActions>`        | Hover popover with the react / reply / quote / copy / edit / delete affordances.                                                                                                 |
| `<TypingIndicator>`       | Three bouncing dots + a `role="status"` live region announcing "Alice is typing" / "Alice and Bob are typing" / "3 people are typing".                                           |

### Composer

| Component            | What                                                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<MessageComposer>`  | Pill input + send button + paperclip → upload queue. Smart list continuation (Enter on `- item` repeats the bullet). Exposes an imperative `addFiles(files)` via `ref` for drag-drop callers.                   |
| `<MentionInput>`     | Same as `<MessageComposer>` but with `@`-autocomplete from the conversation's member list. `combobox` ARIA, keyboard-navigable dropdown. Sends `MessageCreateRequest` shape (including `mentions[]`) on submit. |
| `<UploadQueueStrip>` | Renders one chip per item in the composer's upload queue — pending/uploading/ready/error — with cancel + dismiss. Live progress bar driven by the SDK's XHR-based upload.                                       |

### Attachments

| Component             | What                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `<AttachmentPreview>` | Inline image (lazy thumbnail → fullscreen lightbox on click) or a file card with download. Resolves the presigned URL via `useAttachmentUrl`. |

### Conversation roster

| Component            | What                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<ConversationList>` | Sidebar list of the user's conversations. Avatar + name + `last_message_preview` + timestamp + unread pill. Direct rows resolve the other member's name/avatar via `labelFor` / `avatarFor` (the same resolvers `<ChatHeader>` and `<PoolseInbox>` take), so a customer can wire one mapping everywhere. Controlled mode: pass `conversations`/`loading`/`error` to render from external state instead of `useConversations()`. |
| `<MemberList>`       | Roster for one conversation. Role badges, online dot, optional remove button gated by a `canRemove(membership)` predicate.                                                                                                                                                                                                                                                                                                      |

### Reactions

| Component          | What                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `<ReactionStrip>`  | Inline emoji pills with counts + "your reaction" highlight; optional picker button on the right. |
| `<ReactionPicker>` | Standalone emoji popover. Six common emojis, arrow-key navigation, Esc closes.                   |

### Identity

| Component                       | What                                                                                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<Avatar>`                      | Circular image with initials fallback + green presence dot. `size: 'sm' \| 'md' \| 'lg'`.                                                                                   |
| `<UserName>` / `useDisplayName` | Resolve a `user_id` to a display string via the configured `userResolver`, with a `labelFor` sync override and a stable fallback (`User abc123`) when nothing is available. |

### Brand chrome

| Component                              | What                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<PoolseIcon name="…">`                | One SVG icon from a built-in set (41 names: `attachment`, `bell`, `check`, `chevron-down`, `close`, `download`, `edit`, `emoji`, `heart`, `image`, `message`, `messages`, `pin`, `plus`, `presence`, `pulse`, `reply`, `search`, `send`, `send-fill`, `settings`, `thumbs-up`, `trash`, `typing`, `user`, `users`, `webhook`, …). Pass `label={null}` for purely decorative. |
| `<PoolseLogo>`                         | Brand mark / lockup / wordmark / mono (single-color) variants.                                                                                                                                                                                                                                                                                                               |
| `<PoolseFonts />` / `usePoolseFonts()` | Inject the Google Fonts link into `<head>` (idempotent). `<ConversationView>` calls this automatically unless you pass `loadFonts={false}`.                                                                                                                                                                                                                                  |

## Attachments inside the bubble (1.1.0+)

As of 1.1.0, `<MessageBubble>` renders attachments **inside** the bubble (WhatsApp / iMessage convention) rather than as a separate block under it.

The layout chooses a grid template by image count:

| Count     | Layout                                                                        |
| --------- | ----------------------------------------------------------------------------- |
| 1 image   | Single full-bleed tile, natural aspect, capped at 360px tall.                 |
| 2 images  | Two equal squares, side-by-side.                                              |
| 3 images  | One 16:9 hero on top + two squares beneath.                                   |
| 4+ images | 2×2 grid. The 4th tile shows a `+N more` overlay when the total exceeds four. |

Non-image attachments (PDFs, etc.) render as stacked file cards inside the bubble's padded area, below the image mosaic. On self-bubbles the cards tint white-on-coral to read against the brand color.

When a message has **only** images (no body text and no file cards), the meta row (time + read tick) becomes a small dark pill overlaid on the bottom-right of the mosaic — same convention as WhatsApp.

The bubble has `overflow: hidden` so the mosaic is clipped to the bubble's rounded corners and the asymmetric tail.

### Opting out

```tsx
<MessageBubble message={msg} currentUserId={meId} showAttachments={false} />
```

Pass `showAttachments={false}` to suppress in-bubble attachments — useful if you want to render them yourself outside the bubble. `<MessageRow>` forwards its `attachments` flag to this prop, and `<ConversationView>`'s `attachments` flag forwards to `<MessageRow>`.

### Migration from 1.0.x

Anything customizing `.poolse-message-row__attachments` in your stylesheet won't match anymore — that class is no longer rendered. The new class names are:

- `.poolse-message__media` — image mosaic container
- `.poolse-message__media--n1` / `--n2` / `--n3` / `--n4` — count-specific grid templates
- `.poolse-message__media-tile` — one image cell
- `.poolse-message__media-overflow` — the `+N more` overlay
- `.poolse-message__files` — file-card stack
- `.poolse-message__meta--overlay` — modifier applied to `.poolse-message__meta` in image-only mode
- `.poolse-message--has-media` / `--media-only` — parent state modifiers

If you weren't styling the old class, you don't need to do anything — the new layout is on by default.

## Theming

Every color, radius, shadow, and font in the kit is a CSS variable. Override them in your own stylesheet — no JS, no rebuild:

```css
:root {
  --poolse-brand: #0070f3; /* primary action */
  --poolse-brand-soft: #e0eaff; /* tinted fills, hover, badges */
  --poolse-brand-strong: #0050b3; /* AA text on light surfaces */
  --poolse-on-brand: #ffffff; /* foreground on brand */
}
```

The full token set:

```css
/* Brand & surfaces */
--poolse-brand            /* primary action (default Pulse Coral #ff5436) */
--poolse-brand-strong     /* AA text on light */
--poolse-brand-soft       /* tinted fills, badges, hover */
--poolse-on-brand         /* foreground on brand */
--poolse-paper            /* page background */
--poolse-surface          /* cards, panels */
--poolse-surface-2        /* insets, fields */
--poolse-ink              /* primary text */
--poolse-ink-2            /* secondary text */
--poolse-ink-3            /* tertiary, hints */
--poolse-border           /* hairline borders */

/* Semantic */
--poolse-presence         /* online dot */
--poolse-success
--poolse-warning
--poolse-error            /* distinct from coral */
--poolse-info

/* Typography */
--poolse-font-display     /* Bricolage Grotesque */
--poolse-font-body        /* Hanken Grotesk */
--poolse-font-mono        /* JetBrains Mono */
--poolse-font-size        /* default 15px */
--poolse-line-height      /* default 1.5 */

/* Radii */
--poolse-radius-sm        /* 8px */
--poolse-radius-md        /* 12px */
--poolse-radius-lg        /* 16px */
--poolse-radius-xl        /* 24px */
--poolse-radius-pill      /* 999px */

/* Shadows (warm-tinted) */
--poolse-shadow-sm
--poolse-shadow-md
--poolse-shadow-lg
```

### Dark mode

The stylesheet ships with a dark theme keyed off the user's `prefers-color-scheme`. To force a mode, set `data-theme="dark"` or `data-theme="light"` on any ancestor of the chat surface:

```html
<div data-theme="dark">
  <ConversationView ... />
</div>
```

## Accessibility

- `<div role="log" aria-live="polite" aria-relevant="additions">` on the message list — screen readers announce new messages but not the initial load.
- `<aside role="complementary" aria-label="Message thread">` on the thread pane. Esc closes; close button auto-focuses on mount.
- `<MentionInput>` is a proper combobox: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`, `aria-activedescendant` on the input; the dropdown is `role="listbox"` with `role="option"` items.
- `<ReactionPicker>` is `role="menu"` / `role="menuitem"` with arrow-key navigation and Esc to close.
- `<TypingIndicator>` is `role="status" aria-live="polite" aria-atomic="true"`; the dots themselves are `aria-hidden`.
- `<Avatar>` is `role="img" aria-label="{name}"` even when rendering initials.
- Touch reveal: the hover action menu on `<MessageRow>` is hidden on `(hover: none)` and switches to tap-toggle on the bubble itself, so you don't lose actions on mobile.
- The image lightbox locks body scroll while open, closes on Esc and on backdrop click, and keeps the image itself non-dismissable (so a click on the image doesn't accidentally close).
- The whole kit honors `prefers-reduced-motion` for the typing indicator, the message-row hover transitions, and the thread pane slide-in.

Touch targets in the composer are 44px; the textarea uses 16px so iOS doesn't auto-zoom on focus; the lightbox + composer apply `safe-area-inset` padding for notched devices.

## Customization layers

In order of escalating control:

1. **CSS variables.** Re-skin without touching JS.
2. **Feature flags on `<ConversationView>`.** Turn whole features off (`reactions={false}`, `threads={false}`, etc.).
3. **Render-prop slots.** Replace individual rows: `<ConversationView renderMessage={...}>`, `<ConversationList renderItem={...}>`, `<MemberList renderItem={...}>`, `<ThreadView renderMessage={...}>`.
4. **Component composition.** Drop `<ConversationView>` and assemble `<MessageRow>` (or `<MessageBubble>` if you want to skip the row's wiring) + `<MessageComposer>` + `<TypingIndicator>` + `<ThreadView>` yourself.
5. **Drop down to `@poolse/react`.** Build your own components on the same hooks that this package uses internally.

You can mix and match — there's no all-or-nothing boundary.

## Re-exports

The package also re-exports a few helpers that are useful when you're composing your own UI:

- `userColor(userId)` — deterministic per-user color for sender labels and avatars (8-hue palette, hashed from the id).
- `computeGroupPosition(msg, prev, next, windowMs)` / `sameDay(a, b)` / `formatDayLabel(iso)` — the same grouping primitives `<ConversationView>` uses to cluster messages.
- `useAutogrow(ref, value)` — textarea auto-grow hook used by the composers.
- `handleListEnter(value, caret)` — the smart-list-continuation primitive (handles `- item` / `1. item` continuation on Enter).

## Links

- Full docs — <https://poolse.dev/docs/react-ui>
- Hooks reference — [`@poolse/react`](https://www.npmjs.com/package/@poolse/react)
- SDK reference — [`@poolse/sdk`](https://www.npmjs.com/package/@poolse/sdk)
- Source — <https://github.com/poolse-hq/js-sdk>

## License

MIT
