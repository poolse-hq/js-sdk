import type { Message, Uuid } from '@poolse/sdk';
import { useMe, useMembers, useMessages, useTyping } from '@poolse/react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { AttachmentPicker } from './AttachmentPicker.js';
import { ChatHeader } from './ChatHeader.js';
import { MentionInput } from './MentionInput.js';
import { MessageComposer } from './MessageComposer.js';
import { MessageList } from './MessageList.js';
import { MessageRow } from './MessageRow.js';
import { ThreadView } from './ThreadView.js';
import { TypingIndicator } from './TypingIndicator.js';
import { UploadProvider } from './internal/uploadContext.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

export interface ConversationViewProps {
  conversationId: Uuid;
  emptyState?: ReactElement | string;
  renderMessage?: (msg: Message, currentUserId: string | null) => ReactElement;
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
  readReceipts?: boolean;
  maxBodyLength?: number;

  /** Show sender labels in group chats. `auto` (default), `always`, `never`. */
  senderLabels?: 'auto' | 'always' | 'never';
  /** Show avatars to the left of other-side bubbles in group chats. Same semantics. */
  avatars?: 'auto' | 'always' | 'never';

  /**
   * Fires when auto-mark-read commits a new server-side read cursor.
   * Receives the conversation id + the message id that was marked
   * as the last-read. Wire this to `useConversations().markConversationRead(convId, msgId)`
   * so the sidebar / list view's unread badge clears immediately
   * instead of waiting for the next conversations refetch.
   */
  onMarkedRead?: (conversationId: string, messageId: string) => void;
  /**
   * Fires after every successful message send. Wire to the parent's
   * `useConversations().refetch()` so the conversation list shows
   * the fresh `last_message_preview` / `last_message_at` for the
   * conversation you just sent into. `useConversations` creates
   * isolated state per call site, so ConversationView can't refresh
   * a parent hook's state on its own.
   */
  onSent?: (conversationId: string) => void;
  /**
   * keyboardVerticalOffset passed to the internal KeyboardAvoidingView.
   * On iOS this MUST equal the distance from the screen top to the
   * KAV's top (status bar + safe-area-top + any nav header above
   * the chat). `<PoolseInbox>` computes this for you. Standalone
   * consumers pass it manually.
   */
  keyboardOffset?: number;
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
  maxBodyLength = 200,
  senderLabels = 'auto',
  avatars = 'auto',
  onMarkedRead,
  onSent,
  keyboardOffset = 0,
}: ConversationViewProps) {
  const theme = usePoolseTheme();
  const { me } = useMe();
  const meId = me?.id ?? null;

  const {
    messages,
    loading,
    hasMore,
    loadMore,
    send,
    edit,
    delete: deleteMsg,
    markReadUpTo,
  } = useMessages(conversationId);
  const { typing, signalTyping } = useTyping(conversationId);

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
  // message lands at the tail. Skip optimistic temp messages
  // (no `sequence` yet — server hasn't seen the id) to avoid
  // 404s when send-then-immediately-mark races the round-trip.
  // Wrapping in try/catch lets us survive any other transient
  // membership-write failures without breaking the chat.
  const lastMarkedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!readReceipts) return;
    if (messages.length === 0) return;
    const latest = messages[messages.length - 1];
    if (!latest || !latest.id) return;
    if (latest.id === lastMarkedRef.current) return;
    // Optimistic temp messages don't have a server-assigned sequence.
    // Marking them would 404 (server hasn't processed the send yet);
    // wait for the realtime confirmation to land, which replaces the
    // temp with a real message carrying a real sequence.
    if (typeof latest.sequence !== 'number' || latest.sequence <= 0) return;
    lastMarkedRef.current = latest.id;
    void markReadUpTo(latest.id).catch(() => {
      // Reset so we retry on the next message arrival.
      lastMarkedRef.current = null;
    });
    onMarkedRead?.(conversationId, latest.id);
  }, [messages, meId, readReceipts, markReadUpTo, onMarkedRead, conversationId]);

  const renderItem = useCallback(
    (msg: Message): ReactElement => {
      if (renderMessage) return <>{renderMessage(msg, meId)}</>;
      const readState: 'sent' | 'read' | undefined =
        readReceipts && meId !== null && msg.sender_id === meId
          ? readStateForMessage(msg, members, meId, sequenceByMessageId)
          : undefined;
      return (
        <MessageRow
          msg={msg}
          meId={meId}
          reactions={reactions}
          attachments={attachments}
          actions={actions}
          threads={threads}
          quotations={quotations}
          {...(readState ? { readState } : {})}
          editing={editingId === msg.id}
          onStartEdit={() => setEditingId(msg.id)}
          onCancelEdit={() => setEditingId(null)}
          onSaveEdit={async (body) => {
            await edit(msg.id, body);
            setEditingId(null);
          }}
          onDelete={() => deleteMsg(msg.id)}
          {...(threads ? { onOpenThread: () => setThreadRoot(msg) } : {})}
          {...(quotations ? { onQuote: () => setReplyingTo(msg) } : {})}
          {...(labelFor ? { labelFor } : {})}
          {...(avatarFor ? { avatarFor } : {})}
          showSenderName={showSenderLabels}
          showAvatar={showAvatars}
          maxBodyLength={maxBodyLength}
        />
      );
    },
    [
      renderMessage,
      meId,
      readReceipts,
      members,
      reactions,
      attachments,
      actions,
      threads,
      quotations,
      editingId,
      edit,
      deleteMsg,
      labelFor,
      avatarFor,
      showSenderLabels,
      showAvatars,
      maxBodyLength,
      sequenceByMessageId,
    ],
  );

  const composerProps = useMemo(
    () => ({
      onSend: async (
        body: string,
        opts?: { quoted_message_id?: Uuid; attachment_ids?: Uuid[]; mentions?: Uuid[] },
      ) => {
        await send({ body, ...opts });
        setReplyingTo(null);
        // Tell the parent so it can refresh ITS useConversations
        // state. useConversations creates isolated state per call
        // site, so a refetch from here wouldn't update PoolseInbox's
        // list — only the parent's own hook instance can.
        onSent?.(conversationId);
      },
      onTyping: signalTyping,
      ...(attachments ? { onAttachPress: () => setPickerOpen(true) } : {}),
      ...(replyingTo ? { replyingTo } : {}),
      onCancelReply: () => setReplyingTo(null),
      ...(labelFor ? { labelFor } : {}),
      attachments,
      keyboardOffset,
    }),
    [send, signalTyping, attachments, replyingTo, labelFor, keyboardOffset, onSent, conversationId],
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
        <View style={styles.listWrap}>
          <MessageList
            messages={messages}
            loading={loading}
            hasMore={hasMore}
            onLoadMore={loadMore}
            renderItem={renderItem}
            ListHeader={<TypingIndicator typing={typing} {...(labelFor ? { labelFor } : {})} />}
            {...(emptyState !== undefined ? { emptyState } : {})}
          />
        </View>

        {mentions ? (
          <MentionInput conversationId={conversationId} {...composerProps} />
        ) : (
          <MessageComposer {...composerProps} />
        )}

        {attachments ? (
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
  listWrap: {
    flex: 1,
  },
});
