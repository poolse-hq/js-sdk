# `@poolse/react-native`

Plug-and-play React Native components for [poolse](https://poolse.dev).
Mirrors [`@poolse/react-ui`](https://www.npmjs.com/package/@poolse/react-ui)
for native targets: same component names, same prop shapes, same
feature flags — implemented against `View` / `Text` / `FlatList` /
`TextInput` / `Pressable` / `Image` / `Modal` / `KeyboardAvoidingView`.

Works out of the box with Expo (SDK 50+) and bare React Native
(≥ 0.73). Sits on top of [`@poolse/react`](https://www.npmjs.com/package/@poolse/react)
(hooks) and [`@poolse/sdk`](https://www.npmjs.com/package/@poolse/sdk)
(client).

## Install

```bash
npm install @poolse/sdk @poolse/react @poolse/react-native react-native-svg
# optional — only required if you mount <AttachmentPicker>:
npx expo install expo-image-picker expo-document-picker
```

## Quick start

```tsx
import { PoolseProvider } from '@poolse/react';
import { PoolseTheme, ConversationView } from '@poolse/react-native';

export default function ChatScreen({ conversationId }: { conversationId: string }) {
  return (
    <PoolseProvider config={{ getToken, userResolver }}>
      <PoolseTheme>
        <ConversationView conversationId={conversationId} />
      </PoolseTheme>
    </PoolseProvider>
  );
}
```

The same `<PoolseProvider>` you use on web. Wrap it once at the app
root if you have multiple chat screens. Drop the `<PoolseTheme>`
wrapper if you don't need to override the brand defaults — every
component has a fallback theme baked in.

## What ships

| Component                                     | What it does                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `<ConversationView>`                          | Composed chat surface — message list + composer + typing strip. Feature flags identical to web. |
| `<MessageBubble>` / `<EditableMessageBubble>` | Single message render — body, meta, read receipt, quoted card, in-bubble attachments.           |
| `<MessageRow>`                                | Bubble + alignment + actions slot.                                                              |
| `<MessageList>`                               | Inverted `FlatList` wrapper — stick-to-bottom, hold-position, auto-load-more.                   |
| `<MessageComposer>`                           | Text input with auto-grow, send button, attach button, quote chip.                              |
| `<MessageActions>`                            | Long-press menu (reply / quote / edit / delete / copy / react).                                 |
| `<TypingIndicator>`                           | Animated three-dot indicator + labels.                                                          |
| `<ThreadView>`                                | Modal screen for thread replies.                                                                |
| `<ConversationList>`                          | `FlatList` of conversation rows with unread badges.                                             |
| `<MemberList>`                                | Member roster with avatars + remove action.                                                     |
| `<MentionInput>`                              | `TextInput` + autocomplete popover.                                                             |
| `<ReactionStrip>` / `<ReactionPicker>`        | Reaction summary + emoji picker sheet.                                                          |
| `<AttachmentPreview>`                         | Image or file card.                                                                             |
| `<AttachmentPicker>`                          | Wraps `expo-image-picker` + `expo-document-picker`.                                             |
| `<UploadQueueStrip>`                          | Pending uploads with cancel.                                                                    |
| `<UserName>` / `useDisplayName(externalId)`   | Display name resolution via the SDK's `userResolver`.                                           |
| `<Avatar>`                                    | Initials + URL fallback, stable color per user.                                                 |
| `<PoolseIcon>` / `<PoolseLogo>`               | Brand chrome via `react-native-svg`.                                                            |

## Theming

JS object via `<PoolseTheme theme={overrides}>`. The full token
surface mirrors the web `--poolse-*` CSS variables, grouped by
purpose:

```tsx
<PoolseTheme
  theme={{
    colors: {
      brand: '#ff5733',
      brandSoft: '#ffe9e3',
      onBrand: '#ffffff',
    },
    radii: {
      bubble: 18,
    },
  }}
>
  {/* ... */}
</PoolseTheme>
```

Pass nothing to use the brand defaults. Pass `mode="dark"` to swap
to the warm dark palette. Deep-merges your overrides on top —
unspecified tokens keep their default.

## Lifecycle

```tsx
import { useAppStateLifecycle } from '@poolse/react-native';

function App() {
  useAppStateLifecycle();
  return <PoolseProvider config={config}>{/* ... */}</PoolseProvider>;
}
```

Closes the SDK WebSocket cleanly when the app backgrounds (iOS /
Android suspend sockets aggressively — keeping them open wastes
battery and produces no benefit). Reopens on foreground and triggers
a tail refetch on the currently-mounted `<ConversationView>` so the
user lands on a fresh state instead of catching up via stale
realtime.

Pair with push notifications on your backend (subscribe to
`message.created` / `mention.created` webhooks, fan out via APNs /
FCM / Expo's push service) — that's how the user learns about new
messages while the app is closed.

## Identity model

Same SDK 2.0 contract as the web side. All component props that
deal with users are keyed by your `external_id`:

- `useUser(externalId)`, `useDisplayName(externalId)`
- `<UserName externalId={message.sender_external_id} />`
- `<MemberList labelFor={(externalId) => ...} avatarFor={(externalId) => ...} onlineExternalIds={set} />`
- `<MessageBubble>` / `<MessageComposer>` / `<MentionInput>` / `<TypingIndicator>` — every `labelFor` is `(externalId) => string`.

The wire still carries `user_id` (the poolse uuid) alongside
`external_id`, but day-to-day app code never has to touch it.

## Differences from `@poolse/react-ui`

| Concern             | Web (`react-ui`)              | Native (`react-native`)                      |
| ------------------- | ----------------------------- | -------------------------------------------- |
| Styling             | CSS variables in `styles.css` | JS theme via `<PoolseTheme>`                 |
| Action menu trigger | Hover                         | Long-press                                   |
| Reaction picker     | Inline popover                | Modal sheet                                  |
| Mention picker      | Inline dropdown               | Modal sheet                                  |
| Attachment picker   | `<input type=file>`           | `expo-image-picker` + `expo-document-picker` |
| Message list        | Reversed CSS flexbox          | Inverted `FlatList`                          |
| Markdown            | `react-markdown`              | Plain text in 0.1 (markdown coming in 0.2)   |

Everything else — feature flags, prop names, callback shapes,
hook signatures — is intentionally identical so a web codebase
ports across with mostly mechanical changes.
