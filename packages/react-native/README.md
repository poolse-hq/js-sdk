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

## Theming

```tsx
<PoolseTheme mode="dark" theme={{ colors: { brand: '#ff5733' }, radii: { bubble: 18 } }}>
  {children}
</PoolseTheme>
```

Overrides merge over the light or dark base theme one group at a time
(`colors`, `type`, `radii`, `spacing`, `shadows`). `mode` doesn't follow the
system by itself; pass `useColorScheme()` if you want that. Read the active
theme with `usePoolseTheme()`.

## Links

- Docs: <https://poolse.dev/docs/sdk/react-native>
- Source: <https://github.com/poolse-hq/js-sdk>

## License

Licensed under the [poolse SDK License](./LICENSE) from 3.0.0; versions
before 3.0.0 remain MIT.
