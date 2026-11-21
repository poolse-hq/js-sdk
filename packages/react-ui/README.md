# `@poolse/react-ui`

Prebuilt React web components for [poolse](https://poolse.dev):
`<PoolseInbox>` for a whole inbox, `<ConversationView>` for one chat, room UI,
and the pieces they are built from. Themed with CSS variables. Built on
[`@poolse/react`](https://www.npmjs.com/package/@poolse/react).

Full reference: <https://poolse.dev/docs/sdk/react-ui>

## Install

```bash
npm install @poolse/react-ui @poolse/react @poolse/sdk
```

```tsx
import '@poolse/react-ui/styles.css';
```

Peer: `react` ≥ 18. The build starts with `'use client'`. Rooms also need
`livekit-client` in your app.

## Quick start

```tsx
'use client';

import '@poolse/react-ui/styles.css';
import { PoolseProvider } from '@poolse/react';
import { ConversationView } from '@poolse/react-ui';

export function Chat({ conversationId }: { conversationId: string }) {
  return (
    <PoolseProvider config={config}>
      <div style={{ height: '100vh' }}>
        <ConversationView conversationId={conversationId} />
      </div>
    </PoolseProvider>
  );
}
```

`ConversationView` feature flags, all on by default: `reactions`,
`mentions`, `attachments`, `actions`, `threads`, `quotations`,
`readReceipts`, `markdown`, `grouping`, `daySeparators`. Other props:
`labelFor`, `renderMessage`, `emptyState`, `loadFonts`, `maxBodyLength`
(200), `groupingWindowMs` (300000), `senderLabels` and `avatars`
(`'auto' | 'always' | 'never'`), `onMarkedRead`, `onCallBack`,
`onJoinCall`, `currentCallId`, `focusMessageId` and
`onFocusMessageNotFound`, `onSenderPress` and `onAvatarPress` (receive a
`MessageUser`: `{ userId, externalId, displayName, avatarUrl }`), and
`composer={false}` (or `readOnly`) to hide the composer.

The view marks the latest message read while it's in view; once the server
accepts, every `ConversationList` / `useConversations()` under the same
provider drops that conversation's badge. `focusMessageId` loads older pages
until the message is there, scrolls to it and flashes it; a message it can't
find shows a short notice and calls `onFocusMessageNotFound`.

## Layouts

```tsx
<ConversationView conversationId={id} layout="list" density="compact" timeFormat="24h" />
```

- `layout="bubbles"` (default) — chat bubbles, yours on the right.
- `layout="list"` — Slack-style rows: avatar, name and time once per run of
  messages (`groupWindowMinutes`, default 5), the time on hover for the rest, a
  hover toolbar (React · Reply · Thread · More), "N replies" under threads.
- `layout="compact"` — Discord/IRC-style lines: time, the sender's name in
  their colour, the text; `showAvatars` adds small avatars. Messages that
  mention you get an accent bar (also in `list`).

Reactions, threads, quotes, edits, deletes, attachments, read receipts, typing,
the new-messages button, `focusMessageId` and `onSenderPress` /
`onAvatarPress` work the same in all three. To change one part of every
message, pass `slots={{ header, body, attachments, reactions, thread, actions }}`
— each is `(props) => ReactNode` and gets the default rendering as `children`.
`renderMessage(msg, meId, { layout, renderDefault })` replaces whole rows.

## Components

- Composed: `PoolseInbox` (with a ref: `open`, `openDirect`, `openGroup`,
  `promptNewChat`, `promptNewGroup`, `close`), `ConversationView`,
  `ChatHeader`, `ThreadView`.
- Sheets: `UserPickerSheet`, `GroupDetailsSheet`.
- Messages: `MessageBubble`, `EditableMessageBubble`, `MessageActions`,
  `TypingIndicator`, `CallLogRow`, `LiveCallBanner`.
- Composer: `MessageComposer` (ref: `addFiles`), `MentionInput`,
  `UploadQueueStrip`, `AttachmentPreview`.
- Lists: `ConversationList`, `MemberList`.
- Reactions: `ReactionStrip`, `ReactionPicker`.
- Rooms and calls: `RoomJoinBar`, `RoomStage` (both take `useRoom()` from
  `@poolse/react`), `CallVideoGrid`, `CallControlButton`, `CallDeviceMenu`.
- Identity and brand: `Avatar`, `UserName`, `useDisplayName`, `PoolseIcon`,
  `PoolseLogo`, `PoolseFonts`, `usePoolseFonts`.
- Theme: `PoolseTheme`, `useTheme`, `useSystemColorScheme`.

Every `labelFor` / `avatarFor` takes your user id (`external_id`), except on
`CallVideoGrid` and `RoomStage`, where it takes the poolse user id.

## Theming

Wrap the UI in `PoolseTheme` to use one of the eight built-in themes from
[`@poolse/theme`](../theme) — `coral` (default), `ocean`, `forest`, `grape`,
`slate`, `sunset`, `rose`, `mono` — or your own:

```tsx
import { PoolseTheme } from '@poolse/react-ui';

<PoolseTheme theme="ocean" colorScheme="system">
  <PoolseInbox />
</PoolseTheme>;
```

`theme` takes a built-in id or a `Theme` (`createTheme`, `decodeTheme` for a
shared theme code); `colorScheme` is `'light'`, `'dark'` or `'system'`
(default, follows the OS live). Changing either restyles in place — nothing
remounts. The variables are set on `PoolseTheme`'s own wrapper
(`display: contents`), not on `:root`, so differently themed chats can share a
page. `useTheme()` returns the active theme's tokens and scheme. Without
`theme`, nothing is set and the stylesheet's own colours apply.

Or override the `--poolse-*` CSS variables (`--poolse-brand`,
`--poolse-brand-soft`, `--poolse-ink`, `--poolse-surface`,
`--poolse-radius-md`, `--poolse-font-body`, …). Dark mode follows
`prefers-color-scheme`; force it with `data-theme="dark"` or
`data-theme="light"` on any ancestor. The full list is in the docs.

## Links

- Docs: <https://poolse.dev/docs/sdk/react-ui>
- Source: <https://github.com/poolse-hq/js-sdk>

## License

Licensed under the [poolse SDK License](./LICENSE) from 3.0.0; versions
before 3.0.0 remain MIT.
