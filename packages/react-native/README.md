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

### Chat features

```tsx
<ConversationView
  conversationId={id}
  showPresence
  draftStorage={{
    get: (k) => storage.getString(k), // MMKV, AsyncStorage, …
    set: (k, v) => storage.set(k, v),
    remove: (k) => storage.delete(k),
  }}
  maxFileSize={25 * 1024 * 1024}
  acceptedFileTypes={['image/*', 'application/pdf']}
/>
```

- **Drafts.** Unsent text and the quote target stay with each conversation
  while you switch (in memory, always). With `draftStorage` (`get` / `set` /
  `remove` over strings, sync or async) they are also saved under
  `poolse:draft:<conversationId>` and come back after a restart;
  `persistDrafts={false}` keeps them in memory only. Sending clears them.
- **New messages.** A "New messages" line sits above the first message that
  was unread when the conversation opened; while it is off screen a pill jumps
  to it, loading older pages as needed. `newMessagesDivider={false}` turns
  both off.
- **Mark unread.** Long-press someone else's message → "Mark unread"
  (`conversations.one(id).markUnread(messageId)`); the view stops marking
  messages read until you send or reopen it. `markUnread={false}` hides it;
  `onMarkedUnread(conversationId, messageId)` fires after it succeeds.
- **Link previews.** `message.link_previews` show as `<LinkPreviewCard>`s under
  the text (website: image, site name and favicon, title, description; image
  links inline), and tapping opens the link. The sender can long-press →
  "Remove preview". `linkPreviews={false}` turns them off.
- **Deleted messages** read "This message was deleted" without actions,
  reactions or quoting; their thread link stays. Quotes of a deleted message
  read "Original message deleted". A send whose quote was deleted meanwhile
  shows "The message you replied to was deleted." and keeps your text.
- **Threads** show as "3 replies · last reply 5m ago" with the last repliers'
  avatars (`<ThreadSummary>`); tap opens the thread.
- **Edit history.** Tap "edited" to see earlier versions (`<EditHistorySheet>`,
  `chat.messages.edits`); when the workspace keeps history from you (403) the
  label stops offering it.
- **Emoji.** A built-in `<EmojiPicker>` (search, recently used, categories; no
  extra dependency) opens from the composer's emoji button
  (`emojiPicker={false}` hides it), from "+" in the long-press reactions and
  after a message's reaction chips.
- **Mentions.** Type `@` in `<MentionInput>` (the default composer) to get
  matching members above the input; picking one inserts `@Name` and sends
  their id in `mentions`.
- **Attachments.** Camera, photo library (several at once) and files, with
  previews before sending. `maxFileSize` / `acceptedFileTypes` (MIME types,
  `'image/*'`, or `'.pdf'`) refuse files with a message; so does a denied
  camera permission. Needs `expo-image-picker`, `expo-document-picker` and
  `expo-image-manipulator` (pass `attachments={false}` to leave them out).
- **Presence.** `showPresence` adds badges to message avatars; the header of a
  direct chat says "Online", "Away", "In a call" or "Last seen 5m ago".

### Presence

`<PresenceBadge state doNotDisturb>` draws online (`success`), away
(`warning`), in a call (`accent` with a phone) or do not disturb (a moon), and
nothing for offline. `<Avatar presence="online">` takes a state, or
`presence={true}` to look the user up live with `useUserPresence` (by
`userId`, else `seed`). `ConversationList`, `PoolseInbox` and `MemberList`
show badges by default (`showPresence={false}` to hide).

## `useAppStateLifecycle()`

Call it once inside `<PoolseProvider>`. From 3.1 it pauses the socket when
the app goes to the background and resumes it when the app becomes active;
channels and listeners survive, and `useMessages` / `useConversations`
reload from REST after the reconnect. The iOS `inactive` state doesn't pause
anything. (In 3.0 it destroyed every channel instead, which left mounted
hooks silent until they remounted.)

It also reports the device as `active` / `idle` for presence
(`presence.setActivity`), so others see you as away while the app is in the
background; `useAppStateLifecycle({ presence: false })` leaves that out.
`useAppStatePresence()` does only that part, and `<PoolseInbox>` does it by
default (`trackActivity={false}` to stop).

## Several workspaces: `useBackgroundClients()`

With more than one workspace signed in, keep one `Poolse` per workspace and
call this once, outside the providers, instead of `useAppStateLifecycle`:

```tsx
useBackgroundClients(clients, current, { keepConnected: inCall ? [callClient] : [] });
// Push handler: connect the push's workspace for 30 s.
clientFor(data.tenant_id)?.wake();
```

Only the workspace on screen keeps its socket; the others close theirs
(caches stay warm in memory, so switching is instant) and reconnect when
switched to. With the app in the background every socket closes. Presence
follows the app state on the client on screen (`presence: false` to skip).
`useAppStateLifecycle` now uses `setBackground` too. Unread totals for the
others: `useUnreadTotals(client)` refreshes when a client is woken or
foregrounded.

Drafts are kept per client (namespaced by server + user) and removed by
`client.destroy({ clearStorage: true })`. Unsent messages show "Waiting for
network…" or "Not sent" with Retry / Delete. `ConversationList`,
`ConversationView` and `ThreadView` default to an `EmptyState` that says what
to do next (`ConversationList query` / `noResultsState` for search). Message
rows read as "Ana: text" to VoiceOver/TalkBack with a "Message actions"
accessibility action; reaction chips say "👍 3, you reacted".

## `ConversationList`

```tsx
<ConversationList
  header={<SearchField />}
  groupBy="type" // "Channels", then "Direct messages"
  density="compact"
  onSelect={(c) => open(c.id)}
/>
```

`sections={[{ title, filter }]}` makes your own sections (a conversation goes
to the first one that takes it; empty sections are hidden). The list pages
through `useConversations()` as you scroll; with `conversations` passed in,
give it `hasMore`, `loadingMore` and `onLoadMore`.

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
- Lists: `ConversationList`, `MemberList`, `PresenceBadge`.
- Message parts: `LinkPreviewCard`, `ThreadSummary`, `NewMessagesDivider`,
  `EditHistorySheet`.
- Reactions: `ReactionStrip` (`onMorePress`), `ReactionPicker`, `EmojiPicker`.
- Identity and brand: `UserName`, `useDisplayName`, `Avatar`, `PoolseIcon`,
  `PoolseLogo`, `Primitives`.
- Call screen: `CallControlButton`, `CallAvatar`, `AudioRouteSheet`,
  `callColors`, `useCallDuration`.
- Recording and transcripts: `RecordingBanner`, `RecordingIndicator`,
  `ConsentPrompt`, `RecordingNoticeRow` (rendered by `MessageRow`),
  `LiveTranscriptPanel`, `TranscriptViewer` — the same props as
  `@poolse/react-ui`, with `style` for `className`. Drive them with
  `useRecording` / `useLiveTranscript` / `useTranscript` from
  `@poolse/react`. Calls on phones run in the native call core: after
  `ConsentPrompt`'s `onAccepted`, turn the microphone (and camera) back on
  there — the server lets you publish again, but the tracks were
  unpublished. Hide participants whose identity starts with `poolse:`
  (`isServiceParticipant`).

- Agents and meetings: `AgentBadge`, `ApprovalCard`, `MessageApproval`,
  `ApprovalList`, `MessageCitations`, `SummaryCard`, `AskMeetings`,
  `ClipPlayer`, `RecordingPlayer` — the same props as `@poolse/react-ui`.
  The approval card shows under an agent message with
  `agent_meta.approval_id`; `call_summary` messages render as cards;
  `ConversationView` takes `onOpenCitation`, `onOpenMoment(moment)` and
  `renderMedia`.

**Playing recordings and clips.** The package ships no media player. Pass a
`renderMedia` adapter (to `ConversationView`, `MessageExtrasProvider`,
`ClipPlayer` or `RecordingPlayer`) over the player your app uses. With
`expo-video`:

```tsx
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect } from 'react';
import type { PoolseMediaProps } from '@poolse/react-native';

function ExpoMedia({
  uri,
  kind,
  paused,
  rate,
  seek,
  onProgress,
  onLoad,
  onEnd,
  style,
}: PoolseMediaProps) {
  const player = useVideoPlayer(uri, (p) => {
    p.timeUpdateEventInterval = 0.25;
  });
  useEffect(() => (paused ? player.pause() : player.play()), [player, paused]);
  useEffect(() => void (player.playbackRate = rate), [player, rate]);
  useEffect(() => void (seek && (player.currentTime = seek.ms / 1000)), [player, seek?.nonce]);
  useEffect(() => {
    const subs = [
      player.addListener('timeUpdate', (e) => onProgress(e.currentTime * 1000)),
      player.addListener('sourceLoad', (e) => onLoad(e.duration * 1000)),
      player.addListener('playToEnd', onEnd),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [player, onProgress, onLoad, onEnd]);
  return kind === 'video' ? (
    <VideoView player={player} style={style} nativeControls={false} />
  ) : null;
}

<ConversationView conversationId={id} renderMedia={(p) => <ExpoMedia {...p} />} />;
```

Without an adapter a clip shows its time range and the recording player its
chapters and transcript.

The names follow `@poolse/react-ui`, but the props differ in places (for
example `ThreadView` needs `visible` and `onClose`, and there is no
`EditableMessageBubble`); see the docs for each component's props.

## Live meetings

The in-call pieces for stages, Q&A, breakouts, the lobby, the agenda and
meeting cards. Each takes a `@poolse/react` hook's result, so it works
with the JS `CallRoom` (`useCallRoom`) and with `@poolse/native` alike.

```tsx
const stage = useStage(conversationId, callId, me.id);
const questions = useQuestions(conversationId, callId);
const lobby = useLobby(conversationId, callId);

<StagePanel stage={stage} participants={people} selfUserId={me.id} />
<QuestionsPanel questions={questions} canModerate={stage.isModerator} />
<LobbyAdmitList lobby={lobby} />
<BreakoutBanner breakouts={useBreakouts(conversationId, callId)} onJoined={connect} />
<AgendaPanel agenda={useAgenda(conversationId, callId)} canEdit />
<MarkMomentButton moments={useMoments(conversationId, callId)} />
```

`participants` is `{ userId, name?, guest?, avatarUrl? }[]` from your call
roster; names fall back to the `MessageExtrasProvider`'s `nameForUserId`,
then "Someone" — never a raw id. Guests carry a Guest mark.

A guest waiting to be let in (no session; `waitInLobby` from
`@poolse/sdk`):

```tsx
<LobbyWaiting name={guestName} status={status} title="Weekly sync" onLeave={leave} />
```

Overlays for the call screen:

```tsx
const t = useLiveTranscript(callId, { enabled: captionsOn });
{captionsOn && <CaptionsOverlay segments={t.segments} />}

const reactions = useCallReactions(media.room); // JS CallRoom only
<ReactionsOverlay reactions={reactions.reactions} />
<ReactionPickerBar onReact={reactions.send} />

<ConnectionIndicator quality={participant.connectionQuality} />
<NetworkBanner issues={useCallQuality(media.room)?.issues ?? []} />
// @poolse/native: diagnoseCallNetwork({ quality: snap.connectionQuality,
//   reconnecting: snap.phase === 'reconnecting' })
```

The whiteboard and screen annotations are view-only on phones by default
(`WhiteboardView` draws pen strokes when given `model` and `readOnly={false}`):

```tsx
import * as Y from 'yjs';
const board = useWhiteboard(callId, Y, { selfUserId: me.id });
<WhiteboardView items={board.items} />

<View>
  <CallVideoView source="screen" fit="contain" />
  <AnnotationOverlay state={useScreenAnnotations(media.room, sharerId).state} />
</View>
```

Meeting invites in chat: `meetingCardOf(msg)` reads the card; RSVPs go to
`PUT /meetings/:id/rsvp` through the provider's client (pass `onRsvp` to
record them elsewhere), and the card follows the server's restatement of
the message. Guests and phones are named by the call ("Phone ···1234"),
never by id; `RoomPresence` takes `useRoomPresence().presence[id]`.

```tsx
<MeetingCardMessageRow msg={msg} onJoin={(c) => openRoom(c.roomConversationId)} />
```

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
