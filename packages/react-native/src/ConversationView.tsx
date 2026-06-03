import type { Message, Uuid } from '@poolse/sdk';
import { useMe, useMembers, useMessages, useTyping } from '@poolse/react';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { AttachmentPicker } from './AttachmentPicker.js';
import { ChatHeader } from './ChatHeader.js';
import { MentionInput } from './MentionInput.js';
import { MessageComposer } from './MessageComposer.js';
import { MessageList } from './MessageList.js';
import { MessageRow } from './MessageRow.js';
import { ThreadView } from './ThreadView.js';
import { TypingIndicator } from './TypingIndicator.js';
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

  /** Fires when auto-mark-read commits — clear sidebar badges via this. */
  onMarkedRead?: (conversationId: string) => void;
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

  const renderItem = useCallback(
    (msg: Message): ReactElement => {
      if (renderMessage) return <>{renderMessage(msg, meId)}</>;
      const readState: 'sent' | 'read' | undefined =
        readReceipts && meId !== null && msg.sender_id === meId
          ? readStateForMessage(msg, members, meId)
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
    ],
  );

  const ComposerBase = mentions ? MentionInput : MessageComposer;
  const composerProps = useMemo(
    () => ({
      onSend: async (
        body: string,
        opts?: { quoted_message_id?: Uuid; attachment_ids?: Uuid[]; mentions?: Uuid[] },
      ) => {
        await send({ body, ...opts });
        setReplyingTo(null);
      },
      onTyping: signalTyping,
      ...(attachments ? { onAttachPress: () => setPickerOpen(true) } : {}),
      ...(replyingTo ? { replyingTo } : {}),
      onCancelReply: () => setReplyingTo(null),
      ...(labelFor ? { labelFor } : {}),
      attachments,
    }),
    [send, signalTyping, attachments, replyingTo, labelFor],
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
    <View style={[styles.root, { backgroundColor: theme.colors.paper }]}>
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
    </View>
  );
}

function readStateForMessage(
  msg: Message,
  members: ReadonlyArray<{ user_id: string; last_read_message_id: string | null }>,
  meId: string,
): 'sent' | 'read' {
  const otherMembers = members.filter((m) => m.user_id !== meId);
  if (otherMembers.length === 0) return 'sent';
  const anyRead = otherMembers.some(
    (m) => m.last_read_message_id !== null && msg.id !== null && m.last_read_message_id >= msg.id,
  );
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
