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

| Component                              | Use                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `<ConversationView>`                   | Full chat surface: message list + typing indicator + composer             |
| `<ConversationList>`                   | Sidebar of conversations the user belongs to                              |
| `<MemberList>`                         | Roster for a conversation, with role badges + optional remove             |
| `<MessageBubble>`                      | One message — coral for self, surface for others; read-receipt glyph      |
| `<MessageComposer>`                    | Pill input + circular brand send button                                   |
| `<MentionInput>`                       | Composer with `@` autocomplete                                            |
| `<TypingIndicator>`                    | Three bouncing dots + names label                                         |
| `<AttachmentPreview>`                  | Inline image (lazy thumbnail) OR file card with download                  |
| `<ReactionStrip>` + `<ReactionPicker>` | Pills with counts + emoji picker                                          |
| `<Avatar>`                             | Initials gradient + presence dot + image fallback                         |
| `<PoolseIcon name="…" />`              | Any icon from the 41-icon brand set                                       |
| `<PoolseLogo>`                         | Brand mark / lockup / wordmark, theme-aware                               |
| `<PoolseFonts />`                      | Inject the brand fonts (idempotent; `ConversationView` does this for you) |

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
