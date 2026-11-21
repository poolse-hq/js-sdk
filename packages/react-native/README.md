# `@poolse/react-native`

Prebuilt React Native and Expo chat components for
[poolse](https://poolse.dev): `<PoolseInbox>`, `<ConversationView>` and the
pieces they are built from, a JS theme, the app-lifecycle hook, and building
blocks for a call screen. Built on
[`@poolse/react`](https://www.npmjs.com/package/@poolse/react).

Calls on phones (ringing a locked phone, CallKit, the Android call service)
are in [`@poolse/native`](https://www.npmjs.com/package/@poolse/native).

Full reference: <https://poolse.dev/docs/sdk/react-native>

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

Every peer is required: the package imports each one when it loads, so a
missing one breaks the bundle. Peer ranges: `react` ≥ 18, `react-native` ≥
0.73, `react-native-svg` ≥ 14, `react-native-safe-area-context` ≥ 4,
`react-native-markdown-display` ≥ 7, any `expo-*` version.

iOS needs `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription` in
`ios.infoPlist` for the attachment picker.

## Quick start

```tsx
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { PoolseProvider } from '@poolse/react';
import { PoolseInbox, PoolseTheme, useAppStateLifecycle } from '@poolse/react-native';

export default function App() {
  return (
    <SafeAreaProvider>
      <PoolseProvider config={config}>
        <ChatRoot />
      </PoolseProvider>
    </SafeAreaProvider>
  );
}

function ChatRoot() {
  useAppStateLifecycle(); // inside the provider
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <PoolseTheme>
        <PoolseInbox title="Chats" users={users} labelFor={labelFor} avatarFor={avatarFor} />
      </PoolseTheme>
    </SafeAreaView>
  );
}
```

To show one conversation inside your own navigation, render
`<ConversationView conversationId={id} keyboardOffset={headerHeight} />`.

`ConversationView` marks messages read as they arrive, which clears the
conversation's badge in every `useConversations()` / `ConversationList` under
the same provider; `readReceipts={false}` only hides the ticks. Other props:
`focusMessageId` (load older pages until the message is there, scroll to it and
highlight it) with `onFocusMessageNotFound`, `onSenderPress` and
`onAvatarPress` (receive a `MessageUser`:
`{ userId, externalId, displayName, avatarUrl }`), and `composer={false}` (or
`readOnly`) to hide the composer. Tapping a quoted message jumps to the
original.

## `useAppStateLifecycle()`

Call it once inside `<PoolseProvider>`. From 3.1 it pauses the socket when
the app goes to the background and resumes it when the app becomes active;
channels and listeners survive, and `useMessages` / `useConversations`
reload from REST after the reconnect. The iOS `inactive` state doesn't pause
anything. (In 3.0 it destroyed every channel instead, which left mounted
hooks silent until they remounted.)

## Components

- Composed: `PoolseInbox` (ref: `open`, `openDirect`, `openGroup`,
  `promptNewChat`, `promptNewGroup`, `close`), `ConversationView`,
  `ChatHeader`, `ThreadView` (bottom sheet), `GroupDetailsSheet`.
- Messages: `MessageList`, `MessageRow`, `MessageBubble`, `MessageActions`
  (long-press sheet), `TypingIndicator`, `DaySeparator`, `CallLogRow`,
  `LiveCallBanner`, `ImageMosaic`.
- Composer: `MessageComposer`, `MentionInput`, `AttachmentPicker`,
  `UploadQueueStrip`, `AttachmentPreview`. `AttachmentPicker` declares the
  size of the bytes it uploads; a custom `onPickInputs` must set `byteSize`
  to the size of `body`, because the server refuses a file bigger than
  declared.
- Lists: `ConversationList`, `MemberList`.
- Reactions: `ReactionStrip`, `ReactionPicker`.
- Identity and brand: `UserName`, `useDisplayName`, `Avatar`, `PoolseIcon`,
  `PoolseLogo`, `Primitives`.
- Call screen: `CallControlButton`, `CallAvatar`, `AudioRouteSheet`,
  `callColors`, `useCallDuration`.

The names follow `@poolse/react-ui`, but the props differ in places (for
example `ThreadView` needs `visible` and `onClose`, and there is no
`EditableMessageBubble`); see the docs for each component's props.

## Layouts

```tsx
<ConversationView conversationId={id} layout="list" density="compact" timeFormat="24h" />
```

`layout` is `'bubbles'` (default), `'list'` (Slack-style rows: avatar, name and
time once per run of messages, `groupWindowMinutes` apart at most) or
`'compact'` (IRC-style lines: time, coloured name, text). Long-press opens the
same actions sheet in every layout, and reactions, threads, quotes, edits,
deletes, attachments, read ticks, typing, the new-messages button,
`focusMessageId` and `onSenderPress` / `onAvatarPress` behave the same. Messages
that mention you get an accent bar in `list` and `compact`. Use
`slots={{ header, body, attachments, reactions, thread, actions }}` to replace
or wrap one part of every message (each slot gets the default as `children`),
or `renderMessage(msg, meId, { layout, renderDefault })` for whole rows.

## Theming

```tsx
<PoolseTheme theme="ocean" colorScheme="system">
  {children}
</PoolseTheme>
```

`theme` takes one of the eight built-in themes from
[`@poolse/theme`](../theme) — `coral` (default), `ocean`, `forest`, `grape`,
`slate`, `sunset`, `rose`, `mono` — or a `Theme` (`createTheme`, or
`decodeTheme` for a shared theme code). `colorScheme` is `'light'`, `'dark'` or
`'system'` (follows the OS live; the default when `theme` is given). Switching
either re-renders in place; nothing remounts. React Native can't use the web
font stacks, so themes use the platform fonts unless you pass
`fonts={{ body: 'Inter', display: 'Inter', mono: 'JetBrainsMono' }}` with
names you loaded via expo-font.

Every component reads its colours, fonts, radii, spacing and shadows from
`useTheme()`, which returns the active tokens (`colors.accent`,
`colors.ownBubble`, `fonts.body`, `fonts.lineHeight` in px, `radii.bubble`,
`shadows.md` as a style, …). Use it in your own components too.

Without `theme`, the original palette is used (light unless `colorScheme` or
`mode` says otherwise). The original override form still works but is
deprecated:

```tsx
<PoolseTheme mode="dark" theme={{ colors: { brand: '#ff5733' }, radii: { bubble: 18 } }}>
  {children}
</PoolseTheme>
```

Overrides merge over the light or dark base palette one group at a time
(`colors`, `type`, `radii`, `spacing`, `shadows`); `usePoolseTheme()` still
returns that original shape.

## Links

- Docs: <https://poolse.dev/docs/sdk/react-native>
- Source: <https://github.com/poolse-hq/js-sdk>

## License

Licensed under the [poolse SDK License](./LICENSE) from 3.0.0; versions
before 3.0.0 remain MIT.
