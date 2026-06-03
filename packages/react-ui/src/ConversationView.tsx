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

import type { Message, MessageCreateRequest, Uuid } from '@poolse/sdk';
import { useMembers, useMessages, useMe, useRealtimeStatus, useTyping } from '@poolse/react';
import React, { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePoolseFonts } from './fonts.js';
import { computeGroupPosition, formatDayLabel, sameDay } from './grouping.js';
import { MentionInput } from './MentionInput.js';
import { MessageComposer, type MessageComposerHandle } from './MessageComposer.js';
import { MessageRow } from './MessageRow.js';
import { PoolseIcon } from './PoolseIcon.js';
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

  /**
   * Translate an `external_id` into a display name. Passed through to
   * `MessageBubble`, `TypingIndicator`, `MentionInput`, `MemberList`.
   * Falls back to the SDK's `userResolver` (and then the external_id
   * itself) when omitted.
   */
  labelFor?: (externalId: string) => string;

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

  /**
   * WhatsApp-style quote-reply. Adds a "Reply" action to the hover
   * menu — the new message stays in the main feed with a quoted card
   * above its body, distinct from `threads` (which opens the
   * side-pane). Defaults ON.
   */
  quotations?: boolean;

  /** Check-double glyph on own messages once another member's read cursor advances past them. */
  readReceipts?: boolean;

  /**
   * Render message bodies as Markdown (bold, italic, lists, code,
   * blockquotes, strikethrough, autolinks, ==highlight==). Defaults
   * to `true`. Set `false` for raw-text rendering.
   */
  markdown?: boolean;

  /**
   * Trim message bodies longer than this many characters and show a
   * "Read more" toggle. Defaults to 200. Set 0 to disable.
   */
  maxBodyLength?: number;

  /**
   * Group consecutive messages from the same sender within
   * `groupingWindowMs` (default 5 min) on the same day into a single
   * visual cluster — only the LAST bubble in a cluster shows the
   * asymmetric tail corner, matching WhatsApp / iMessage. Set false
   * to render every bubble as standalone (uniform tails).
   */
  grouping?: boolean;

  /** Milliseconds between same-sender messages to still count as a group. Default 5 min. */
  groupingWindowMs?: number;

  /**
   * Insert a centered day-separator pill between messages whose
   * calendar day differs. Defaults to true.
   */
  daySeparators?: boolean;

  /**
   * Show a colored sender label above other-side bubbles in group
   * chats. Resolved via the customer's `userResolver`.
   *   * `'auto'`   — on when the conversation has more than 2 members
   *   * `'always'` — even in DMs (rarely useful)
   *   * `'never'`  — disable entirely
   * Defaults to `'auto'`.
   */
  senderLabels?: 'auto' | 'always' | 'never';

  /**
   * Show participant avatars to the LEFT of other-side bubbles in
   * group chats. Same `auto | always | never` semantics as
   * `senderLabels`. Defaults to `'auto'`.
   */
  avatars?: 'auto' | 'always' | 'never';

  /**
   * Fired once after the caller's auto-mark-read fires for a fresh
   * message. Useful for clearing a sidebar unread badge before the
   * `member:read` realtime echo round-trips. Receives the conv id so
   * a single handler can switch between rooms.
   */
  onMarkedRead?: (conversationId: string) => void;
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
  quotations = TRUE,
  readReceipts = TRUE,
  markdown = TRUE,
  maxBodyLength = 200,
  grouping = TRUE,
  groupingWindowMs = 5 * 60 * 1000,
  daySeparators = TRUE,
  senderLabels = 'auto',
  avatars = 'auto',
  onMarkedRead,
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
    markReadUpTo,
  } = useMessages(conversationId);
  const { typing, signalTyping } = useTyping(conversationId);
  const status = useRealtimeStatus();
  // Members are needed for mentions + read-receipt auto-compute +
  // the `auto` resolution of senderLabels / avatars in group chats.
  // We always pull them when ANY of those features wants the count
  // — useMembers is server-fetch-once + idempotent, so the cost is
  // one REST call.
  const wantsMemberCount = senderLabels === 'auto' || avatars === 'auto';
  const membersOn = mentions || readReceipts || wantsMemberCount;
  const { members } = useMembers(membersOn ? conversationId : '');

  // Group-chat heuristic: 3+ members triggers per-bubble sender
  // identification (label + avatar) under the `'auto'` setting.
  // `'always'` forces them on, `'never'` forces off.
  const isGroupChat = members.length > 2;
  const showSenderLabelsResolved =
    senderLabels === 'always' || (senderLabels === 'auto' && isGroupChat);
  const showAvatarsResolved = avatars === 'always' || (avatars === 'auto' && isGroupChat);

  const listRef = useRef<HTMLDivElement | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  // Guards re-entrant loadMore calls while one is in flight. Without
  // this, IO would call loadMore again if the sentinel stays in view
  // across the async gap. Plain ref (not state) so check + set is
  // synchronous within the IO callback.
  const loadingMoreRef = useRef(false);

  // Track whether the user is currently pinned to the bottom of the
  // scroller. We use this for TWO things: (a) auto-scroll on new tail
  // only when at bottom (no jumping while reading history), and (b)
  // auto-mark-read once the latest message scrolls into view.
  const [atBottom, setAtBottom] = useState(true);
  const [newCountWhileAway, setNewCountWhileAway] = useState(0);

  // Auto load-more: a top sentinel + IO that fires when the user
  // scrolls up to within `rootMargin` of the messages container's
  // top. Reentry is blocked by `loadingMoreRef`, and the trigger
  // no-ops when `hasMore === false` so we don't loop after history
  // is exhausted. IO only fires on intersection-state transitions —
  // staying intersecting across an async load doesn't re-fire on its
  // own. The deps re-create the observer when `hasMore`/`loadMore`
  // change, which is correct: a stale `loadMore` closure would call
  // against the wrong cursor.
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const root = listRef.current;
    if (!sentinel || !root) return;
    if (!hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (loadingMoreRef.current) return;
        loadingMoreRef.current = true;
        void Promise.resolve(loadMore()).finally(() => {
          loadingMoreRef.current = false;
        });
      },
      // Fire when sentinel is within ~400px above the viewport — the
      // user is approaching the top of loaded history, fetch ahead.
      { root, rootMargin: '400px 0px 0px 0px', threshold: 0 },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [hasMore, loadMore]);

  // Observe the bottom sentinel — it's a 1px div at the end of the
  // message list. Visible = scroller is pinned to bottom.
  useEffect(() => {
    const el = bottomSentinelRef.current;
    if (!el) return;
    const root = listRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        setAtBottom(entry.isIntersecting);
        if (entry.isIntersecting) {
          // Coming back to the bottom — clear the "new messages while
          // away" badge.
          setNewCountWhileAway(0);
        }
      },
      { root, threshold: 0.95 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Auto-scroll on new tail message, but only when the user is at the
  // bottom. Otherwise just bump the unread counter so the
  // scroll-to-new button can show it.
  useEffect(() => {
    const tail = messages[messages.length - 1];
    if (!tail) return;
    if (tail.id === lastMessageIdRef.current) return;
    const isFirstSet = lastMessageIdRef.current === null;
    lastMessageIdRef.current = tail.id;

    if (atBottom || isFirstSet) {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    } else if (me && tail.sender_id !== me.id) {
      // Only count messages from OTHERS as "unread while scrolled up"
      // — your own sends are obviously not new-to-you.
      setNewCountWhileAway((n) => n + 1);
    }
  }, [messages, atBottom, me]);

  // Auto-mark-read whenever the latest message is in view.
  // Fire-and-forget — the server handles dedup if we call repeatedly
  // with the same id, and `useMessages.markReadUpTo` doesn't mutate
  // local state.
  const lastMarkedReadRef = useRef<Uuid | null>(null);
  useEffect(() => {
    if (!atBottom) return;
    if (messages.length === 0) return;
    const tail = messages[messages.length - 1];
    if (!tail) return;
    // Don't mark optimistic temp messages (which have
    // sequence === MAX_SAFE_INTEGER) — wait for the canonical row.
    if (tail.sequence === Number.MAX_SAFE_INTEGER) return;
    if (lastMarkedReadRef.current === tail.id) return;
    lastMarkedReadRef.current = tail.id;
    void markReadUpTo(tail.id)
      .then(() => {
        onMarkedRead?.(conversationId);
      })
      .catch(() => {
        // Allow re-attempt on next tail.
        lastMarkedReadRef.current = null;
      });
  }, [atBottom, messages, markReadUpTo, onMarkedRead, conversationId]);

  const scrollToBottom = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setNewCountWhileAway(0);
  };

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
  // Quote-reply state — caller-owned per the MessageComposer contract.
  // Lifted here so any row's "Reply" action can flip the composer into
  // quote mode, and so the chip dismisses when the conversation changes.
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  useEffect(() => {
    setReplyingTo(null);
    setEditingId(null);
    setThreadRootId(null);
  }, [conversationId]);

  // Scroll-to-original handler for the quoted card. Tries to find the
  // target row in the loaded window and scrolls it into view. If the
  // original isn't in the loaded window (older than our pagination
  // depth), no-op — quote previews stay readable on the bubble itself
  // so missing the scroll isn't blocking.
  const scrollToOriginal = (id: Uuid) => {
    const root = listRef.current;
    if (!root) return;
    const el = root.querySelector(`[data-message-id="${id}"]`);
    if (!(el instanceof HTMLElement)) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('poolse-message-row--highlight');
    setTimeout(() => el.classList.remove('poolse-message-row--highlight'), 1600);
  };

  // Composer owns the attachment upload queue (paperclip + chip
  // strip + send-with-attachments). We forward drag-dropped files
  // into it via this imperative ref so dropping on the conversation
  // pane behaves identically to clicking the paperclip.
  const composerRef = useRef<MessageComposerHandle | null>(null);

  // Drag-and-drop state. `dragDepth` counts nested dragenter/dragleave
  // pairs so the overlay only hides when the drag truly leaves the
  // outer container (children fire leave→enter on every hop otherwise).
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);

  const isFileDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files');

  const onDragEnter = (e: React.DragEvent) => {
    if (!attachments || !isFileDrag(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!attachments || !isFileDrag(e)) return;
    // Must preventDefault on dragover for drop to fire.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!attachments || !isFileDrag(e)) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!attachments || !isFileDrag(e)) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) composerRef.current?.addFiles(files);
  };

  const onSendBody = async (
    body: string,
    opts?: { quoted_message_id?: Uuid; attachment_ids?: Uuid[] },
  ) => {
    await send({
      body,
      ...(opts?.quoted_message_id ? { quoted_message_id: opts.quoted_message_id } : {}),
      ...(opts?.attachment_ids && opts.attachment_ids.length > 0
        ? { attachment_ids: opts.attachment_ids }
        : {}),
    });
    setReplyingTo(null);
  };

  const onSendWithMentions = async (req: MessageCreateRequest) => {
    await send(req);
    setReplyingTo(null);
  };

  // Mention input is only ergonomic when members are loaded. Falls back to
  // the plain composer otherwise. Both variants accept the same
  // `replyingTo` / `onCancelReply` props for the quote-reply chip, and
  // both expose the same `addFiles` imperative handle for drag-drop.
  const Composer =
    mentions && members.length > 0 ? (
      <MentionInput
        ref={composerRef}
        conversationId={conversationId}
        onSend={onSendWithMentions}
        onTyping={signalTyping}
        attachments={attachments}
        {...(labelFor ? { labelFor } : {})}
        {...(quotations ? { replyingTo, onCancelReply: () => setReplyingTo(null) } : {})}
      />
    ) : (
      <MessageComposer
        ref={composerRef}
        onSend={onSendBody}
        onTyping={signalTyping}
        attachments={attachments}
        {...(labelFor ? { labelFor } : {})}
        {...(quotations ? { replyingTo, onCancelReply: () => setReplyingTo(null) } : {})}
      />
    );

  return (
    <div className="poolse-conversation-shell">
      <div
        className={`poolse-conversation${dragActive ? ' is-drag-active' : ''}`}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {status !== 'connected' && status !== 'idle' && (
          <div
            className="poolse-conversation__status"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {status === 'connecting' && 'Connecting…'}
            {status === 'reconnecting' && 'Reconnecting…'}
            {status === 'closed' && 'Disconnected'}
          </div>
        )}

        <div
          className="poolse-conversation__messages"
          ref={listRef}
          role="log"
          aria-label="Conversation messages"
          aria-live="polite"
          aria-relevant="additions"
        >
          {/* Top sentinel for the auto-load IntersectionObserver.
              Rendered only while there's more history to fetch so IO
              doesn't observe a dead element. */}
          {hasMore && <div ref={topSentinelRef} aria-hidden="true" style={{ height: 1 }} />}

          {loading && messages.length === 0 ? (
            <div className="poolse-conversation__empty">Loading…</div>
          ) : messages.length === 0 ? (
            <div className="poolse-conversation__empty">{emptyState ?? 'No messages yet.'}</div>
          ) : (
            messages.map((msg, idx) => {
              if (renderMessage) {
                return <Fragment key={msg.id}>{renderMessage(msg, me?.id ?? null)}</Fragment>;
              }
              const prev: Message | null = idx > 0 ? (messages[idx - 1] ?? null) : null;
              const next: Message | null =
                idx < messages.length - 1 ? (messages[idx + 1] ?? null) : null;
              const groupPosition = grouping
                ? computeGroupPosition(msg, prev, next, groupingWindowMs)
                : 'standalone';
              const showDaySeparator =
                daySeparators && (prev === null || !sameDay(msg.inserted_at, prev.inserted_at));
              // Optimistic quote preview: a message we JUST sent has
              // `quoted_message_id` set but no preloaded
              // `quoted_message` yet (server echo brings that). Look it
              // up in the local feed so the quote card renders
              // immediately instead of flashing in once the realtime
              // echo lands.
              // When a message has a quote-reply target but the
              // server-preloaded preview hasn't landed (optimistic temp
              // pre-echo, or a long-lived chat where the original is
              // paginated outside the loaded window), synthesize the
              // preview from local state so the card renders
              // immediately. `<MessageBubble>` falls back to a
              // "Replying to a message · Loading preview…" placeholder
              // when even the local lookup misses.
              const enriched =
                quotations && msg.quoted_message_id && !msg.quoted_message
                  ? (() => {
                      const original = messages.find((m) => m.id === msg.quoted_message_id);
                      if (!original) return msg;
                      return {
                        ...msg,
                        quoted_message: {
                          id: original.id,
                          sender_id: original.sender_id,
                          sender_external_id: original.sender_external_id,
                          body: original.body,
                          deleted_at: original.deleted_at,
                          inserted_at: original.inserted_at,
                        },
                      };
                    })()
                  : msg;
              // Read-state per row: only self messages, and only when
              // readReceipts is on. "read" if any other member's read
              // cursor is at or past this message's sequence.
              const isSelf = me !== null && msg.sender_id === me.id;
              const readState =
                readReceipts && isSelf && maxReadByOthers !== null
                  ? maxReadByOthers >= msg.sequence
                    ? ('read' as const)
                    : ('sent' as const)
                  : undefined;
              return (
                <Fragment key={msg.id}>
                  {showDaySeparator && (
                    <div className="poolse-day-separator" aria-hidden="false">
                      <span>{formatDayLabel(msg.inserted_at)}</span>
                    </div>
                  )}
                  <MessageRow
                    msg={enriched}
                    meId={me?.id ?? null}
                    reactions={reactions}
                    attachments={attachments}
                    actions={actions}
                    threads={threads}
                    quotations={quotations}
                    groupPosition={groupPosition}
                    maxBodyLength={maxBodyLength}
                    markdown={markdown}
                    showSenderName={showSenderLabelsResolved}
                    showAvatar={showAvatarsResolved}
                    {...(readState ? { readState } : {})}
                    {...(labelFor ? { labelFor } : {})}
                    editing={editingId === msg.id}
                    onStartEdit={() => setEditingId(msg.id)}
                    onCancelEdit={() => setEditingId(null)}
                    onSaveEdit={async (body: string) => {
                      await edit(msg.id, body);
                      setEditingId(null);
                    }}
                    onDelete={() => void deleteMsg(msg.id)}
                    onOpenThread={() => setThreadRootId(msg.id)}
                    onQuote={() => setReplyingTo(msg)}
                    onQuotedClick={scrollToOriginal}
                  />
                </Fragment>
              );
            })
          )}

          {error && (
            <div className="poolse-conversation__empty">Failed to load: {error.message}</div>
          )}

          {/* Bottom sentinel for the IntersectionObserver. Lives at the
              very end so its visibility ≡ "scroller is at bottom". */}
          <div ref={bottomSentinelRef} aria-hidden="true" style={{ height: 1 }} />
        </div>

        {!atBottom && newCountWhileAway > 0 && (
          <button
            type="button"
            className="poolse-conversation__scroll-to-new"
            onClick={scrollToBottom}
          >
            ↓ {newCountWhileAway} new {newCountWhileAway === 1 ? 'message' : 'messages'}
          </button>
        )}

        <TypingIndicator typing={typing} {...(labelFor ? { labelFor } : {})} />

        {/* Composer owns the paperclip + upload-queue chips internally
            now (text + attachments sent as one message). The drag-drop
            overlay on the conversation pane forwards dropped files
            into it via `composerRef.addFiles`. */}
        <div className="poolse-conversation__composer-row">
          <div className="poolse-conversation__composer-flex">{Composer}</div>
        </div>

        {dragActive && (
          <div className="poolse-conversation__drop-overlay" aria-hidden="true">
            <div className="poolse-conversation__drop-overlay-inner">
              <PoolseIcon name="attachment" size={40} label={null} />
              <div className="poolse-conversation__drop-overlay-title">Drop files to upload</div>
              <div className="poolse-conversation__drop-overlay-hint">
                They'll be sent in one message
              </div>
            </div>
          </div>
        )}
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

// Grouping helpers live in `./grouping.ts` so they're testable in
// isolation. Re-imported above where they're used.
