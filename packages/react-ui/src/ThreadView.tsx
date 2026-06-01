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
import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { MessageBubble } from './MessageBubble.js';
import { MessageComposer } from './MessageComposer.js';
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
  const { replies, loading, error, hasMore, loadMore, sendReply } = useThread(
    conversationId,
    rootMessage.id,
  );

  const listRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const lastReplyIdRef = useRef<string | null>(null);

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

  const renderOne = renderMessage ?? defaultRenderReply;

  return (
    <aside
      className="poolse-thread"
      role="complementary"
      aria-label="Message thread"
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

      {/* Composer */}
      <MessageComposer onSend={(body) => sendReply({ body })} placeholder="Reply in thread…" />
    </aside>
  );
}

// Thread replies share the main-feed feature set (reactions,
// attachments, action popover) so the popover affordances feel
// consistent. Nested threads stay off — a thread can't spawn its
// own thread — and edit/delete aren't wired in v1 since ThreadView
// doesn't own that state.
function defaultRenderReply(msg: Message, currentUserId: string | null) {
  return (
    <MessageRow
      msg={msg}
      meId={currentUserId}
      reactions
      attachments
      actions
      threads={false}
      quotations={false}
    />
  );
}
