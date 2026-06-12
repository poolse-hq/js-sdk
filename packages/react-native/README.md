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
npx expo install \
  @poolse/sdk @poolse/react @poolse/react-native \
  react-native-svg \
  react-native-markdown-display \
  react-native-safe-area-context \
  expo-clipboard \
  expo-image-picker \
  expo-document-picker \
  expo-image-manipulator
```

Use `npx expo install` (not plain `npm install`) so each module is
pinned to a version compatible with your Expo SDK. On bare React
Native without the Expo CLI, swap it for `npm install` and pin
versions yourself.

**All peer dependencies are required.** The chat surface eagerly
imports each one at module-load time (Metro can't follow `try /
require`, so we don't try — see `2.1.1` release notes). If any peer
is missing the bundle blows up the first time you mount
`<ConversationView>` / `<PoolseInbox>` with "Requiring unknown
module …".

| Peer                             | What it powers                                                                                                                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react-native-svg`               | All `<PoolseIcon>` glyphs (send, reply, reactions, chevrons).                                                                                                                                                                                 |
| `react-native-markdown-display`  | Bold / italic / code / clickable links inside message bubbles. Disable with `markdown={false}` on `<ConversationView>` if you don't want it — the import still ships in the bundle.                                                           |
| `react-native-safe-area-context` | Composer bottom inset when the keyboard is closed, and the `keyboardVerticalOffset` math `<PoolseInbox>` does for its header. Falls back to hardcoded iOS 50/34 constants if missing — usable, but wrong on devices with non-standard insets. |
| `expo-clipboard`                 | The Copy action in the long-press message menu.                                                                                                                                                                                               |
| `expo-image-picker`              | Camera + Photo-library entries in `<AttachmentPicker>`.                                                                                                                                                                                       |
| `expo-document-picker`           | File entry in `<AttachmentPicker>`.                                                                                                                                                                                                           |
| `expo-image-manipulator`         | WebP resize + compress on picked photos before upload (keeps payloads under ~250 KB).                                                                                                                                                         |

**iOS Info.plist** (`app.json` → `ios.infoPlist`):

```json
{
  "NSCameraUsageDescription": "Take photos to send in chat.",
  "NSPhotoLibraryUsageDescription": "Pick photos to send in chat."
}
```

Pass `camera={false}` to `<AttachmentPicker>` if you want to skip
the camera entry (and Apple's review burden for `NSCameraUsageDescription`).

**App root** — wrap once with `<SafeAreaProvider>` and `<PoolseProvider>`:

```tsx
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PoolseProvider } from '@poolse/react';

export default function App() {
  return (
    <SafeAreaProvider>
      <PoolseProvider config={{ getToken: ..., apiUrl: ... }}>
        <YourScreens />
      </PoolseProvider>
    </SafeAreaProvider>
  );
}
```

## Quick start

The drop-in inbox — list + detail with a slide animation between them, edge-swipe back, plus built-in pickers when you provide a user directory:

```tsx
import { PoolseProvider } from '@poolse/react';
import { PoolseInbox, PoolseTheme } from '@poolse/react-native';

const users = [
  { externalId: 'alice', name: 'Alice', avatarUrl: 'https://…' },
  { externalId: 'bob', name: 'Bob', avatarUrl: 'https://…' },
];

export default function InboxScreen() {
  return (
    <PoolseProvider config={{ getToken, userResolver }}>
      <PoolseTheme>
        <PoolseInbox
          title="Chats"
          users={users}
          labelFor={(externalId) =>
            users.find((u) => u.externalId === externalId)?.name ?? externalId
          }
          avatarFor={(externalId) =>
            users.find((u) => u.externalId === externalId)?.avatarUrl ?? null
          }
        />
      </PoolseTheme>
    </PoolseProvider>
  );
}
```

If you'd rather render a single conversation (your app already owns the navigation), use `<ConversationView>` directly:

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

The same `<PoolseProvider>` you use on web. Wrap it once at the app root if you have multiple chat screens. Drop the `<PoolseTheme>` wrapper if you don't need to override the brand defaults — every component has a fallback theme baked in.

## What ships

| Component                                     | What it does                                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<PoolseInbox>`                               | Full inbox shell — list + detail with an iOS-style slide animation between them, left-edge-swipe-back to return to the list, built-in `New chat` / `New group` picker sheets when `users` is provided. Imperative ref API: `open`, `openDirect`, `openGroup`, `promptNewChat`, `promptNewGroup`, `close`. |
| `<ChatHeader>`                                | Title bar — direct chats resolve the other member's name + avatar via `labelFor` / `avatarFor`, groups show member count, presence-driven green dot. Optional `onBack` button.                                                                                                                            |
| `<ConversationView>`                          | Composed chat surface — message list + composer + typing strip + thread modal. Single `KeyboardAvoidingView` covers the whole thing so the composer stays above the keyboard on both platforms.                                                                                                           |
| `<ThreadView>`                                | Bottom-sheet modal for thread replies. Reactions + attachments + pull-down-to-close via a 60-pt header drag strip. Composer reuses the same `UploadProvider` queue as the picker.                                                                                                                         |
| `<GroupDetailsSheet>`                         | Bottom sheet showing a group's name, avatar, and member roster with presence. Opened from `<ChatHeader>`'s members button.                                                                                                                                                                                |
| `<MessageBubble>` / `<EditableMessageBubble>` | Single message render — body, meta, read receipt, quoted card, in-bubble attachments.                                                                                                                                                                                                                     |
| `<MessageRow>`                                | Bubble + alignment + swipe-to-reply (capture-phase, 1:1 finger follow, sqrt-damped past 50pt threshold).                                                                                                                                                                                                  |
| `<MessageList>`                               | Inverted `FlatList` wrapper — stick-to-bottom, hold-position, auto-load-more.                                                                                                                                                                                                                             |
| `<MessageComposer>`                           | Text input with auto-grow, send button, attach button, quote chip.                                                                                                                                                                                                                                        |
| `<MessageActions>`                            | Long-press menu (reply / quote / edit / delete / copy / react).                                                                                                                                                                                                                                           |
| `<TypingIndicator>`                           | Animated three-dot indicator + labels.                                                                                                                                                                                                                                                                    |
| `<ConversationList>`                          | `FlatList` of conversation rows. Direct rows pull the other member's name + avatar via `labelFor` / `avatarFor`; preview reads `last_message_preview` updated in realtime by the SDK's `conversation:updated` subscription. Unread badges.                                                                |
| `<MemberList>`                                | Member roster with avatars + remove action.                                                                                                                                                                                                                                                               |
| `<MentionInput>`                              | `TextInput` + autocomplete popover.                                                                                                                                                                                                                                                                       |
| `<ReactionStrip>` / `<ReactionPicker>`        | Reaction summary + emoji picker sheet.                                                                                                                                                                                                                                                                    |
| `<AttachmentPreview>` / `<AttachmentPicker>`  | Image or file card. Picker wraps `expo-image-picker` + `expo-document-picker`.                                                                                                                                                                                                                            |
| `<UploadQueueStrip>`                          | Pending uploads with cancel.                                                                                                                                                                                                                                                                              |
| `<UserName>` / `useDisplayName(externalId)`   | Display name resolution via the SDK's `userResolver`.                                                                                                                                                                                                                                                     |
| `<Avatar>`                                    | Initials + URL fallback, stable color per user.                                                                                                                                                                                                                                                           |
| `<PoolseIcon>` / `<PoolseLogo>`               | Brand chrome via `react-native-svg`.                                                                                                                                                                                                                                                                      |

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
| Markdown            | `react-markdown`              | Plain text                                   |

Everything else — feature flags, prop names, callback shapes, hook signatures — is intentionally identical so a web codebase ports across with mostly mechanical changes.

## Links

- Docs: [poolse.dev/docs/sdk/react-native](https://poolse.dev/docs/sdk/react-native)
- Source: [github.com/poolse-hq/js-sdk](https://github.com/poolse-hq/js-sdk/tree/main/packages/react-native)
- Web sibling: [`@poolse/react-ui`](https://www.npmjs.com/package/@poolse/react-ui)
- Hooks (used internally): [`@poolse/react`](https://www.npmjs.com/package/@poolse/react)
- Core client: [`@poolse/sdk`](https://www.npmjs.com/package/@poolse/sdk)

## License

MIT
