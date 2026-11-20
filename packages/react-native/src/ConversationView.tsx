import type { LiveCall, Message, Uuid } from '@poolse/sdk';
import {
  canEditOwnMessage,
  computeGroupPosition,
  formatDayLabel,
  isMessageVisibleTo,
  receiptsOf,
  sameDay,
  useMe,
  useMembers,
  useMessageStreams,
  useMessages,
  useRealtimeStatus,
  useLiveCall,
  useTyping,
  type MessageStream,
} from '@poolse/react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
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
import { MessageComposer } from './MessageComposer.js';
import { MessageList, type MessageListItem } from './MessageList.js';
import { MessageRow, type MessageUser } from './MessageRow.js';
import { ThreadView } from './ThreadView.js';
import { TypingIndicator } from './TypingIndicator.js';
import { latestMarkableId } from './internal/messageFocus.js';
import { UploadProvider } from './internal/uploadContext.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

// Two messages from the same sender within this window collapse
// into a visual cluster (tight margin, grouped bubble corners).
// Matches the react-ui default.
const GROUPING_WINDOW_MS = 5 * 60 * 1000;

export interface ConversationViewProps {
  conversationId: Uuid;
  emptyState?: ReactElement | string;
  /**
   * Custom row renderer. Return `null` / `undefined` to fall back to
   * the default row for that message (so you can override just the
   * message kinds you care about).
   */
  renderMessage?: (msg: Message, currentUserId: string | null) => ReactElement | null | undefined;
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
}: ConversationViewProps) {
  const theme = usePoolseTheme();
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
    edit,
    delete: deleteMsg,
    markReadUpTo,
    refetch,
  } = useMessages(conversationId);
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
  const isGroupChat = members.length > 2;
  const showSenderLabels = senderLabels === 'always' || (senderLabels === 'auto' && isGroupChat);
  const showAvatars = avatars === 'always' || (avatars === 'auto' && isGroupChat);

  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
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
  useEffect(() => {
    const latestId = latestMarkableId(messages);
    if (!latestId || latestId === lastMarkedRef.current) return;
    lastMarkedRef.current = latestId;
    markReadUpTo(latestId).then(
      () => onMarkedRead?.(conversationId, latestId),
      () => {
        if (lastMarkedRef.current === latestId) lastMarkedRef.current = null;
      },
    );
  }, [messages, markReadUpTo, onMarkedRead, conversationId]);

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
  const [focusMissing, setFocusMissing] = useState(false);
  const onFocusNotFoundRef = useRef(onFocusMessageNotFound);
  onFocusNotFoundRef.current = onFocusMessageNotFound;
  const focusMiss = useCallback((id: Uuid, report: boolean) => {
    setFocusMissing(true);
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
  useEffect(() => {
    setPendingFocusId(null);
    setFocusMissing(false);
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
  useEffect(() => {
    if (!focusMissing) return;
    const t = setTimeout(() => setFocusMissing(false), 4000);
    return () => clearTimeout(t);
  }, [focusMissing]);
  const onQuotedClick = useCallback((id: Uuid) => void jumpTo(id, false), [jumpTo]);

  const groupPositionById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeGroupPosition>>();
    for (let i = 0; i < visibleMessages.length; i++) {
      const msg = visibleMessages[i];
      if (!msg) continue;
      const prev = i > 0 ? (visibleMessages[i - 1] ?? null) : null;
      const next = i < visibleMessages.length - 1 ? (visibleMessages[i + 1] ?? null) : null;
      map.set(msg.id, computeGroupPosition(msg, prev, next, GROUPING_WINDOW_MS));
    }
    return map;
  }, [visibleMessages]);

  const renderItem = useCallback(
    (msg: Message): ReactElement => {
      if (renderMessage) {
        // null / undefined → fall through to the default row.
        const custom = renderMessage(msg, meId);
        if (custom !== null && custom !== undefined) return custom;
      }
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
      const groupPosition = groupPositionById.get(msg.id) ?? 'standalone';
      const row = (
        <MessageRow
          msg={msg}
          meId={meId}
          reactions={reactions}
          attachments={attachments}
          actions={actions}
          threads={threads}
          quotations={canQuote}
          {...(readState ? { readState } : {})}
          isEditing={editingId === msg.id}
          {...(canEdit ? { onStartEdit: () => setEditingId(msg.id) } : {})}
          onDelete={() => deleteMsg(msg.id)}
          {...(threads ? { onOpenThread: () => setThreadRoot(msg) } : {})}
          {...(canQuote ? { onQuote: () => setReplyingTo(msg) } : {})}
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
        />
      );
      if (msg.id !== highlightId) return row;
      return <View style={{ backgroundColor: theme.colors.brandSoft }}>{row}</View>;
    },
    [
      onCallBack,
      onQuotedClick,
      onSenderPress,
      onAvatarPress,
      highlightId,
      theme.colors.brandSoft,
      canQuote,
      renderMessage,
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
      labelFor,
      avatarFor,
      showSenderLabels,
      showAvatars,
      maxBodyLength,
      sequenceByMessageId,
      groupPositionById,
      markdown,
    ],
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
      if (prev === null || !sameDay(msg.inserted_at, prev.inserted_at)) {
        const label = formatDayLabel(msg.inserted_at);
        out.push({
          kind: 'separator',
          id: `sep-${msg.id}`,
          node: <DaySeparator label={label} />,
        });
      }
      out.push({ kind: 'msg', msg });
      prev = msg;
    }
    return out;
  }, [visibleMessages]);

  const composerProps = useMemo(
    () => ({
      onSend: async (
        body: string,
        opts?: { quoted_message_id?: Uuid; attachment_ids?: Uuid[]; mentions?: Uuid[] },
      ) => {
        await send({ body, ...opts });
        setReplyingTo(null);
        onSent?.(conversationId);
      },
      onTyping: signalTyping,
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
        style={[styles.root, { backgroundColor: theme.colors.paper }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={keyboardOffset}
      >
        {headerNode}
        {focusMissing ? (
          <Text
            style={[
              styles.notice,
              { color: theme.colors.ink2, backgroundColor: theme.colors.surface2 },
            ]}
            accessibilityRole="alert"
          >
            That message isn't available.
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
            ListHeader={
              <View>
                {visibleStreams.map((stream) =>
                  stream.status === 'failed' ? (
                    <Text
                      key={stream.id}
                      style={[styles.streamFailed, { color: theme.colors.ink3 }]}
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
                    />
                  ),
                )}
                <TypingIndicator typing={typing} {...(labelFor ? { labelFor } : {})} />
              </View>
            }
            {...(emptyState !== undefined ? { emptyState } : {})}
          />
          {/* WhatsApp-style dim while editing: the overlay covers
              the scroll surface but the row being edited renders
              above it (MessageRow elevates itself when isEditing).
              Tap-outside cancels. */}
          {editingId ? (
            <Pressable
              style={styles.editBackdrop}
              onPress={() => setEditingId(null)}
              accessibilityLabel="Cancel editing"
            />
          ) : null}
        </View>

        {!showComposer ? null : mentions ? (
          <MentionInput conversationId={conversationId} {...composerProps} />
        ) : (
          <MessageComposer {...composerProps} />
        )}

        {canAttach ? (
          <AttachmentPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} />
        ) : null}

        {threads && threadRoot ? (
          <ThreadView
            visible
            onClose={() => setThreadRoot(null)}
            conversationId={conversationId}
            rootMessage={threadRoot}
            {...(labelFor ? { labelFor } : {})}
          />
        ) : null}
      </KeyboardAvoidingView>
    </UploadProvider>
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

const styles = StyleSheet.create({
  root: {
    flex: 1,
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
    backgroundColor: 'rgba(0,0,0,0.45)',
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
