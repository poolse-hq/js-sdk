# `@poolse/react-ui`

Plug-and-play React components for **[poolse](https://poolse.dev)** — realtime chat infrastructure.

Brand-aligned default UI built on top of **[`@poolse/react`](https://www.npmjs.com/package/@poolse/react)** hooks. Drop a `<ConversationView>` in once and you've got chat. Or compose `<MessageBubble>`, `<MessageComposer>`, `<ConversationList>`, `<MemberList>`, `<AttachmentPreview>`, `<ReactionStrip>`, `<MentionInput>` à la carte. Themed via CSS variables — no rebuild needed to re-skin.

## Install

```bash
npm install @poolse/react-ui @poolse/react @poolse/sdk
```

## Quick start

```tsx
import { PoolseProvider } from '@poolse/react';
import { ConversationView } from '@poolse/react-ui';
import '@poolse/react-ui/styles.css';

function App() {
  return (
    <PoolseProvider
      config={{
        apiUrl: 'https://chat.example.com',
        getToken: async () => {
          const res = await fetch('/api/chat-token', { method: 'POST' });
          const { token } = await res.json();
          return token;
        },
      }}
    >
      <ConversationView conversationId="<conversation-id>" />
    </PoolseProvider>
  );
}
```

That's it. Auto-loads the brand fonts (Bricolage Grotesque / Hanken Grotesk / JetBrains Mono) on mount unless you pass `loadFonts={false}`.

## Components

| Component                              | Use                                                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `<ConversationView>`                   | Full chat surface: messages, typing, composer, reactions, threads, attachments — drag-drop + lightbox    |
| `<ConversationList>`                   | Sidebar of conversations the user belongs to                                                              |
| `<MemberList>`                         | Roster for a conversation, with role badges + optional remove                                             |
| `<MessageBubble>`                      | One message — coral for self, surface for others; markdown body; read-receipt glyph                       |
| `<MessageComposer>`                    | Pill input + circular brand send button                                                                   |
| `<MentionInput>`                       | Composer with `@` autocomplete (combobox ARIA)                                                            |
| `<TypingIndicator>`                    | Three bouncing dots + names label; live region for screen readers                                         |
| `<AttachmentPreview>`                  | Inline image (lazy thumbnail) + lightbox on click, OR file card with download                             |
| `<UploadQueueStrip>`                   | Chips with progress bar + cancel/dismiss for in-flight uploads                                            |
| `<ReactionStrip>` + `<ReactionPicker>` | Pills with counts + emoji picker (keyboard-navigable)                                                     |
| `<Avatar>`                             | Initials gradient + presence dot + image fallback                                                         |
| `<UserName>` / `useDisplayName`        | Resolve a user_id to its display name via `userResolver` (3-tier fallback chain)                          |
| `<ThreadView>`                         | Right-pane reply thread with focus management + ESC close                                                 |
| `<PoolseIcon name="…" />`              | Any icon from the 41-icon brand set                                                                       |
| `<PoolseLogo>`                         | Brand mark / lockup / wordmark, theme-aware                                                               |
| `<PoolseFonts />`                      | Inject the brand fonts (idempotent; `ConversationView` does this for you)                                 |

## What you get for free

- **Multi-file uploads** — composer picker accepts multiple files; drag-and-drop a batch onto the conversation pane and they ship as one message
- **Progress + cancel** — every upload shows a chip above the composer with live progress bar (XHR-driven) and per-item cancel
- **Image lightbox** — click any image attachment to view full-size; ESC closes, click-outside closes, body scroll locks
- **Markdown messages** — GFM-flavored (bold/italic/lists/code/blockquotes/strikethrough/autolinks); long messages auto-trim with a "Read more" toggle
- **Group-chat avatars + sender labels** — auto-on when a conversation has 3+ members; resolved via your `userResolver`
- **WhatsApp-style grouping** — same-sender messages within 5 min cluster visually; day separators between calendar days
- **Quote replies + threads** — quote stays in the main feed; "Reply in thread" opens the side pane
- **A11y baseline** — `role="log"` messages list, live regions for typing + status, focus management on overlays, scoped `prefers-reduced-motion`, keyboard-only emoji picker
- **Mobile baseline** — 44px touch targets, 16px composer font (no iOS auto-zoom), `safe-area-inset` on lightbox + composer, tap-reveal for message actions, full-screen thread pane below 760px

## Theming

Every color, radius, shadow, and font is a `--poolse-*` CSS variable. Override in your own stylesheet — no component ejection:

```css
:root {
  --poolse-brand: #0070f3; /* swap coral for your brand */
  --poolse-brand-soft: #e0eaff;
  --poolse-brand-strong: #0050b3;
}
```

Dark mode: set `[data-theme="dark"]` on any ancestor (or rely on the user's `prefers-color-scheme`).

## Customization

Every component has a render-prop escape hatch — replace any row, message, or item without giving up the rest of the UI:

```tsx
<ConversationList renderItem={(conv, selected) => <MyCustomRow {...} />} />
<ConversationView renderMessage={(msg, currentUserId) => <MyMessageBubble {...} />} />
```

Or skip `@poolse/react-ui` entirely and build everything on the raw hooks from `@poolse/react`.

## Documentation

- Full component reference + theming — <https://poolse.dev/docs/react-ui>
- Source — <https://github.com/poolse-hq/js-sdk>
- Issues — <https://github.com/poolse-hq/js-sdk/issues>

## License

MIT
