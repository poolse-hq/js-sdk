// ThreadView — side-pane companion to ConversationView for replies
// rooted at a single message. Composes useThread + MessageBubble +
// MessageComposer with the same brand styling as the main view.
//
// Customers position it however they want (right-side drawer,
// modal, full-screen on mobile, etc.). ConversationView's
// `threads` prop drives an opt-in inline integration where clicking
// "reply" on a message opens this in a right pane.

import type { Message, Uuid } from '@poolse/sdk';
import { useMe, useThread } from '@poolse/react';
import React, { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { MessageBubble } from './MessageBubble.js';
import { MessageComposer, type MessageComposerHandle } from './MessageComposer.js';
import { MessageRow } from './MessageRow.js';
import { PoolseIcon } from './PoolseIcon.js';

export interface ThreadViewProps {
  conversationId: Uuid;
  /** The root message of the thread. ThreadView shows this at the top + lists replies under it. */
  rootMessage: Message;
  /** Triggered when the user closes the pane (X button). */
  onClose?: () => void;
  /**
   * Optional override for rendering each reply. Defaults to the
   * brand-styled <MessageBubble>.
   */
  renderMessage?: (msg: Message, currentUserId: string | null) => ReactNode;
}

export function ThreadView({
  conversationId,
  rootMessage,
  onClose,
  renderMessage,
}: ThreadViewProps) {
  const { me } = useMe();
  const {
    replies,
    loading,
    error,
    hasMore,
    loadMore,
    sendReply,
    edit,
    delete: deleteReply,
  } = useThread(conversationId, rootMessage.id);

  // In-place edit state, owned by ThreadView so each reply row can
  // surface the edit/delete affordances on its own action popover.
  // Mirrors the same pattern ConversationView uses for the main feed.
  const [editingId, setEditingId] = useState<Uuid | null>(null);
  useEffect(() => {
    setEditingId(null);
  }, [rootMessage.id]);

  const listRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const lastReplyIdRef = useRef<string | null>(null);
  // Composer ref so drag-and-dropped files on the thread pane forward
  // into the same queue the paperclip + send flow consume.
  const composerRef = useRef<MessageComposerHandle | null>(null);

  // Drag-and-drop handlers — match ConversationView's behavior so
  // dropping files anywhere on the thread pane enqueues them in the
  // composer's upload queue.
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const isFileDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const onDragEnter = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) composerRef.current?.addFiles(files);
  };

  // Auto-scroll on new reply (same pattern as ConversationView).
  useEffect(() => {
    const tail = replies[replies.length - 1];
    if (!tail) return;
    if (tail.id === lastReplyIdRef.current) return;
    lastReplyIdRef.current = tail.id;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [replies]);

  // Focus the close button on open + ESC closes the pane. We do NOT
  // restore focus to the previously-focused element on close — that's
  // the parent's job (ConversationView focuses the message that
  // spawned the thread), since the trigger isn't owned here.
  useEffect(() => {
    closeBtnRef.current?.focus();
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Default reply renderer — uses MessageRow with the same feature
  // surface as the main feed (chevron-triggered action popover with
  // edit + delete on own messages), minus nested threads and quote
  // replies (no quote target inside the thread side-pane in v1).
  // `renderMessage` callers retain full control and can ignore this.
  const renderDefault = (msg: Message) => (
    <MessageRow
      msg={msg}
      meId={me?.id ?? null}
      reactions
      attachments
      actions
      threads={false}
      quotations={false}
      editing={editingId === msg.id}
      onStartEdit={() => setEditingId(msg.id)}
      onCancelEdit={() => setEditingId(null)}
      onSaveEdit={async (body: string) => {
        await edit(msg.id, body);
        setEditingId(null);
      }}
      onDelete={() => void deleteReply(msg.id)}
    />
  );

  const renderOne = renderMessage
    ? (msg: Message, currentUserId: string | null) => renderMessage(msg, currentUserId)
    : (msg: Message) => renderDefault(msg);

  return (
    <aside
      className={`poolse-thread${dragActive ? ' is-drag-active' : ''}`}
      role="complementary"
      aria-label="Message thread"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Header */}
      <header className="poolse-thread__header">
        <div className="poolse-thread__title">Thread</div>
        {onClose && (
          <button
            ref={closeBtnRef}
            type="button"
            className="poolse-icon-btn"
            onClick={onClose}
            aria-label="Close thread"
          >
            <PoolseIcon name="close" size={18} label={null} />
          </button>
        )}
      </header>

      {/* Root message preview (always visible at top) */}
      <div className="poolse-thread__root">
        <MessageBubble message={rootMessage} currentUserId={me?.id ?? null} />
      </div>

      {/* Replies list */}
      <div className="poolse-thread__messages" ref={listRef}>
        {hasMore && !loading && replies.length > 0 && (
          <button type="button" className="poolse-conversation__load-more" onClick={loadMore}>
            Load older replies
          </button>
        )}

        {loading && replies.length === 0 ? (
          <div className="poolse-conversation__empty">Loading replies…</div>
        ) : replies.length === 0 ? (
          <div className="poolse-conversation__empty">No replies yet — start the thread.</div>
        ) : (
          // Same Fragment trick as ConversationView so MessageBubble
          // remains the direct flex child for align-self to work.
          replies.map((msg) => <Fragment key={msg.id}>{renderOne(msg, me?.id ?? null)}</Fragment>)
        )}

        {error && <div className="poolse-conversation__empty">Failed to load: {error.message}</div>}
      </div>

      {/* Composer — full attachment surface (paperclip, queue chips,
          text + files together). Drops onto the thread pane forward
          into the same queue via composerRef. */}
      <MessageComposer
        ref={composerRef}
        onSend={(body, opts) =>
          sendReply({
            body,
            ...(opts?.attachment_ids && opts.attachment_ids.length > 0
              ? { attachment_ids: opts.attachment_ids }
              : {}),
          })
        }
        placeholder="Reply in thread…"
      />

      {dragActive && (
        <div className="poolse-conversation__drop-overlay" aria-hidden="true">
          <div className="poolse-conversation__drop-overlay-inner">
            <PoolseIcon name="attachment" size={40} label={null} />
            <div className="poolse-conversation__drop-overlay-title">Drop files to upload</div>
            <div className="poolse-conversation__drop-overlay-hint">
              They'll be sent in one reply
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

