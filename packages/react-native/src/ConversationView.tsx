import type {
  Citation,
  LiveCall,
  MeetingMoment,
  Message,
  MessageCreateRequest,
  Uuid,
} from '@poolse/sdk';
import { MessageQueuedError, safeUuid } from '@poolse/sdk';
import {
  canEditOwnMessage,
  computeGroupPosition,
  formatDayLabel,
  isMessageVisibleTo,
  isTombstone,
  receiptsOf,
  sameDay,
  useMe,
  useMembers,
  useMessageStreams,
  useMessages,
  useRealtimeStatus,
  useLiveCall,
  useConversations,
  usePoolse,
  useTyping,
  type GroupPosition,
  type MessageStream,
} from '@poolse/react';
import {
  MessageExtrasProvider,
  type MessageExtrasHandlers,
  type RenderMedia,
} from './messageExtras.js';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import {
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AttachmentPicker } from './AttachmentPicker.js';
import { ChatHeader } from './ChatHeader.js';
import { DaySeparator } from './DaySeparator.js';
import { LiveCallBanner } from './LiveCallBanner.js';
import { MentionInput } from './MentionInput.js';
import {
  MessageComposer,
  type BeforeSend,
  type ComposerPassThroughProps,
  type MessageComposerHandle,
} from './MessageComposer.js';
import type { MessageExtraAction } from './MessageActions.js';
import { alertConfirmDelete } from './internal/alertConfirmDelete.js';
import { confirmThenDelete, type ConfirmDelete } from './internal/confirmDelete.js';
import { MessageList, type MessageListItem } from './MessageList.js';
import { MessageRow, type MessageUser } from './MessageRow.js';
import { NewMessagesDivider } from './NewMessagesDivider.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
import { ThreadView } from './ThreadView.js';
import { TypingIndicator } from './TypingIndicator.js';
import { latestMarkableId } from './internal/messageFocus.js';
import { EmptyState } from './EmptyState.js';
import { draftStoreOf, type ConversationDraft, type DraftStorage } from './internal/drafts.js';
import { isQuoteGone, sendErrorNotice } from './internal/errors.js';
import {
  firstUnreadSequence,
  needsOlderForUnread,
  newMessagesDividerId,
} from './internal/unread.js';
import {
  mentionsViewer,
  type ChatDensity,
  type ChatLayout,
  type MessageSlots,
  type RenderMessageContext,
  type TimeFormat,
} from './layout.js';
import { UploadProvider } from './internal/uploadContext.js';
import { useTheme } from './theme/PoolseTheme.js';

// Two messages from the same sender within this many minutes collapse
// into a visual cluster (tight margin, grouped bubble corners; one
// header in `list`). Matches the react-ui default.
const GROUP_WINDOW_MINUTES = 5;

export interface ConversationViewProps {
  conversationId: Uuid;
  emptyState?: ReactElement | string;
  /**
   * Custom row renderer. Return `null` / `undefined` to fall back to
   * the default row for that message (so you can override just the
   * message kinds you care about). The third argument carries the
   * layout and `renderDefault()`, the row this view would have drawn.
   */
  renderMessage?: (
    msg: Message,
    currentUserId: string | null,
    context: RenderMessageContext,
  ) => ReactElement | null | undefined;

  /**
   * How messages are drawn:
   *   * `'bubbles'` (default) — chat bubbles, yours on the right.
   *   * `'list'` — Slack-style full-width rows; avatar, name and time
   *     once per run, later messages' time dimmed in the gutter,
   *     "N replies" under threads. Long-press for actions.
   *   * `'compact'` — Discord/IRC-style dense lines: time, the name in
   *     the sender's colour, the text; an accent bar on messages that
   *     mention you.
   */
  layout?: ChatLayout;
  /** `'comfortable'` (default) or `'compact'` spacing, in any layout. */
  density?: ChatDensity;
  /**
   * Show avatars. Defaults: `list` on, `compact` off, `bubbles` per
   * `avatars` (others' messages in group chats). Overrides `avatars`.
   */
  showAvatars?: boolean;
  /** `'12h'`, `'24h'` or a formatter. Defaults to the locale's. */
  timeFormat?: TimeFormat;
  /**
   * Same-sender messages less than this many minutes apart form one
   * run (one bubble cluster, one `list` header). Default 5.
   */
  groupWindowMinutes?: number;
  /** Day dividers between messages on different days. Defaults to `true`. */
  daySeparators?: boolean;
  /**
   * Replace or wrap one part of every message — `header`, `body`,
   * `attachments`, `reactions`, `thread`, `actions` — in any layout.
   * Each receives the message, sender, layout and its default
   * rendering as `children`.
   */
  slots?: MessageSlots;
  labelFor?: (externalId: string) => string;
  avatarFor?: (externalId: string) => string | null;

  /**
   * Renders the default `<ChatHeader>` at the top of the chat surface.
   *   * `true` (default)  — auto chat header (other user / group name).
   *   * `false`           — no header (you supply your own above).
   *   * `ReactElement`    — custom header node, rendered as-is.
   */
  header?: boolean | ReactElement;
  /** Tap on the header's members icon — typically opens a sheet. */
  onHeaderMembersPress?: () => void;
  /** Tap on the header itself — typically opens a conversation profile. */
  onHeaderPress?: () => void;

  // Feature toggles — all default ON, identical names + defaults to web.
  reactions?: boolean;
  mentions?: boolean;
  attachments?: boolean;
  actions?: boolean;
  threads?: boolean;
  quotations?: boolean;
  /**
   * Show read ticks on your own messages. Only the ticks: the view
   * marks messages read either way, so unread counts stay right.
   */
  readReceipts?: boolean;
  /** Render message bodies as Markdown (links, bold, code). Defaults true. */
  markdown?: boolean;
  maxBodyLength?: number;

  /** Show sender labels in group chats. `auto` (default), `always`, `never`. */
  senderLabels?: 'auto' | 'always' | 'never';
  /** Show avatars to the left of other-side bubbles in group chats. Same semantics. */
  avatars?: 'auto' | 'always' | 'never';

  /**
   * Fires once the server accepts a new read position (the view marks
   * the newest message read as it arrives). Receives the conversation
   * id + the message id marked as last-read. Every
   * `useConversations()` under the same provider has already cleared
   * the conversation's badge by then.
   */
  onMarkedRead?: (conversationId: string, messageId: string) => void;
  /**
   * Fires after every successful message send — e.g. to refetch
   * conversations from a list that isn't `useConversations()` (which
   * gets the new preview over realtime already).
   */
  onSent?: (conversationId: string) => void;
  /**
   * Jump to this message: older pages load until it's there, then it
   * scrolls into view and is highlighted briefly. Set it again (or to
   * another id) to jump again. When it can't be found — deleted, a
   * thread reply, or not in this conversation — a short notice shows
   * and `onFocusMessageNotFound` fires.
   */
  focusMessageId?: Uuid | null;
  /** `focusMessageId` couldn't be found in this conversation. */
  onFocusMessageNotFound?: (messageId: Uuid) => void;
  /** Makes the sender label on other people's messages tappable. */
  onSenderPress?: (user: MessageUser) => void;
  /** Makes the avatar next to other people's messages tappable. */
  onAvatarPress?: (user: MessageUser) => void;
  /**
   * `false` hides the composer (and with it quote-reply and the
   * attachment picker) — for an archived conversation or a viewer who
   * can't post. Defaults to `true`.
   */
  composer?: boolean;
  /** Same as `composer={false}`. */
  readOnly?: boolean;
  /**
   * keyboardVerticalOffset passed to the internal KeyboardAvoidingView.
   * On iOS this MUST equal the distance from the screen top to the
   * KAV's top (status bar + safe-area-top + any nav header above
   * the chat). `<PoolseInbox>` computes this for you. Standalone
   * consumers pass it manually.
   */
  keyboardOffset?: number;
  /**
   * Offer "Call back" on call-log rows the viewer missed or declined,
   * or placed with no answer. Receives the call's media; place the call
   * on this conversation.
   */
  onCallBack?: (media: 'audio' | 'video') => void;
  /**
   * Show a "Call in progress · Join" banner while a call runs on this
   * conversation that the viewer is not on. Called with the live call
   * when they tap Join.
   */
  onJoinCall?: (call: LiveCall) => void;
  /**
   * The call this device is already on, if any — its banner is hidden
   * (the viewer is in the room, or ringing out as its caller).
   */
  currentCallId?: string | null;
  /**
   * A source under an assistant's answer was pressed (AG5). Without it,
   * message sources in this conversation are focused here.
   */
  onOpenCitation?: (citation: Citation, message: Message) => void;
  /**
   * A point in a call was pressed — a line or moment of a summary (RT6):
   * open its recording at `moment.recordingMs` or transcript at `moment.startMs`.
   */
  onOpenMoment?: (moment: MeetingMoment) => void;
  /**
   * Plays clips in chat (RT9): your media adapter (expo-video,
   * expo-audio…) — see `RenderMedia` and the README. Without it a clip
   * shows its time range only.
   */
  renderMedia?: RenderMedia;

  /** Presence badges on message avatars (where avatars show). Defaults to `false`. */
  showPresence?: boolean;
  /**
   * Link previews (`message.link_previews`) as cards under the text,
   * with "Remove preview" in the sender's long-press sheet. Defaults to `true`.
   */
  linkPreviews?: boolean;
  /**
   * A "New messages" line above the first message that was unread when
   * the conversation opened, and a pill that jumps to it (loading older
   * pages as needed) while it's off screen. Defaults to `true`.
   */
  newMessagesDivider?: boolean;
  /**
   * Unsent text and the quote target are kept per conversation in
   * memory, across conversation switches, always. With a `draftStorage`
   * they are also written there, so they survive a restart; set
   * `persistDrafts={false}` to keep them in memory only. Defaults to
   * `true` when `draftStorage` is given.
   */
  persistDrafts?: boolean;
  /**
   * Where drafts persist — `{ get, set, remove }` over string values
   * (MMKV, AsyncStorage, …); each may return a promise. Keys are
   * `poolse:draft:<conversationId>`.
   */
  draftStorage?: DraftStorage;
  /** An emoji button in the composer. Defaults to `true`. */
  emojiPicker?: boolean;
  /** Largest attachment accepted, in bytes; larger picks show an error. */
  maxFileSize?: number;
  /** Accepted attachment types: MIME types, wildcards (`'image/*'`) or extensions (`'.pdf'`). */
  acceptedFileTypes?: string[];
  /**
   * Long-press → "Mark unread" on other people's messages. Defaults to
   * `true`. The view then stops marking messages read until you send
   * one or reopen the conversation.
   */
  markUnread?: boolean;
  /** Fires after "Mark unread" succeeded (the unread counts follow over realtime). */
  onMarkedUnread?: (conversationId: string, messageId: string) => void;
  /**
   * Passed through to the composer (`placeholder`, `disabled`,
   * `formattingToolbar`, `commands`…). The text, sending, quoting and
   * editing stay the view's; `onTyping` runs alongside its own. Also used
   * by the thread sheet's composer.
   */
  composerProps?: ComposerPassThroughProps;
  /** Rendered above the composer (a toolbar, a "scheduled" chip…). */
  composerAccessory?: ReactNode;
  /**
   * The composer's handle: `focus`, `insertText` (at the cursor),
   * `setText`, `getText`, `clear`, `setSelection`, `addFiles`.
   */
  composerHandle?: Ref<MessageComposerHandle>;
  /**
   * Runs before every send here and in the thread sheet: return the
   * message (changed or not), or `false` to cancel — the text and files
   * stay in the composer.
   */
  beforeSend?: BeforeSend;
  /** The app's own entries in a message's long-press menu, listed before Edit / Delete. */
  extraActions?: (msg: Message) => readonly MessageExtraAction[];
  /**
   * Asked before a message is deleted; resolve `true` to delete. Defaults
   * to a native "Delete message?" alert. Also used in the thread sheet.
   */
  confirmDelete?: ConfirmDelete;
}

export function ConversationView({
  conversationId,
  emptyState,
  renderMessage,
  labelFor,
  avatarFor,
  header = true,
  onHeaderMembersPress,
  onHeaderPress,
  reactions = true,
  mentions = true,
  attachments = true,
  actions = true,
  threads = true,
  quotations = true,
  readReceipts = true,
  markdown = true,
  maxBodyLength = 200,
  senderLabels = 'auto',
  avatars = 'auto',
  onMarkedRead,
  onSent,
  focusMessageId = null,
  onFocusMessageNotFound,
  onSenderPress,
  onAvatarPress,
  composer = true,
  readOnly = false,
  keyboardOffset = 0,
  onCallBack,
  onJoinCall,
  currentCallId = null,
  onOpenCitation,
  onOpenMoment,
  renderMedia,
  layout = 'bubbles',
  density = 'comfortable',
  showAvatars: showAvatarsProp,
  timeFormat,
  groupWindowMinutes = GROUP_WINDOW_MINUTES,
  daySeparators = true,
  slots,
  showPresence = false,
  linkPreviews = true,
  newMessagesDivider = true,
  persistDrafts,
  draftStorage,
  emojiPicker = true,
  maxFileSize,
  acceptedFileTypes,
  markUnread = true,
  onMarkedUnread,
  composerProps: appComposerProps,
  composerAccessory,
  composerHandle,
  beforeSend,
  extraActions,
  confirmDelete = alertConfirmDelete,
}: ConversationViewProps) {
  const theme = useTheme();
  const chat = usePoolse();
  const storage = (persistDrafts ?? !!draftStorage) ? draftStorage : undefined;
  const showComposer = composer && !readOnly;
  // Without a composer there's nowhere to quote into or attach to.
  const canQuote = quotations && showComposer;
  const canAttach = attachments && showComposer;
  const { me } = useMe();
  const meId = me?.id ?? null;
  // The workspace's read-receipt setting, for this user: hidden means no
  // check marks anywhere (the server withholds others' read state too).
  // Marking messages read is unaffected — it drives the user's own
  // unread counts.
  const receiptsVisible = receiptsOf(me).visible;
  const showReadState = readReceipts && receiptsVisible;

  const {
    messages,
    loading,
    hasMore,
    loadMore,
    loadUntil,
    send,
    retry: retrySend,
    discard: discardSend,
    edit,
    delete: deleteMsg,
    markReadUpTo,
    refetch,
  } = useMessages(conversationId);
  // Drafts belong to this client (server + user), never shared between workspaces.
  const drafts = draftStoreOf(chat);
  const { typing: typingPeople, signalTyping } = useTyping(conversationId);
  // AI agent replies being written. Before the first words arrive the
  // agent shows as typing; then its reply streams into a bubble.
  const streams = useMessageStreams(conversationId);
  const typing = useMemo(() => {
    const thinking = streams.filter((s) => s.status === 'streaming' && !s.text);
    if (thinking.length === 0) return typingPeople;
    const next = new Set(typingPeople);
    for (const s of thinking) if (s.sender_external_id) next.add(s.sender_external_id);
    return next;
  }, [typingPeople, streams]);
  const visibleStreams = streams.filter((s) => s.text || s.status === 'failed');
  const realtimeStatus = useRealtimeStatus();

  // Pull the latest page when the app foregrounds or the socket
  // reconnects. While the socket is down (background, network drop)
  // we miss `message:new` pushes; without this the chat shows stale
  // data until the user navigates away and back.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refetch();
    });
    return () => sub.remove();
  }, [refetch]);

  const prevStatusRef = useRef(realtimeStatus);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = realtimeStatus;
    if (
      realtimeStatus === 'connected' &&
      (prev === 'reconnecting' || prev === 'closed' || prev === 'connecting')
    ) {
      void refetch();
    }
  }, [realtimeStatus, refetch]);

  const wantsMembers = mentions || senderLabels === 'auto' || avatars === 'auto';
  const { members } = useMembers(wantsMembers ? conversationId : '');

  // System lines that name people by poolse id (the recording notice):
  // the resolver's name, else the app's label. Unknown: left out.
  const nameForUserId = useCallback(
    (userId: string): string | null => {
      const ext = members.find((m) => m.user_id === userId)?.external_id;
      if (!ext) return null;
      return chat.users.peek(ext)?.displayName ?? labelFor?.(ext) ?? null;
    },
    [members, chat, labelFor],
  );
  const isGroupChat = members.length > 2;
  const showSenderLabels = senderLabels === 'always' || (senderLabels === 'auto' && isGroupChat);
  const showAvatars =
    showAvatarsProp ??
    (layout === 'list'
      ? true
      : layout === 'compact'
        ? false
        : avatars === 'always' || (avatars === 'auto' && isGroupChat));
  // Props every row gets, whatever the layout.
  const layoutProps = useMemo(
    () => ({
      layout,
      density,
      ...(timeFormat ? { timeFormat } : {}),
      ...(slots ? { slots } : {}),
    }),
    [layout, density, timeFormat, slots],
  );

  // Drafts: the composer text and quote target, per conversation.
  // `draftFor` says which conversation the state belongs to, so a
  // switch never saves one conversation's text under another's id.
  const [draftFor, setDraftFor] = useState(conversationId);
  const [draftText, setDraftText] = useState(() => drafts.peek(conversationId)?.text ?? '');
  const composerRef = useRef<MessageComposerHandle | null>(null);
  useImperativeHandle(
    composerHandle,
    (): MessageComposerHandle => ({
      addFiles: (inputs) => composerRef.current?.addFiles(inputs),
      focus: () => composerRef.current?.focus(),
      clear: () => composerRef.current?.clear(),
      getText: () => composerRef.current?.getText() ?? '',
      setText: (t) => composerRef.current?.setText(t),
      insertText: (t) => composerRef.current?.insertText(t),
      setSelection: (start, end) => composerRef.current?.setSelection(start, end),
    }),
    [],
  );
  const [replyingTo, setReplyingTo] = useState<Message | null>(
    () => drafts.peek(conversationId)?.quote ?? null,
  );
  const touchedRef = useRef(false);
  // Until the stored draft has been read, nothing is written back —
  // the empty initial state would otherwise remove it.
  const [storedDraftRead, setStoredDraftRead] = useState(false);
  useEffect(() => {
    let live = true;
    touchedRef.current = false;
    const inMemory = drafts.peek(conversationId);
    setDraftFor(conversationId);
    setDraftText(inMemory?.text ?? '');
    setReplyingTo(inMemory?.quote ?? null);
    if (!inMemory && storage) {
      setStoredDraftRead(false);
      void drafts.load(conversationId, storage).then((d) => {
        if (!live) return;
        setStoredDraftRead(true);
        // Typed something already? Theirs wins over the stored draft.
        if (!d || touchedRef.current) return;
        setDraftText(d.text);
        setReplyingTo(d.quote);
      });
    } else {
      setStoredDraftRead(true);
    }
    return () => {
      live = false;
    };
    // `storage` is read once per conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);
  const pendingDraftRef = useRef<{ id: string; draft: ConversationDraft } | null>(null);
  useEffect(() => {
    if (draftFor !== conversationId) return;
    const draft = { text: draftText, quote: replyingTo };
    drafts.save(conversationId, draft);
    if (!storage || !storedDraftRead) return;
    // Storage writes are debounced; the memory copy is immediate.
    pendingDraftRef.current = { id: conversationId, draft };
    const t = setTimeout(() => {
      pendingDraftRef.current = null;
      drafts.save(conversationId, draft, storage);
    }, 400);
    return () => clearTimeout(t);
  }, [drafts, draftFor, conversationId, draftText, replyingTo, storage, storedDraftRead]);
  // Flush a pending storage write when the view goes away.
  const storageRef = useRef(storage);
  storageRef.current = storage;
  useEffect(
    () => () => {
      const pending = pendingDraftRef.current;
      if (pending) drafts.save(pending.id, pending.draft, storageRef.current);
    },
    [drafts],
  );

  // One line of feedback above the list: a send that failed, a jump
  // target that's gone, a refused attachment.
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [threadRoot, setThreadRoot] = useState<Message | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // messageId → sequence map for read-receipt comparison. Membership
  // only carries `last_read_message_id` (UUID); to know whether
  // member X read message Y we have to translate the read message's
  // id into its sequence and compare against Y's sequence. UUIDs
  // aren't chronological so we have to do this lookup explicitly.
  const sequenceByMessageId = useMemo(() => {
    const m = new Map<string, number>();
    for (const msg of messages) {
      if (typeof msg.sequence === 'number') m.set(msg.id, msg.sequence);
    }
    return m;
  }, [messages]);

  // Auto-mark-read: advance the read cursor whenever a confirmed
  // message lands at the tail — whatever `readReceipts` says, which
  // only decides whether ticks show. Skips optimistic temp messages
  // (no server sequence yet) to avoid 404s when send-then-mark races
  // the round-trip. A failure is retried on the next message.
  const lastMarkedRef = useRef<string | null>(null);
  // "Mark unread" pauses this until the viewer sends or reopens.
  const [autoReadPaused, setAutoReadPaused] = useState(false);
  useEffect(() => {
    setAutoReadPaused(false);
  }, [conversationId]);
  useEffect(() => {
    if (autoReadPaused) return;
    const latestId = latestMarkableId(messages);
    if (!latestId || latestId === lastMarkedRef.current) return;
    lastMarkedRef.current = latestId;
    markReadUpTo(latestId).then(
      () => onMarkedRead?.(conversationId, latestId),
      () => {
        if (lastMarkedRef.current === latestId) lastMarkedRef.current = null;
      },
    );
  }, [messages, markReadUpTo, onMarkedRead, conversationId, autoReadPaused]);

  // Precompute per-message group position (drives the bubble's
  // corner treatment + inter-cluster spacing). Same logic as
  // react-ui's ConversationView; the helpers live in @poolse/react.
  //
  // Runs over the *rendered* feed: call-log markers addressed to
  // someone else (a `call_missed` for another callee) are dropped
  // first so a hidden row never splits a bubble cluster or spawns an
  // orphan day separator. Call-log rows themselves never group
  // (`sameGroup` treats them as separators).
  const visibleMessages = useMemo(
    () => messages.filter((m) => isMessageVisibleTo(m, meId)),
    [messages, meId],
  );
  // Jump to a message (`focusMessageId`, or a tapped quote): page back
  // until it's loaded, then scroll the list to it and highlight it.
  const [jump, setJump] = useState<{ id: Uuid; request: number } | null>(null);
  const [pendingFocusId, setPendingFocusId] = useState<Uuid | null>(null);
  const [highlightId, setHighlightId] = useState<Uuid | null>(null);
  const onFocusNotFoundRef = useRef(onFocusMessageNotFound);
  onFocusNotFoundRef.current = onFocusMessageNotFound;
  const focusMiss = useCallback((id: Uuid, report: boolean) => {
    setNotice("That message isn't available.");
    if (report) onFocusNotFoundRef.current?.(id);
  }, []);
  const jumpTo = useCallback(
    (id: Uuid, report: boolean): (() => void) => {
      let current = true;
      loadUntil(id)
        .then((found) => {
          if (!current) return;
          if (found) setPendingFocusId(id);
          else focusMiss(id, report);
        })
        .catch(() => {
          if (current) focusMiss(id, report);
        });
      return () => {
        current = false;
      };
    },
    [loadUntil, focusMiss],
  );
  // Sources, moments, assignees and clips in agent and summary messages.
  const extras = useMemo<MessageExtrasHandlers>(
    () => ({
      onOpenCitation:
        onOpenCitation ??
        ((c: Citation) => {
          if (c.type === 'message' && (!c.conversationId || c.conversationId === conversationId)) {
            jumpTo(c.id, false);
          }
        }),
      ...(onOpenMoment ? { onOpenMoment } : {}),
      ...(renderMedia ? { renderMedia } : {}),
      nameForUserId,
      externalIdForUserId: (userId: string) =>
        members.find((m) => m.user_id === userId)?.external_id ?? null,
    }),
    [onOpenCitation, onOpenMoment, renderMedia, conversationId, jumpTo, nameForUserId, members],
  );
  useEffect(() => {
    setPendingFocusId(null);
    if (!focusMessageId || loading) return;
    return jumpTo(focusMessageId, true);
    // `loading` flips only while a conversation's first page loads.
  }, [focusMessageId, conversationId, loading, jumpTo]);
  useEffect(() => {
    if (!pendingFocusId) return;
    setPendingFocusId(null);
    // Loaded but not shown (a call-log marker meant for someone else).
    if (!visibleMessages.some((m) => m.id === pendingFocusId)) {
      focusMiss(pendingFocusId, true);
      return;
    }
    setJump((prev) => ({ id: pendingFocusId, request: (prev?.request ?? 0) + 1 }));
    setHighlightId(pendingFocusId);
  }, [pendingFocusId, visibleMessages, focusMiss]);
  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightId(null), 1600);
    return () => clearTimeout(t);
  }, [highlightId]);

  // The "New messages" line: where unread started when the
  // conversation opened, from the shared conversation list's counts
  // (snapshotted once, before this view marks anything read).
  const { conversations: conversationRows } = useConversations();
  const [unreadFromSeq, setUnreadFromSeq] = useState<number | null>(null);
  const unreadSnapshotRef = useRef<string | null>(null);
  useEffect(() => {
    if (unreadSnapshotRef.current === conversationId) return;
    const row = conversationRows.find((c) => c.id === conversationId);
    if (!row) {
      setUnreadFromSeq(null);
      return;
    }
    unreadSnapshotRef.current = conversationId;
    setUnreadFromSeq(firstUnreadSequence(row));
  }, [conversationRows, conversationId]);
  const dividerId = newMessagesDivider
    ? newMessagesDividerId(visibleMessages, unreadFromSeq, meId)
    : null;
  // Pill: shown until the line has been on screen once.
  const [dividerSeen, setDividerSeen] = useState(false);
  useEffect(() => setDividerSeen(false), [unreadFromSeq, conversationId]);
  const onVisibleItemsChange = useCallback((keys: string[]) => {
    if (keys.includes(NEW_MESSAGES_KEY)) setDividerSeen(true);
  }, []);
  const unreadPending =
    newMessagesDivider &&
    unreadFromSeq !== null &&
    !dividerSeen &&
    (dividerId !== null || (hasMore && needsOlderForUnread(visibleMessages, unreadFromSeq)));
  const [seekingUnread, setSeekingUnread] = useState(false);
  const [seekTick, setSeekTick] = useState(0);
  const seekBusyRef = useRef(false);
  const seekPagesRef = useRef(0);
  useEffect(() => {
    if (!seekingUnread || seekBusyRef.current) return;
    if (dividerId) {
      setSeekingUnread(false);
      setJump((prev) => ({ id: dividerId, request: (prev?.request ?? 0) + 1 }));
      return;
    }
    if (
      !hasMore ||
      seekPagesRef.current >= 20 ||
      !needsOlderForUnread(visibleMessages, unreadFromSeq)
    ) {
      setSeekingUnread(false);
      return;
    }
    seekBusyRef.current = true;
    seekPagesRef.current += 1;
    loadMore()
      .catch(() => setSeekingUnread(false))
      .finally(() => {
        seekBusyRef.current = false;
        // Re-run even if the page changed nothing visible.
        setSeekTick((n) => n + 1);
      });
  }, [seekingUnread, dividerId, hasMore, visibleMessages, unreadFromSeq, loadMore, seekTick]);
  const jumpToUnread = useCallback(() => {
    seekPagesRef.current = 0;
    setSeekingUnread(true);
  }, []);
  const onQuotedClick = useCallback((id: Uuid) => void jumpTo(id, false), [jumpTo]);

  const groupPositionById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeGroupPosition>>();
    for (let i = 0; i < visibleMessages.length; i++) {
      const msg = visibleMessages[i];
      if (!msg) continue;
      const prev = i > 0 ? (visibleMessages[i - 1] ?? null) : null;
      const next = i < visibleMessages.length - 1 ? (visibleMessages[i + 1] ?? null) : null;
      map.set(msg.id, computeGroupPosition(msg, prev, next, groupWindowMinutes * 60 * 1000));
    }
    return map;
  }, [visibleMessages, groupWindowMinutes]);

  const onMarkedUnreadRef = useRef(onMarkedUnread);
  onMarkedUnreadRef.current = onMarkedUnread;
  const markMessageUnread = useCallback(
    (msg: Message) => {
      setAutoReadPaused(true);
      chat.conversations
        .one(conversationId)
        .markUnread(msg.id)
        .then(
          () => {
            // The line moves to the message marked unread.
            setUnreadFromSeq(msg.sequence);
            onMarkedUnreadRef.current?.(conversationId, msg.id);
          },
          () => {
            setAutoReadPaused(false);
            setNotice("Couldn't mark it unread. Try again.");
          },
        );
    },
    [chat, conversationId],
  );
  const removeLinkPreview = useCallback(
    (messageId: Uuid, url: string) => {
      // The updated message comes back over realtime (message:updated).
      chat.messages
        .update(messageId, { remove_link_previews: [url] })
        .catch(() => setNotice("Couldn't remove the preview. Try again."));
    },
    [chat],
  );

  const defaultRow = useCallback(
    (msg: Message, groupPosition: GroupPosition): ReactElement => {
      const readState: 'sent' | 'read' | undefined =
        showReadState && meId !== null && msg.sender_id === meId
          ? readStateForMessage(msg, members, meId, sequenceByMessageId)
          : undefined;
      // Edit is only offered for own messages no one else has read
      // yet — once someone has "seen" it (their last_read_message_id
      // sequence >= this one) WhatsApp-style apps disable editing to
      // prevent conversation rewriting. `readStateForMessage`
      // returns 'sent' in 1:1 chats with no other member, so own
      // messages in fresh threads stay editable. With read receipts
      // hidden by the workspace it is a 15-minute window instead
      // (canEditOwnMessage).
      const isSelf = meId !== null && msg.sender_id === meId;
      const canEdit = canEditOwnMessage({
        isSelf,
        deleted: !!msg.deleted_at,
        receiptsVisible,
        readState,
        insertedAt: msg.inserted_at,
      });
      const tombstone = isTombstone(msg);
      const markable =
        markUnread &&
        !isSelf &&
        !tombstone &&
        typeof msg.sequence === 'number' &&
        msg.sequence > 0 &&
        msg.sequence !== Number.MAX_SAFE_INTEGER;
      const row = (
        <MessageRow
          msg={msg}
          meId={meId}
          showPresence={showPresence}
          linkPreviews={linkPreviews}
          {...(markable ? { onMarkUnread: () => markMessageUnread(msg) } : {})}
          {...(msg.local_status
            ? {
                onRetrySend: () => void retrySend(msg.id).catch(() => undefined),
                onDiscardSend: () => discardSend(msg.id),
              }
            : {})}
          {...(linkPreviews && isSelf && !tombstone && (msg.link_previews?.length ?? 0) > 0
            ? { onRemoveLinkPreview: (url: string) => removeLinkPreview(msg.id, url) }
            : {})}
          reactions={reactions}
          attachments={attachments}
          actions={actions}
          threads={threads}
          quotations={canQuote}
          {...(readState ? { readState } : {})}
          isEditing={editingId === msg.id}
          {...(canEdit ? { onStartEdit: () => setEditingId(msg.id) } : {})}
          onDelete={() => void confirmThenDelete(msg, confirmDelete, deleteMsg)}
          {...(extraActions ? { extraActions: extraActions(msg) } : {})}
          {...(threads ? { onOpenThread: () => setThreadRoot(msg) } : {})}
          {...(canQuote && !tombstone ? { onQuote: () => setReplyingTo(msg) } : {})}
          onQuotedClick={onQuotedClick}
          {...(labelFor ? { labelFor } : {})}
          {...(avatarFor ? { avatarFor } : {})}
          {...(onSenderPress ? { onSenderPress } : {})}
          {...(onAvatarPress ? { onAvatarPress } : {})}
          showSenderName={showSenderLabels}
          showAvatar={showAvatars}
          maxBodyLength={maxBodyLength}
          groupPosition={groupPosition}
          markdown={markdown}
          {...(onCallBack ? { onCallBack } : {})}
          nameForUserId={nameForUserId}
          {...layoutProps}
          mentionsMe={mentionsViewer(msg, meId)}
        />
      );
      if (msg.id !== highlightId) return row;
      return <View style={{ backgroundColor: theme.colors.accentSoft }}>{row}</View>;
    },
    [
      retrySend,
      discardSend,
      onCallBack,
      onQuotedClick,
      onSenderPress,
      onAvatarPress,
      highlightId,
      theme.colors.accentSoft,
      canQuote,
      meId,
      showReadState,
      receiptsVisible,
      members,
      reactions,
      attachments,
      actions,
      threads,
      editingId,
      deleteMsg,
      confirmDelete,
      extraActions,
      labelFor,
      avatarFor,
      showSenderLabels,
      showAvatars,
      maxBodyLength,
      sequenceByMessageId,
      markdown,
      layoutProps,
      showPresence,
      linkPreviews,
      markUnread,
      markMessageUnread,
      removeLinkPreview,
      nameForUserId,
    ],
  );

  const renderItem = useCallback(
    (msg: Message): ReactElement => {
      const groupPosition = groupPositionById.get(msg.id) ?? 'standalone';
      if (renderMessage) {
        // null / undefined → fall through to the default row.
        const custom = renderMessage(msg, meId, {
          layout,
          groupPosition,
          isRunStart:
            layout === 'compact' || groupPosition === 'first' || groupPosition === 'standalone',
          renderDefault: () => defaultRow(msg, groupPosition),
        });
        if (custom !== null && custom !== undefined) return custom;
      }
      return defaultRow(msg, groupPosition);
    },
    [renderMessage, meId, layout, groupPositionById, defaultRow],
  );

  const editingMessage = useMemo(
    () => (editingId ? (messages.find((m) => m.id === editingId) ?? null) : null),
    [editingId, messages],
  );

  // Build the interleaved item list (messages + day separators).
  // Inject a separator BEFORE a message whenever its day differs
  // from the previous message's day.
  const listItems = useMemo<MessageListItem[]>(() => {
    const out: MessageListItem[] = [];
    let prev: Message | null = null;
    for (const msg of visibleMessages) {
      if (daySeparators && (prev === null || !sameDay(msg.inserted_at, prev.inserted_at))) {
        const label = formatDayLabel(msg.inserted_at);
        out.push({
          kind: 'separator',
          id: `sep-${msg.id}`,
          node: <DaySeparator label={label} variant={layout === 'bubbles' ? 'pill' : 'rule'} />,
        });
      }
      if (msg.id === dividerId) {
        out.push({ kind: 'separator', id: NEW_MESSAGES_KEY, node: <NewMessagesDivider /> });
      }
      out.push({ kind: 'msg', msg });
      prev = msg;
    }
    return out;
  }, [visibleMessages, daySeparators, layout, dividerId]);

  const composerProps = useMemo(
    () => ({
      onSend: async (
        body: string,
        opts?: { quoted_message_id?: Uuid; attachment_ids?: Uuid[]; mentions?: Uuid[] },
      ) => {
        let draft: MessageCreateRequest = { body, ...opts };
        if (beforeSend) {
          const changed = await beforeSend(draft);
          // Cancelled: the composer keeps the text and files.
          if (changed === false) return false;
          draft = changed;
        }
        const id = draft.id ?? safeUuid();
        try {
          await send({ ...draft, id });
        } catch (err) {
          // Offline: queued, it goes out by itself. Refused while the
          // outbox is on: the row stays with Retry / Delete — except a
          // deleted quote, which isn't worth a retry.
          const kept =
            err instanceof MessageQueuedError || (chat.outboxEnabled && !isQuoteGone(err));
          if (kept) {
            setReplyingTo(null);
            setAutoReadPaused(false);
            return;
          }
          if (isQuoteGone(err)) discardSend(id);
          // Back into the composer (unless they've typed on), and why.
          setDraftText((now) => (now ? now : body));
          if (isQuoteGone(err)) setReplyingTo(null);
          setNotice(sendErrorNotice(err));
          throw err;
        }
        setReplyingTo(null);
        setAutoReadPaused(false);
        onSent?.(conversationId);
        return undefined;
      },
      value: draftText,
      onChangeText: (text: string) => {
        touchedRef.current = true;
        setDraftText(text);
      },
      emojiPicker,
      ...appComposerProps,
      onTyping: () => {
        signalTyping();
        appComposerProps?.onTyping?.();
      },
      ...(attachments ? { onAttachPress: () => setPickerOpen(true) } : {}),
      ...(replyingTo ? { replyingTo } : {}),
      onCancelReply: () => setReplyingTo(null),
      ...(labelFor ? { labelFor } : {}),
      attachments,
      keyboardOffset,
      editingMessage,
      onCancelEdit: () => setEditingId(null),
      onSaveEdit: async (body: string) => {
        if (!editingId) return;
        await edit(editingId, body);
        setEditingId(null);
      },
    }),
    [
      send,
      chat.outboxEnabled,
      discardSend,
      signalTyping,
      attachments,
      replyingTo,
      labelFor,
      keyboardOffset,
      onSent,
      conversationId,
      editingMessage,
      editingId,
      edit,
      draftText,
      emojiPicker,
      beforeSend,
      appComposerProps,
    ],
  );

  const headerNode =
    header === false ? null : header === true ? (
      <ChatHeader
        conversationId={conversationId}
        {...(labelFor ? { labelFor } : {})}
        {...(avatarFor ? { avatarFor } : {})}
        {...(onHeaderMembersPress ? { onMembersPress: onHeaderMembersPress } : {})}
        {...(onHeaderPress ? { onPress: onHeaderPress } : {})}
      />
    ) : (
      header
    );

  return (
    <MessageExtrasProvider value={extras}>
      <UploadProvider>
        <KeyboardAvoidingView
          // iOS uses `padding` (the height behavior is documented as
          // only working on absolute-positioned children and is
          // basically a no-op inside flex:1 chains like ours).
          // Padding mode REQUIRES the right keyboardVerticalOffset —
          // the distance from the screen top to the KAV's top.
          // PoolseInbox computes this from the safe-area top + its own
          // ChatHeader height and passes it through; standalone
          // consumers must pass it themselves.
          //
          // Android uses `height` — works there because the layout
          // recomputes from the Android window resize.
          style={[styles.root, { backgroundColor: theme.colors.background }]}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={keyboardOffset}
        >
          {headerNode}
          {notice ? (
            <Text
              style={[
                styles.notice,
                { color: theme.colors.textMuted, backgroundColor: theme.colors.surfaceAlt },
              ]}
              accessibilityRole="alert"
            >
              {notice}
            </Text>
          ) : null}
          {onJoinCall ? (
            <JoinBanner
              conversationId={conversationId}
              meId={meId}
              currentCallId={currentCallId}
              onJoin={onJoinCall}
            />
          ) : null}
          <View style={styles.listWrap}>
            <MessageList
              messages={visibleMessages}
              items={listItems}
              meId={meId}
              loading={loading}
              hasMore={hasMore}
              onLoadMore={loadMore}
              renderItem={renderItem}
              scrollToMessageId={jump?.id ?? null}
              scrollRequest={jump?.request ?? 0}
              onVisibleItemsChange={onVisibleItemsChange}
              ListHeader={
                <View>
                  {visibleStreams.map((stream) =>
                    stream.status === 'failed' ? (
                      <Text
                        key={stream.id}
                        style={[styles.streamFailed, { color: theme.colors.textSubtle }]}
                        accessibilityRole="alert"
                      >
                        {stream.error
                          ? `The agent couldn't reply: ${stream.error}`
                          : "The agent couldn't reply."}
                      </Text>
                    ) : (
                      <MessageRow
                        key={stream.id}
                        msg={streamingMessage(stream)}
                        meId={meId}
                        reactions={false}
                        attachments={false}
                        actions={false}
                        threads={false}
                        quotations={false}
                        {...(labelFor ? { labelFor } : {})}
                        {...(avatarFor ? { avatarFor } : {})}
                        showSenderName={showSenderLabels}
                        showAvatar={showAvatars}
                        markdown={markdown}
                        {...layoutProps}
                      />
                    ),
                  )}
                  <TypingIndicator typing={typing} {...(labelFor ? { labelFor } : {})} />
                </View>
              }
              emptyState={
                emptyState !== undefined ? (
                  emptyState
                ) : (
                  <EmptyState
                    title="No messages yet"
                    {...(showComposer
                      ? { hint: 'Write the first message below — everyone here will see it.' }
                      : {})}
                  />
                )
              }
            />
            {unreadPending ? (
              <Pressable
                onPress={jumpToUnread}
                style={[
                  styles.unreadPill,
                  { backgroundColor: theme.colors.accent, borderRadius: theme.radii.pill },
                  theme.shadows.sm,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Jump to first unread message"
              >
                <PoolseIcon
                  name="chevron-up"
                  size={14}
                  color={theme.colors.accentText}
                  label={null}
                />
                <Text style={[styles.unreadPillText, { color: theme.colors.accentText }]}>
                  {seekingUnread ? 'Loading…' : 'New messages'}
                </Text>
                <Pressable
                  onPress={() => setDividerSeen(true)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss"
                >
                  <PoolseIcon name="close" size={12} color={theme.colors.accentText} label={null} />
                </Pressable>
              </Pressable>
            ) : null}
            {/* WhatsApp-style dim while editing: the overlay covers
              the scroll surface but the row being edited renders
              above it (MessageRow elevates itself when isEditing).
              Tap-outside cancels. */}
            {editingId ? (
              <Pressable
                style={[styles.editBackdrop, { backgroundColor: theme.colors.overlay }]}
                onPress={() => setEditingId(null)}
                accessibilityLabel="Cancel editing"
              />
            ) : null}
          </View>

          {showComposer ? composerAccessory : null}
          {!showComposer ? null : mentions ? (
            <MentionInput ref={composerRef} conversationId={conversationId} {...composerProps} />
          ) : (
            <MessageComposer ref={composerRef} {...composerProps} />
          )}

          {canAttach ? (
            <AttachmentPicker
              visible={pickerOpen}
              onClose={() => setPickerOpen(false)}
              onError={setNotice}
              {...(maxFileSize !== undefined ? { maxFileSize } : {})}
              {...(acceptedFileTypes ? { acceptedTypes: acceptedFileTypes } : {})}
            />
          ) : null}

          {threads && threadRoot ? (
            <ThreadView
              visible
              onClose={() => setThreadRoot(null)}
              conversationId={conversationId}
              rootMessage={threadRoot}
              {...(labelFor ? { labelFor } : {})}
              {...(avatarFor ? { avatarFor } : {})}
              layout={layout}
              {...(timeFormat ? { timeFormat } : {})}
              density={density}
              showPresence={showPresence}
              linkPreviews={linkPreviews}
              confirmDelete={confirmDelete}
              {...(appComposerProps ? { composerProps: appComposerProps } : {})}
              {...(beforeSend ? { beforeSend } : {})}
              {...(extraActions ? { extraActions } : {})}
            />
          ) : null}
        </KeyboardAvoidingView>
      </UploadProvider>
    </MessageExtrasProvider>
  );
}

// Its own component so the live-call subscription exists only for hosts
// that asked for the banner.
function JoinBanner({
  conversationId,
  meId,
  currentCallId,
  onJoin,
}: {
  conversationId: string;
  meId: string | null;
  currentCallId: string | null;
  onJoin: (call: LiveCall) => void;
}) {
  const { call, participantIds } = useLiveCall(conversationId);
  if (!call || call.id === currentCallId) return null;
  // Already in the room on another device: nothing to join.
  if (meId !== null && participantIds.includes(meId)) return null;
  return <LiveCallBanner call={call} inCall={participantIds.length} onJoin={onJoin} />;
}

function readStateForMessage(
  msg: Message,
  members: ReadonlyArray<{ user_id: string; last_read_message_id: string | null }>,
  meId: string,
  sequenceByMessageId: Map<string, number>,
): 'sent' | 'read' {
  const otherMembers = members.filter((m) => m.user_id !== meId);
  if (otherMembers.length === 0) return 'sent';
  if (typeof msg.sequence !== 'number') return 'sent';
  const mySeq = msg.sequence;
  const anyRead = otherMembers.some((m) => {
    if (!m.last_read_message_id) return false;
    const readSeq = sequenceByMessageId.get(m.last_read_message_id);
    if (readSeq === undefined) return false;
    return readSeq >= mySeq;
  });
  return anyRead ? 'read' : 'sent';
}

const NEW_MESSAGES_KEY = 'new-messages';

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  unreadPill: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    zIndex: 4,
  },
  unreadPillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  notice: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  streamFailed: {
    fontSize: 12,
    marginHorizontal: 16,
    marginVertical: 4,
  },
  listWrap: {
    flex: 1,
  },
  editBackdrop: {
    ...StyleSheet.absoluteFillObject,
    // Sit above message rows by default but below any row that
    // explicitly elevates itself (MessageRow bumps zIndex/elevation
    // when isEditing is true).
    zIndex: 5,
  },
});

// A streaming agent reply shaped as a Message, so it renders with the
// same row and bubble as the finished one that replaces it. A caret
// marks it as still being written.
function streamingMessage(stream: MessageStream): Message {
  const now = new Date().toISOString();
  return {
    id: stream.id,
    tenant_id: '',
    conversation_id: stream.conversation_id,
    sender_id: stream.sender_id,
    sender_external_id: stream.sender_external_id,
    type: 'text',
    body: `${stream.text} ▍`,
    reply_to_id: null,
    thread_root_id: null,
    mentions: [],
    reactions: {},
    edited_at: null,
    deleted_at: null,
    sequence: Number.MAX_SAFE_INTEGER,
    inserted_at: now,
    updated_at: now,
  };
}
