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

## Chat features

- **Presence.** `<Avatar presence>` takes a state (`'online' | 'away' |
'in_call' | 'offline'`), a `Presence`, or `true` with `userId` to look it up
  live; `<PresenceBadge state doNotDisturb>` is the badge alone. Direct rows in
  `ConversationList`, `ChatHeader` (with "Online" / "Away" / "In a call" /
  "Last seen …") and `MemberList` show it; turn it off with
  `showPresence={false}`. `ConversationView showPresence` adds it to message
  avatars (off by default).
- **Link previews** show under the text in every layout (`linkPreviews`,
  default on); the sender can remove one with its ×. `<LinkPreviewCard
preview>` draws one on its own.
- **Thread summaries** under thread roots: stacked participant avatars, "N
  replies · last reply 5m ago"; click opens the thread (`<ThreadSummary>`).
- **Edit history.** "edited" opens the earlier versions (`messages.edits`);
  people the server doesn't show history to (403) see plain text.
- **Emoji.** `<EmojiPicker>` (search, recent, categories; its data loads on
  first open) behind the reaction "+" and a composer button
  (`emojiPicker={false}` hides it).
- **Uploads**: the paperclip, pasting into the composer, or dropping on the
  conversation; chips (with image thumbnails) until sent. `maxFileSize` and
  `acceptFileTypes` refuse other files with an error chip.
- **Drafts** per conversation (text and quote) survive switching and reloads;
  `persistDrafts={false}` turns them off, `draftStorage={{ get, set, remove }}`
  stores them elsewhere.
- **Unread.** A "New messages" divider above the first unread message (from
  where you'd read to when you opened the conversation), a "Jump to first
  unread" pill while it's off-screen, and a "Mark unread" action on others'
  messages.
- **ConversationList** pages itself as it's scrolled (`useConversations().loadMore`),
  takes `density="compact"`, `groupBy="type"` or `sections={[{ title, filter }]}`,
  a `header`, and the theme's sidebar colours.
- **Deleted messages** read "This message was deleted" and keep their thread
  link; quotes of them read "Original message deleted". A send refused with
  `quoted_message_deleted` shows a notice and puts the text back.

## Keyboard, offline, empty states, accessibility

- **Shortcuts**, scoped to the focused component so an app's own (Cmd+K,
  Cmd+[ …) never collide and two views side by side don't hear each other.
  Composer: Enter sends (`sendOn="mod+enter"`: Enter is a new line,
  Cmd/Ctrl+Enter sends), Shift+Enter new line, ↑ in an empty composer edits
  your last message, Esc cancels the reply. Message list (Tab into it): j / k
  or ↓ / ↑, Home / End, r reply, t thread, e edit, Delete (yours, after
  `confirmDelete`, default `window.confirm`), Esc back to the composer.
  `keymap={{ messageList: { reply: ['q'] }, composer: { editLast: [] } }}`
  overrides (`[]` turns one off); `keyboardShortcuts={false}` turns the list
  ones off. `DEFAULT_KEYMAP`, `resolveKeymap`, `matchesKey` are exported for
  a shortcut sheet. `MessageComposer` / `MentionInput` take `keymap` and
  `onEditLast`.
- **Unsent messages**: queued (offline) rows read "Waiting for network…" with
  "Send now"; refused ones "Not sent: …" with Retry and Delete
  (`<SendStatus>`). The composer clears either way.
- **Empty states** that say what to do next (`<EmptyState title hint action>`):
  empty channel (`emptyState` — a node, or `({ readOnly }) => node`),
  conversation list (`emptyState`), `ConversationList query="…"` with no
  matches (`noResultsState`), an empty thread.
- **Drafts** are per client (server + user): key
  `<client.namespace>:draft:<conversationId>` (the pre-3.8
  `poolse:draft:<user>:<conversation>` is moved on first read);
  `client.destroy({ clearStorage: true })` removes them.
- **Accessibility**: message rows are `article`s named "Message from …" and
  focusable for the list shortcuts; the composer textarea is labelled and
  announces mention suggestions (`aria-autocomplete`, `aria-activedescendant`);
  reduced motion turns off animation and smooth scrolling. `test/a11y.test.tsx`
  runs axe-core over ConversationView (full and empty), ConversationList
  (rows, sections, empty), ThreadView, MemberList and a failed send; colour
  contrast is covered by the theme's own contrast tests.

## Components

- Composed: `PoolseInbox` (with a ref: `open`, `openDirect`, `openGroup`,
  `promptNewChat`, `promptNewGroup`, `close`), `ConversationView`,
  `ChatHeader`, `ThreadView`.
- Sheets: `UserPickerSheet`, `GroupDetailsSheet`.
- Messages: `MessageBubble`, `EditableMessageBubble`, `MessageActions`,
  `TypingIndicator`, `CallLogRow`, `LiveCallBanner`.
- Composer: `MessageComposer` (ref: `addFiles`, `getText`, `setText`,
  `focus`), `MentionInput`, `UploadQueueStrip`, `AttachmentPreview`.
- Rich content: `LinkPreviewCard`.
- Lists: `ConversationList`, `MemberList`.
- Reactions and emoji: `ReactionStrip`, `ReactionPicker`, `EmojiPicker`.
- Rooms and calls: `RoomJoinBar`, `RoomStage` (both take `useRoom()` from
  `@poolse/react`; `RoomStage` shows recording state and the consent prompt
  — `capture`, default on — and a Record control with `allowRecord`),
  `CallVideoGrid`, `CallControlButton`, `CallDeviceMenu`.
- Recording and transcripts: `RecordingBanner`, `RecordingIndicator`,
  `ConsentPrompt`, `RecordingNoticeRow` (rendered by `MessageRow`),
  `LiveTranscriptPanel`, `TranscriptViewer`. See below.
- Identity and brand: `Avatar`, `PresenceBadge`, `UserName`, `useDisplayName`, `PoolseIcon`,
  `PoolseLogo`, `PoolseFonts`, `usePoolseFonts`.
- Theme: `PoolseTheme`, `useTheme`, `useSystemColorScheme`.

Every `labelFor` / `avatarFor` takes your user id (`external_id`), except on
`CallVideoGrid` and `RoomStage`, where it takes the poolse user id.

## Recording, consent and transcripts

```tsx
const rec = useRecording(call.id, call.conversation_id, call);
const media = useCallRoom(call.conversation_id, { livekit });

<RecordingBanner
  recording={rec.active}
  transcribing={!!rec.transcription?.active}
  mode={rec.recording?.mode}
  consentRequired={rec.consentRequired}
  myConsent={rec.myConsent}
  onStop={() => void rec.stop()}
/>
{rec.needsConsent && (
  <ConsentPrompt
    recording={rec.active}
    transcribing={!!rec.transcription?.active}
    onAnswer={rec.consent}
    onAccepted={() => void media.republish()} // CallRoom also does it by itself
  />
)}
<LiveTranscriptPanel callId={call.id} onClose={…} />
<TranscriptViewer callId={pastCallId} onSeek={(ms) => …} />
```

`ConsentPrompt` fills the nearest positioned ancestor with a scrim
(`overlay={false}` for the card alone). `TranscriptViewer` searches within the
transcript (accent- and case-insensitive, Enter / Shift+Enter between hits)
and renames speakers for people who were in the call (others get an
explanation). The recording notice in the chat is a centred line like a call
log, naming people through `MessageRow`'s `nameForUserId`.

## Agents and meetings

```tsx
<ConversationView
  conversationId={id}
  onOpenCitation={(c, msg) => …} // message sources here are focused by default
  onOpenMoment={(callId, startMs) => openRecording(callId, startMs)}
/>
<ApprovalList />                          // everything waiting for your answer
<AskMeetings onOpenMoment={openRecording} />
<RecordingPlayer ref={player} recording={rec} startMs={momentMs} />
```

- **Agent badge (AG1).** `<AgentBadge>`; `<Avatar agent>` (rounded square,
  "(agent)" in its label); `UserName`, member rows, mention suggestions,
  sender labels and a DM's header add it by themselves for anyone the server
  marked `is_agent`.
- **Approvals (AG4).** `agent_approval` messages render as `<ApprovalCard>`:
  summary, details (first 4, "Show all"), Approve / Deny, an optional reason,
  then Approved / Denied / Expired. The card follows the shared store, so
  `<ApprovalList>` and other devices stay in step.
- **Sources (AG5).** `<MessageCitations>` under an assistant's answer, numbered
  links (meeting sources show their time).
- **Summaries (RT6).** `call_summary` messages render as `<SummaryCard>`:
  decisions, action items with the assignee's name and due date, open
  questions, and key moments that call `onOpenMoment`.
- **Clips (RT9).** Attachments with `clip` play inline in `<ClipPlayer>`; or
  `<ClipPlayer clip={{ recordingId, startMs, endMs }}>` plays that range of a
  recording.
- **Playback (RT13).** `<RecordingPlayer recording>` — HTML5 media, 1× / 1.25× /
  1.5× / 2×, "Skip silence" when the recording lists silences, chapters, and
  the transcript scrolling along (tap a line to play from it). Expired links
  renew by themselves. `ref.seek(ms)` takes transcript time.
- Custom layouts wrap rows in `<MessageExtrasProvider value={{ onOpenCitation,
  onOpenMoment, nameForUserId, externalIdForUserId }}>`.

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
