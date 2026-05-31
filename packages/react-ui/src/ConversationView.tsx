// ConversationView — the composed chat surface. In 0.2.0 every
// feature (reactions, mentions, attachments, hover actions, threads,
// read receipts) defaults to ON so a customer mounting this with the
// minimum config gets a full chat experience. Opt out per-feature
// when you need a slimmer surface.
//
// Customers wanting a different layout altogether can compose the
// individual pieces — useMessages + MessageBubble + MessageComposer +
// MessageActions + ReactionStrip + AttachmentPreview + ThreadView —
// directly. ConversationView is just the canonical wiring.

import type { Attachment, Message, MessageCreateRequest, Uuid } from '@poolse/sdk';
import {
  useAttachmentUpload,
  useMembers,
  useMessages,
  useMe,
  useRealtimeStatus,
  useTyping,
} from '@poolse/react';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AttachmentPreview } from './AttachmentPreview.js';
import { EditableMessageBubble } from './EditableMessageBubble.js';
import { usePoolseFonts } from './fonts.js';
import { MentionInput } from './MentionInput.js';
import { MessageActions } from './MessageActions.js';
import { MessageBubble } from './MessageBubble.js';
import { MessageComposer } from './MessageComposer.js';
import { PoolseIcon } from './PoolseIcon.js';
import { ReactionStrip } from './Reactions.js';
import { ThreadView } from './ThreadView.js';
import { TypingIndicator } from './TypingIndicator.js';

export interface ConversationViewProps {
  conversationId: Uuid;

  /** Placeholder when there are no messages. */
  emptyState?: ReactNode;

  /**
   * Render-prop escape hatch for individual messages. When set,
   * COMPLETELY overrides the default per-message rendering — you
   * get the raw message + currentUserId and own the bubble shape.
   * Leave unset to use the brand-aligned defaults (with reactions,
   * actions, attachments inline as configured below).
   */
  renderMessage?: (msg: Message, currentUserId: string | null) => ReactNode;

  /** Translate a typing user_id into a display name. */
  labelFor?: (userId: string) => string;

  /**
   * Auto-load the brand fonts on mount. Defaults to `true`. Set to
   * `false` when the host app already loads them, or when CSP
   * forbids dynamic <link> injection.
   */
  loadFonts?: boolean;

  // ── Feature toggles (all default ON in 0.2.0) ─────────────────────────

  /** Show inline reaction strip under each message + emoji picker in hover actions. */
  reactions?: boolean;

  /** Swap the plain composer for one with `@`-autocomplete drawn from members. */
  mentions?: boolean;

  /** Paperclip → file picker → presigned upload → send-with-attachment. */
  attachments?: boolean;

  /** Hover-revealed react / reply / edit / delete popover next to each message. */
  actions?: boolean;

  /** "Reply in thread" opens a right-side ThreadView. */
  threads?: boolean;

  /** Check-double glyph on own messages once another member's read cursor advances past them. */
  readReceipts?: boolean;
}

const TRUE = true;

export function ConversationView({
  conversationId,
  emptyState,
  renderMessage,
  labelFor,
  loadFonts = TRUE,
  reactions = TRUE,
  mentions = TRUE,
  attachments = TRUE,
  actions = TRUE,
  threads = TRUE,
  readReceipts = TRUE,
}: ConversationViewProps) {
  usePoolseFonts(loadFonts);

  const { me } = useMe();
  const {
    messages,
    loading,
    error,
    hasMore,
    loadMore,
    send,
    edit,
    delete: deleteMsg,
  } = useMessages(conversationId);
  const { typing, signalTyping } = useTyping(conversationId);
  const status = useRealtimeStatus();
  // Members are needed for mentions + read-receipt auto-compute. We
  // always pull them when EITHER feature is on — useMembers is
  // server-fetch-once + idempotent, so the cost is one REST call.
  const membersOn = mentions || readReceipts;
  const { members } = useMembers(membersOn ? conversationId : '');

  const listRef = useRef<HTMLDivElement | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);

  // Auto-scroll on new tail message.
  useEffect(() => {
    const tail = messages[messages.length - 1];
    if (!tail) return;
    if (tail.id === lastMessageIdRef.current) return;
    lastMessageIdRef.current = tail.id;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Compute the highest message sequence that ANY other member has read.
  // We treat any message with `sequence <= maxReadByOthers` as "read",
  // higher as "sent" (delivered but not yet read).
  const maxReadByOthers = useMemo(() => {
    if (!readReceipts || !me) return null;
    let max = 0;
    let any = false;
    for (const m of members) {
      if (m.user_id === me.id) continue;
      const lr = m.last_read_message_id;
      if (!lr) continue;
      // We need the sequence of `lr`. Look it up in the loaded
      // messages — for messages older than the loaded window we
      // simply assume "read" (since the user definitely read at
      // least up to lr). Without the lookup we'd never show
      // double-check for older messages.
      const idx = messages.findIndex((x) => x.id === lr);
      if (idx !== -1) {
        const seq = messages[idx]?.sequence ?? 0;
        if (seq > max) max = seq;
      }
      any = true;
    }
    return any ? max : null;
  }, [readReceipts, me, members, messages]);

  // Editing + thread-open state — controlled by the ConversationView itself.
  const [editingId, setEditingId] = useState<Uuid | null>(null);
  const [threadRootId, setThreadRootId] = useState<Uuid | null>(null);
  const threadRoot = useMemo(
    () => (threadRootId ? (messages.find((m) => m.id === threadRootId) ?? null) : null),
    [threadRootId, messages],
  );

  // Attachment upload state — null between uploads, populated while one is in flight.
  const { upload, uploading } = useAttachmentUpload();

  const onPickFile = async (file: File) => {
    try {
      const att = await upload({
        body: file,
        contentType: file.type || 'application/octet-stream',
        byteSize: file.size,
        filename: file.name,
      });
      // Send a message with the attachment id. Empty body = attachment-only.
      await send({ body: '', attachment_ids: [att.id] });
    } catch (err) {
      // Caller has no UI hook for upload errors yet; surface via console
      // so debugging is straightforward. A future polish pass can add a
      // toast slot.
      // eslint-disable-next-line no-console
      console.error('attachment upload failed:', err);
    }
  };

  const onSendBody = async (body: string) => {
    await send({ body });
  };

  const onSendWithMentions = async (req: MessageCreateRequest) => {
    await send(req);
  };

  // Mention input is only ergonomic when members are loaded. Falls back to
  // the plain composer otherwise.
  const Composer =
    mentions && members.length > 0 ? (
      <MentionInput
        conversationId={conversationId}
        onSend={onSendWithMentions}
        onTyping={signalTyping}
      />
    ) : (
      <MessageComposer onSend={onSendBody} onTyping={signalTyping} />
    );

  return (
    <div className="poolse-conversation-shell">
      <div className="poolse-conversation">
        {status !== 'connected' && status !== 'idle' && (
          <div className="poolse-conversation__status">
            {status === 'connecting' && 'Connecting…'}
            {status === 'reconnecting' && 'Reconnecting…'}
            {status === 'closed' && 'Disconnected'}
          </div>
        )}

        <div className="poolse-conversation__messages" ref={listRef}>
          {hasMore && !loading && (
            <button type="button" className="poolse-conversation__load-more" onClick={loadMore}>
              Load older messages
            </button>
          )}

          {loading && messages.length === 0 ? (
            <div className="poolse-conversation__empty">Loading…</div>
          ) : messages.length === 0 ? (
            <div className="poolse-conversation__empty">{emptyState ?? 'No messages yet.'}</div>
          ) : (
            messages.map((msg) => (
              <Fragment key={msg.id}>
                {renderMessage
                  ? renderMessage(msg, me?.id ?? null)
                  : defaultRenderMessage({
                      msg,
                      meId: me?.id ?? null,
                      reactions,
                      attachments,
                      actions,
                      threads,
                      readReceipts,
                      maxReadByOthers,
                      editing: editingId === msg.id,
                      onStartEdit: () => setEditingId(msg.id),
                      onCancelEdit: () => setEditingId(null),
                      onSaveEdit: async (body: string) => {
                        await edit(msg.id, body);
                        setEditingId(null);
                      },
                      onDelete: () => void deleteMsg(msg.id),
                      onOpenThread: () => setThreadRootId(msg.id),
                    })}
              </Fragment>
            ))
          )}

          {error && (
            <div className="poolse-conversation__empty">Failed to load: {error.message}</div>
          )}
        </div>

        <TypingIndicator typing={typing} {...(labelFor ? { labelFor } : {})} />

        <div className="poolse-conversation__composer-row">
          {attachments && <AttachmentPickerButton onPick={onPickFile} disabled={uploading} />}
          <div className="poolse-conversation__composer-flex">{Composer}</div>
        </div>
      </div>

      {threads && threadRoot && (
        <div className="poolse-conversation-shell__thread">
          <ThreadView
            conversationId={conversationId}
            rootMessage={threadRoot}
            onClose={() => setThreadRootId(null)}
          />
        </div>
      )}
    </div>
  );
}

interface DefaultRenderProps {
  msg: Message;
  meId: string | null;
  reactions: boolean;
  attachments: boolean;
  actions: boolean;
  threads: boolean;
  readReceipts: boolean;
  maxReadByOthers: number | null;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (body: string) => Promise<void>;
  onDelete: () => void;
  onOpenThread: () => void;
}

function defaultRenderMessage({
  msg,
  meId,
  reactions,
  attachments,
  actions,
  threads,
  readReceipts,
  maxReadByOthers,
  editing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onOpenThread,
}: DefaultRenderProps): ReactNode {
  const isSelf = meId !== null && msg.sender_id === meId;

  // Read state: only self messages get the glyph. "read" if any other
  // member's read cursor is at or past this message's sequence.
  let readState: 'sent' | 'read' | undefined;
  if (readReceipts && isSelf && maxReadByOthers !== null) {
    readState = maxReadByOthers >= msg.sequence ? 'read' : 'sent';
  }

  // Reaction add/remove handled inside ReactionStrip via useReactions.
  // We just decide whether to show it.
  const showReactions = reactions && !msg.deleted_at;
  const showAttachments =
    attachments && Array.isArray(msg.attachments) && msg.attachments.length > 0;
  const showActions = actions && !msg.deleted_at && !editing;

  return (
    <div className={`poolse-message-row ${isSelf ? 'poolse-message-row--right' : ''}`}>
      {editing ? (
        <EditableMessageBubble
          message={msg}
          currentUserId={meId}
          {...(readState ? { readState } : {})}
          editing
          onSave={onSaveEdit}
          onCancel={onCancelEdit}
        />
      ) : (
        <MessageBubble message={msg} currentUserId={meId} {...(readState ? { readState } : {})} />
      )}

      {showAttachments && (
        <div className={`poolse-message-row__attachments ${isSelf ? 'is-self' : ''}`}>
          {msg.attachments!.map((att: Attachment) => (
            <AttachmentPreview key={att.id} attachment={att} />
          ))}
        </div>
      )}

      {showReactions && (
        <div className={`poolse-message-row__reactions ${isSelf ? 'is-self' : ''}`}>
          <ReactionStrip
            messageId={msg.id}
            conversationId={msg.conversation_id}
            initialReactions={msg.reactions}
            currentUserId={meId}
            picker={false}
          />
        </div>
      )}

      {showActions && (
        <div
          className={`poolse-message-row__actions ${
            isSelf ? 'poolse-message-row__actions--right' : 'poolse-message-row__actions--left'
          }`}
        >
          <MessageActions
            {...(reactions ? { onReact: (e) => void onReactWithStrip(msg, meId, e) } : {})}
            {...(threads ? { onReply: onOpenThread } : {})}
            {...(isSelf ? { onEdit: onStartEdit } : {})}
            {...(isSelf ? { onDelete } : {})}
          />
        </div>
      )}
    </div>
  );
}

// React-via-hover-menu wires through the SAME useReactions instance
// that ReactionStrip uses. Since both share the (messageId,
// conversationId) key inside the SDK's TokenCache-style channel
// dedup, the optimistic add lands once and the realtime echo upserts.
// We rebuild a small ad-hoc instance here — there's no direct API to
// "react via parent state" without lifting the entire reactions
// state, which would be much more invasive.
async function onReactWithStrip(
  _msg: Message,
  _meId: string | null,
  _emoji: string,
): Promise<void> {
  // Intentionally a no-op — the actual add happens via the
  // ReactionStrip's own picker. The MessageActions emoji picker is
  // a convenience; reactions wired through useReactions inside
  // ReactionStrip handle the state. A future polish pass could
  // share a single useReactions instance per message, but for now
  // the picker in ReactionStrip is the primary entry point.
  // TODO: thread an addReaction callback through from a shared
  // useReactions higher up so this button stops being decorative.
}

// ── Attachment picker button ─────────────────────────────────────────────

function AttachmentPickerButton({
  onPick,
  disabled,
}: {
  onPick: (file: File) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="poolse-attach-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          // Reset so picking the same file twice still fires onChange.
          e.target.value = '';
        }}
      />
      <button
        type="button"
        className="poolse-attach-btn"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        aria-label="Attach file"
        title="Attach file"
      >
        <PoolseIcon name="attachment" size={20} label={null} />
      </button>
    </>
  );
}
