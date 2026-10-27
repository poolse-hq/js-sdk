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
`onJoinCall`, `currentCallId`.

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

Every `labelFor` / `avatarFor` takes your user id (`external_id`), except on
`CallVideoGrid` and `RoomStage`, where it takes the poolse user id.

## Theming

Override the `--poolse-*` CSS variables (`--poolse-brand`,
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
