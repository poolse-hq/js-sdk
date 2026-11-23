// ThreadView — side-pane companion to ConversationView for replies
// rooted at a single message. Composes useThread + MessageBubble +
// MessageComposer with the same brand styling as the main view.
//
// Customers position it however they want (right-side drawer,
// modal, full-screen on mobile, etc.). ConversationView's
// `threads` prop drives an opt-in inline integration where clicking
// "reply" on a message opens this in a right pane.

import type { Message, MessageCreateRequest, Uuid } from '@poolse/sdk';
import { useMe, useThread, useThreadFollow } from '@poolse/react';
import React, {
  Fragment,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { MessageBubble } from './MessageBubble.js';
import {
  MessageComposer,
  type BeforeSend,
  type ComposerPassThroughProps,
  type MessageComposerHandle,
} from './MessageComposer.js';
import type { ChatDensity, ChatLayout, TimeFormat } from './layout.js';
import { EmptyState } from './EmptyState.js';
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
  /** Row layout for the replies — see `ChatLayout`. Defaults to `'bubbles'`. */
  layout?: ChatLayout;
  timeFormat?: TimeFormat;
  /**
   * Row spacing. Inside `ConversationView` the thread follows the view's
   * own `density`; set it when using ThreadView on its own.
   */
  density?: ChatDensity;
  /** Avatars on replies, as `ConversationView`'s `showAvatars`. */
  showAvatars?: boolean;
  /** Presence badges on reply avatars. Defaults to `false`. */
  showPresence?: boolean;
  /** Link previews under replies. Defaults to `true`. */
  linkPreviews?: boolean;
  /** Largest attachment accepted, in bytes (see `MessageComposer`). */
  maxFileSize?: number;
  /** Accepted attachment types (see `MessageComposer`). */
  acceptFileTypes?: string[];
  /**
   * A Follow / Following button in the header (MS19): who gets a push for
   * the thread's replies. Default `true`.
   */
  follow?: boolean;
  /**
   * An "Also send to channel" checkbox under the composer (MS19). Default
   * `true`; turn it off in a direct message.
   */
  alsoSendToChannel?: boolean;
  /** Passed through to the composer, as `ConversationView`'s `composerProps`. */
  composerProps?: ComposerPassThroughProps;
  /** Rendered above the composer. */
  composerAccessory?: ReactNode;
  /** The composer's handle: `focus`, `insertText`, `setText`, `getText`, `clear`, `addFiles`. */
  composerHandle?: Ref<MessageComposerHandle>;
  /** Runs before every reply: return it (changed or not), or `false` to cancel. */
  beforeSend?: BeforeSend;
}

export function ThreadView({
  conversationId,
  rootMessage,
  onClose,
  renderMessage,
  layout,
  timeFormat,
  density,
  showAvatars,
  showPresence = false,
  linkPreviews = true,
  maxFileSize,
  acceptFileTypes,
  follow = true,
  alsoSendToChannel = true,
  composerProps,
  composerAccessory,
  composerHandle,
  beforeSend,
}: ThreadViewProps) {
  const { me } = useMe();
  const followState = useThreadFollow(follow ? rootMessage.id : null);
  const [alsoToChannel, setAlsoToChannel] = useState(false);
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
  useImperativeHandle(
    composerHandle,
    (): MessageComposerHandle => ({
      addFiles: (files) => composerRef.current?.addFiles(files),
      getText: () => composerRef.current?.getText() ?? '',
      setText: (text) => composerRef.current?.setText(text),
      insertText: (text) => composerRef.current?.insertText(text),
      clear: () => composerRef.current?.clear(),
      focus: () => composerRef.current?.focus(),
    }),
    [],
  );

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

  // Focus the close button on open; Esc inside the pane closes it. Esc
  // is heard on the pane itself, not the document, so a thread beside
  // another view (or a second thread) only closes when it has focus —
  // and an Esc a child already used (cancelling a reply or an edit)
  // doesn't close it. We do NOT restore focus on close — that's the
  // parent's job, since the trigger isn't owned here.
  useEffect(() => {
    closeBtnRef.current?.focus();
  }, []);
  const onPaneKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented || !onClose) return;
    e.preventDefault();
    onClose();
  };

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
      {...(layout ? { layout } : {})}
      {...(timeFormat ? { timeFormat } : {})}
      {...(showAvatars !== undefined ? { showAvatar: showAvatars } : {})}
      showPresence={showPresence}
      linkPreviews={linkPreviews}
    />
  );

  const renderOne = renderMessage
    ? (msg: Message, currentUserId: string | null) => renderMessage(msg, currentUserId)
    : (msg: Message) => renderDefault(msg);

  return (
    <aside
      className={`poolse-thread${density ? ` poolse-conversation--density-${density}` : ''}${
        dragActive ? ' is-drag-active' : ''
      }`}
      role="complementary"
      aria-label="Message thread"
      onKeyDown={onPaneKeyDown}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Header */}
      <header className="poolse-thread__header">
        <div className="poolse-thread__title">Thread</div>
        {follow && followState.following !== null && (
          <button
            type="button"
            className={`poolse-thread__follow${followState.following ? ' poolse-thread__follow--on' : ''}`}
            aria-pressed={followState.following}
            onClick={() => void followState.setFollowing(!followState.following)}
            title={
              followState.following
                ? 'You get notified about new replies'
                : 'Get notified about new replies'
            }
          >
            <PoolseIcon name="bell" size={14} label={null} />
            <span>{followState.following ? 'Following' : 'Follow'}</span>
          </button>
        )}
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
      <div className="poolse-thread__messages" ref={listRef} role="log" aria-label="Replies">
        {hasMore && !loading && replies.length > 0 && (
          <button type="button" className="poolse-conversation__load-more" onClick={loadMore}>
            Load older replies
          </button>
        )}

        {loading && replies.length === 0 ? (
          <div className="poolse-conversation__empty">Loading replies…</div>
        ) : replies.length === 0 ? (
          <EmptyState title="No replies yet" hint="Write a reply below to start the thread." />
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
      {composerAccessory}
      <MessageComposer
        ref={composerRef}
        onSend={async (body, opts) => {
          let draft: MessageCreateRequest = {
            body,
            ...(opts?.attachment_ids && opts.attachment_ids.length > 0
              ? { attachment_ids: opts.attachment_ids }
              : {}),
            ...(opts?.dlp_acknowledged ? { dlp_acknowledged: true } : {}),
            ...(alsoSendToChannel && alsoToChannel ? { also_send_to_channel: true } : {}),
          };
          if (beforeSend) {
            const changed = await beforeSend(draft);
            if (changed === false) return false;
            draft = changed;
          }
          await sendReply(draft);
          setAlsoToChannel(false);
          return undefined;
        }}
        placeholder="Reply in thread…"
        {...(maxFileSize !== undefined ? { maxFileSize } : {})}
        {...(acceptFileTypes ? { acceptFileTypes } : {})}
        {...composerProps}
      />
      {alsoSendToChannel && (
        <label className="poolse-thread__also">
          <input
            type="checkbox"
            checked={alsoToChannel}
            onChange={(e) => setAlsoToChannel(e.target.checked)}
          />
          <span>Also send to channel</span>
        </label>
      )}

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
