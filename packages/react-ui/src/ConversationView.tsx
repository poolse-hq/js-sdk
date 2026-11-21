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

import type { LiveCall, Message, MessageCreateRequest, Uuid } from '@poolse/sdk';
import {
  ApiError,
  canEditOwnMessage,
  isMessageVisibleTo,
  receiptsOf,
  useMembers,
  useMessageStreams,
  useMessages,
  useMe,
  usePoolse,
  useLiveCall,
  useRealtimeStatus,
  useTyping,
  type MessageStream,
} from '@poolse/react';
import React, {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePoolseFonts } from './fonts.js';
import {
  clearDraft,
  draftKey,
  localDraftStorage,
  readDraft,
  writeDraft,
  type ConversationDraft,
  type DraftStorage,
} from './drafts.js';
import { computeGroupPosition, formatDayLabel, sameDay } from './grouping.js';
import {
  mentionsViewer,
  type ChatDensity,
  type ChatLayout,
  type MessageSlots,
  type RenderMessageContext,
  type TimeFormat,
} from './layout.js';
import { LiveCallBanner } from './LiveCallBanner.js';
import { MentionInput } from './MentionInput.js';
import { MessageComposer, type MessageComposerHandle } from './MessageComposer.js';
import { MessageRow, type MessageUser } from './MessageRow.js';
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
   * actions, attachments inline as configured below). The third
   * argument carries the layout and `renderDefault()`, the row this
   * view would have drawn — return it for the messages you don't
   * want to change.
   */
  renderMessage?: (
    msg: Message,
    currentUserId: string | null,
    context: RenderMessageContext,
  ) => ReactNode;

  /**
   * How messages are drawn:
   *   * `'bubbles'` (default) — chat bubbles, yours on the right.
   *   * `'list'` — Slack-style full-width rows; avatar, name and time
   *     once per run, the time on hover for the rest, a hover toolbar
   *     (React · Reply · Thread · More), "N replies" under threads.
   *   * `'compact'` — Discord/IRC-style dense lines: time at the left,
   *     the name in the sender's colour, an accent bar on messages
   *     that mention you.
   */
  layout?: ChatLayout;
  /** `'comfortable'` (default) or `'compact'` spacing, in any layout. */
  density?: ChatDensity;
  /**
   * Show avatars. Defaults: `list` on, `compact` off, `bubbles` per
   * `avatars` (others' messages in group chats). Overrides `avatars`.
   */
  showAvatars?: boolean;
  /**
   * Presence badges (online, away, in a call, do not disturb) on the
   * avatars next to messages, where avatars show. Defaults to `false`.
   */
  showPresence?: boolean;
  /** `'12h'`, `'24h'` or a formatter. Defaults to the locale's. */
  timeFormat?: TimeFormat;
  /**
   * Same-sender messages less than this many minutes apart form one
   * run (one bubble cluster, one `list` header). Default 5.
   */
  groupWindowMinutes?: number;
  /**
   * Replace or wrap one part of every message — `header`, `body`,
   * `attachments`, `reactions`, `thread`, `actions` — in any layout.
   * Each receives the message, sender, layout and its default
   * rendering as `children`.
   */
  slots?: MessageSlots;

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

  /**
   * Paperclip → file picker → presigned upload → send-with-attachment.
   * Files can also be pasted into the composer or dropped on the view;
   * they show as chips (images with a thumbnail) until sent.
   */
  attachments?: boolean;
  /** Largest attachment accepted, in bytes; bigger files show an error chip instead. */
  maxFileSize?: number;
  /**
   * Accepted attachment types — MIME types, wildcards (`'image/*'`) or
   * extensions (`'.pdf'`). Other files show an error chip instead.
   */
  acceptFileTypes?: string[];

  /** An emoji button in the composer (`<EmojiPicker>`). Defaults to `true`. */
  emojiPicker?: boolean;

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

  /**
   * Cards for links in message text (site, title, description, image;
   * an image link inline), arriving a moment after the message. The
   * sender can remove one with its ×. Defaults to `true`.
   */
  linkPreviews?: boolean;

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

  /** @deprecated Use `groupWindowMinutes`. */
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
   * Fired after the view marks the latest message read and the server
   * accepts it. Every `useConversations()` / `<ConversationList>` under
   * the same provider has already cleared this conversation's badge by
   * then; use this for anything else (an app-level badge, say).
   * Receives the conv id so a single handler can switch between rooms.
   */
  onMarkedRead?: (conversationId: string) => void;
  /**
   * Jump to this message: older pages load until it's there, then it
   * scrolls into view and flashes. Set it again (or to another id) to
   * jump again. When it can't be found — deleted, a thread reply, or
   * not in this conversation — a short notice shows and
   * `onFocusMessageNotFound` fires.
   */
  focusMessageId?: Uuid | null;
  /** `focusMessageId` couldn't be found in this conversation. */
  onFocusMessageNotFound?: (messageId: Uuid) => void;
  /** Makes the sender label on other people's messages a button. */
  onSenderPress?: (user: MessageUser) => void;
  /** Makes the avatar next to other people's messages a button. */
  onAvatarPress?: (user: MessageUser) => void;
  /**
   * `false` hides the composer (and with it quote-reply and dropping
   * files) — for an archived conversation or a viewer who can't post.
   * Defaults to `true`.
   */
  composer?: boolean;
  /** Same as `composer={false}`. */
  readOnly?: boolean;
  /**
   * Offer "Call back" on call-log rows the viewer missed or declined,
   * or placed with no answer. Receives the call's media; place the call
   * on this conversation.
   */
  onCallBack?: (media: 'audio' | 'video') => void;
  /**
   * Show a "Call in progress · Join" banner while a call runs on this
   * conversation that the viewer is not on. Called with the live call
   * when they click Join.
   */
  onJoinCall?: (call: LiveCall) => void;
  /** The call this client is already on, if any — its banner is hidden. */
  currentCallId?: string | null;
  /**
   * Keep an unsent draft per conversation — the composer's text and the
   * message being quoted (not files) — across conversation switches
   * and reloads, per user. Cleared when the message is sent. Defaults
   * to `true`.
   */
  persistDrafts?: boolean;
  /**
   * Where drafts persist between page loads. Defaults to
   * `localStorage` (guarded; memory only when it's unavailable). Sync or
   * async `get` / `set` / `remove` with string values.
   */
  draftStorage?: DraftStorage;
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
  maxFileSize,
  acceptFileTypes,
  emojiPicker = TRUE,
  actions = TRUE,
  threads = TRUE,
  quotations = TRUE,
  readReceipts = TRUE,
  linkPreviews = TRUE,
  markdown = TRUE,
  maxBodyLength = 200,
  grouping = TRUE,
  groupingWindowMs,
  groupWindowMinutes,
  layout = 'bubbles',
  density = 'comfortable',
  showAvatars,
  showPresence = false,
  timeFormat,
  slots,
  daySeparators = TRUE,
  senderLabels = 'auto',
  avatars = 'auto',
  onMarkedRead,
  focusMessageId = null,
  onFocusMessageNotFound,
  onSenderPress,
  onAvatarPress,
  composer = TRUE,
  readOnly = false,
  onCallBack,
  onJoinCall,
  currentCallId = null,
  persistDrafts = TRUE,
  draftStorage,
}: ConversationViewProps) {
  usePoolseFonts(loadFonts);
  const showComposer = composer && !readOnly;
  // Without a composer there's nowhere to quote into or drop files.
  const canQuote = quotations && showComposer;
  const canDrop = attachments && showComposer;

  const { me } = useMe();
  const {
    messages,
    loading,
    error,
    hasMore,
    loadMore,
    loadUntil,
    send,
    edit,
    delete: deleteMsg,
    markReadUpTo,
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
  const status = useRealtimeStatus();
  // Members are needed for mentions + read-receipt auto-compute +
  // the `auto` resolution of senderLabels / avatars in group chats.
  // We always pull them when ANY of those features wants the count
  // — useMembers is server-fetch-once + idempotent, so the cost is
  // one REST call.
  const wantsMemberCount = senderLabels === 'auto' || avatars === 'auto';
  const membersOn = mentions || readReceipts || wantsMemberCount;
  const { members, loading: membersLoading } = useMembers(membersOn ? conversationId : '');
  const chat = usePoolse();

  // Group-chat heuristic: 3+ members triggers per-bubble sender
  // identification (label + avatar) under the `'auto'` setting.
  // `'always'` forces them on, `'never'` forces off.
  const isGroupChat = members.length > 2;
  const showSenderLabelsResolved =
    senderLabels === 'always' || (senderLabels === 'auto' && isGroupChat);
  const showAvatarsResolved =
    showAvatars ??
    (layout === 'list'
      ? true
      : layout === 'compact'
        ? false
        : avatars === 'always' || (avatars === 'auto' && isGroupChat));
  const groupWindowMs =
    groupWindowMinutes !== undefined
      ? groupWindowMinutes * 60 * 1000
      : (groupingWindowMs ?? 5 * 60 * 1000);
  // Props every row gets, whatever the layout.
  const layoutProps = {
    layout,
    showPresence,
    linkPreviews,
    ...(timeFormat ? { timeFormat } : {}),
    ...(slots ? { slots } : {}),
  };

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

  // Keep a streaming reply in view as it grows.
  const streamedChars = visibleStreams.reduce((n, s) => n + s.text.length, 0);
  useEffect(() => {
    if (!atBottom || streamedChars === 0) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [streamedChars, atBottom]);

  // Auto-mark-read whenever the latest message is in view.
  // Fire-and-forget — the server handles dedup if we call repeatedly
  // with the same id, and `useMessages.markReadUpTo` doesn't mutate
  // local state.
  const lastMarkedReadRef = useRef<Uuid | null>(null);
  const [markerReadyFor, setMarkerReadyFor] = useState<string | null>(null);
  useEffect(() => {
    if (!atBottom) return;
    if (messages.length === 0) return;
    const tail = messages[messages.length - 1];
    if (!tail) return;
    // Don't mark optimistic temp messages (which have
    // sequence === MAX_SAFE_INTEGER) — wait for the canonical row.
    if (tail.sequence === Number.MAX_SAFE_INTEGER) return;
    // Hold off until the divider has its read position: marking read
    // first would move the cursor it is taken from.
    if (membersOn && markerReadyFor !== conversationId) return;
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
  }, [atBottom, messages, markReadUpTo, onMarkedRead, conversationId, membersOn, markerReadyFor]);

  // ── "New messages" divider ─────────────────────────────────────────
  // Where the viewer's read position was when they opened the
  // conversation (their membership's read cursor), taken once per open:
  // the divider then stays put while they read — marking read doesn't
  // move it — until they reopen the conversation or send a message.
  // "Mark unread" moves it to that message.
  const [unreadMarker, setUnreadMarker] = useState<UnreadMarker | null>(null);
  const markerTakenRef = useRef<string | null>(null);
  // The conversation whose read position has been looked at (divider
  // or not); auto mark-read waits for it.
  useEffect(() => {
    setUnreadMarker(null);
    markerTakenRef.current = null;
  }, [conversationId]);
  useEffect(() => {
    if (markerTakenRef.current === conversationId) return;
    if (!membersOn || loading || membersLoading) return;
    // Right after a switch the previous conversation's members linger
    // for a render; wait for this one's.
    if (members.some((m) => m.conversation_id !== conversationId)) return;
    if (!me && members.length > 0) return;
    markerTakenRef.current = conversationId;
    setMarkerReadyFor(conversationId);
    const mine = me ? members.find((m) => m.user_id === me.id) : undefined;
    if (!mine) return;
    let after: number | null = mine.last_read_sequence ?? null;
    if (after === null && mine.last_read_message_id) {
      after = messages.find((m) => m.id === mine.last_read_message_id)?.sequence ?? null;
      // Read up to something we can't place: no divider.
      if (after === null) return;
    }
    setUnreadMarker({
      conversationId,
      afterSequence: after ?? 0,
      lastReadId: mine.last_read_message_id,
    });
  }, [conversationId, membersOn, loading, membersLoading, me, members, messages]);

  const scrollToBottom = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setNewCountWhileAway(0);
  };

  // Rendered feed: drops call-log markers addressed to someone else
  // (a `call_missed` for another callee) BEFORE grouping + day
  // separators run, so a hidden row never splits a bubble cluster or
  // spawns an orphan date pill.
  const meIdForFeed = me?.id ?? null;
  const visibleMessages = useMemo(
    () => messages.filter((m) => isMessageVisibleTo(m, meIdForFeed)),
    [messages, meIdForFeed],
  );

  // The first unread message (someone else's, after the read position)
  // — the divider goes above it. When the loaded pages don't reach back
  // to the read position yet, it isn't known: the pill loads them.
  const marker =
    unreadMarker && unreadMarker.conversationId === conversationId ? unreadMarker : null;
  const unread = useMemo(() => {
    if (!marker) return { firstId: null, reaches: true, any: false };
    const isUnread = (m: Message) =>
      m.sequence > marker.afterSequence &&
      m.sequence !== Number.MAX_SAFE_INTEGER &&
      m.sender_id !== meIdForFeed;
    const reaches = !hasMore || visibleMessages.some((m) => m.sequence <= marker.afterSequence);
    const first = visibleMessages.find(isUnread) ?? null;
    return {
      firstId: reaches ? (first?.id ?? null) : null,
      reaches,
      any: first !== null,
    };
  }, [marker, visibleMessages, hasMore, meIdForFeed]);

  const dividerRef = useRef<HTMLDivElement | null>(null);
  const [dividerInView, setDividerInView] = useState(false);
  const [jumpDismissed, setJumpDismissed] = useState(false);
  useEffect(() => {
    setJumpDismissed(false);
  }, [conversationId, marker?.afterSequence]);
  useEffect(() => {
    setDividerInView(false);
    const el = dividerRef.current;
    const root = listRef.current;
    if (!el || !root || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setDividerInView(!!entry?.isIntersecting), {
      root,
      threshold: 0,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [unread.firstId]);

  // "Jump to first unread": load older pages until the read position is
  // there (the message read last), then scroll to the divider.
  // 'loading' while pages load, 'loaded' once loadUntil settled (the
  // effect then scrolls, or gives up if the divider still isn't there).
  const [jump, setJump] = useState<'loading' | 'loaded' | null>(null);
  const jumpToFirstUnread = () => {
    if (!marker) return;
    if (unread.firstId) {
      scrollDividerIntoView(dividerRef.current);
      return;
    }
    setJump('loading');
    // With no read position at all, page back to the start.
    void loadUntil(marker.lastReadId ?? NO_MESSAGE)
      .catch(() => false)
      .then(() => {
        if (conversationIdRef.current === marker.conversationId) {
          setJump((j) => (j ? 'loaded' : j));
        }
      });
  };
  useEffect(() => {
    if (!jump) return;
    if (unread.firstId) {
      setJump(null);
      scrollDividerIntoView(dividerRef.current);
    } else if (jump === 'loaded') {
      setJump(null);
    }
  }, [jump, unread.firstId]);
  useEffect(() => {
    setJump(null);
  }, [conversationId]);
  const showJump = !!marker && unread.any && !jumpDismissed && (!unread.firstId || !dividerInView);

  // "Mark unread" on someone else's message: the server moves the read
  // cursor back (every view's badge follows via `conversation:read`);
  // here the divider moves above it and auto-read holds off until a
  // newer message arrives.
  const markUnreadFrom = async (msg: Message) => {
    const tail = messages[messages.length - 1];
    if (tail) lastMarkedReadRef.current = tail.id;
    try {
      await chat.conversations.one(conversationId).markUnread(msg.id);
      markerTakenRef.current = conversationId;
      setUnreadMarker({ conversationId, afterSequence: msg.sequence - 1, lastReadId: null });
    } catch {
      setSendNotice("Couldn't mark the message unread.");
    }
  };

  // Jump to `focusMessageId`: page back until it's loaded, then let the
  // effect below scroll to it once its row has rendered.
  const [pendingFocusId, setPendingFocusId] = useState<Uuid | null>(null);
  const [focusMissing, setFocusMissing] = useState(false);
  const onFocusNotFoundRef = useRef(onFocusMessageNotFound);
  onFocusNotFoundRef.current = onFocusMessageNotFound;
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const focusMiss = useCallback((id: Uuid) => {
    setFocusMissing(true);
    onFocusNotFoundRef.current?.(id);
  }, []);
  useEffect(() => {
    setPendingFocusId(null);
    setFocusMissing(false);
    if (!focusMessageId || loading) return;
    const forConversation = conversationId;
    let current = true;
    loadUntil(focusMessageId)
      .then((found) => {
        if (!current || conversationIdRef.current !== forConversation) return;
        if (found) setPendingFocusId(focusMessageId);
        else focusMiss(focusMessageId);
      })
      .catch(() => {
        if (current) focusMiss(focusMessageId);
      });
    return () => {
      current = false;
    };
    // `loading` flips only while a conversation's first page loads.
  }, [focusMessageId, conversationId, loading, loadUntil, focusMiss]);

  useEffect(() => {
    if (!pendingFocusId) return;
    const root = listRef.current;
    const el = root?.querySelector(`[data-message-id="${pendingFocusId}"]`);
    setPendingFocusId(null);
    // Loaded but not shown (a call-log marker meant for someone else).
    if (!(el instanceof HTMLElement)) {
      focusMiss(pendingFocusId);
      return;
    }
    highlightRow(el);
  }, [pendingFocusId, visibleMessages, focusMiss]);

  useEffect(() => {
    if (!focusMissing) return;
    const t = setTimeout(() => setFocusMissing(false), 4000);
    return () => clearTimeout(t);
  }, [focusMissing]);

  // Compute the highest message sequence that ANY other member has read.
  // We treat any message with `sequence <= maxReadByOthers` as "read",
  // higher as "sent" (delivered but not yet read).
  // The workspace's read-receipt setting, for this user: hidden means no
  // check marks anywhere (the server withholds others' read state too).
  const receiptsVisible = receiptsOf(me).visible;
  const showReadState = readReceipts && receiptsVisible;

  const maxReadByOthers = useMemo(() => {
    if (!showReadState || !me) return null;
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
  }, [showReadState, me, members, messages]);

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
  const [replyingTo, setReplyingToState] = useState<Message | null>(null);
  // MentionInput once members are known, else the plain composer.
  const mentionComposer = mentions && members.length > 0;
  useEffect(() => {
    setReplyingToState(null);
    setEditingId(null);
    setThreadRootId(null);
    setSendNotice(null);
  }, [conversationId]);

  // ── Drafts ─────────────────────────────────────────────────────────
  // The composer is keyed by conversation, so switching starts it empty;
  // the effect below fills it back from the draft. Text changes and
  // reply-target changes write the draft; a send clears it.
  const meIdForDrafts = me?.id ?? null;
  const draftsOn = persistDrafts && showComposer;
  const storage = draftStorage ?? localDraftStorage;
  const draftRef = useRef<ConversationDraft>({ text: '', replyTo: null });
  const draftKeyFor = useCallback(
    () => (draftsOn && meIdForDrafts ? draftKey(meIdForDrafts, conversationIdRef.current) : null),
    [draftsOn, meIdForDrafts],
  );
  const saveDraft = useCallback(
    (patch: Partial<ConversationDraft>) => {
      draftRef.current = { ...draftRef.current, ...patch };
      const key = draftKeyFor();
      if (key) writeDraft(storage, key, draftRef.current);
    },
    [draftKeyFor, storage],
  );
  const setReplyingTo = useCallback(
    (m: Message | null) => {
      setReplyingToState(m);
      saveDraft({ replyTo: m });
    },
    [saveDraft],
  );
  useEffect(() => {
    draftRef.current = { text: '', replyTo: null };
    const key = draftKeyFor();
    if (!key) return;
    let live = true;
    const apply = (d: ConversationDraft | null) => {
      if (!live || !d) return;
      const composer = composerRef.current;
      if (d.text && composer && composer.getText() === '') composer.setText(d.text);
      draftRef.current = { text: composer?.getText() || d.text, replyTo: d.replyTo };
      if (d.replyTo && canQuote) setReplyingToState((cur) => cur ?? d.replyTo);
    };
    const found = readDraft(storage, key);
    if (found instanceof Promise) void found.then(apply);
    else apply(found);
    return () => {
      live = false;
    };
    // `conversationId` via draftKeyFor's ref; re-run when it changes, and
    // when the composer is swapped (MentionInput once members load).
  }, [conversationId, draftKeyFor, storage, canQuote, mentionComposer]);
  const onComposerChange = useCallback((text: string) => saveDraft({ text }), [saveDraft]);
  // The message being quoted was deleted meanwhile: a tombstone can't be
  // quoted, so drop the chip.
  useEffect(() => {
    if (!replyingTo) return;
    const current = messages.find((m) => m.id === replyingTo.id);
    if (current?.deleted_at) setReplyingTo(null);
  }, [messages, replyingTo, setReplyingTo]);

  // A short notice over the feed when a send is refused for a reason
  // the user can act on (the quoted message was deleted).
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!sendNotice) return;
    const t = setTimeout(() => setSendNotice(null), 4000);
    return () => clearTimeout(t);
  }, [sendNotice]);

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
    highlightRow(el);
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
    if (!canDrop || !isFileDrag(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!canDrop || !isFileDrag(e)) return;
    // Must preventDefault on dragover for drop to fire.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!canDrop || !isFileDrag(e)) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!canDrop || !isFileDrag(e)) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) composerRef.current?.addFiles(files);
  };

  // Sends, and maps the refusals the user can fix to a notice: quoting
  // a message deleted meanwhile drops the quote and puts the text back
  // so it can go out without it. Anything else is rethrown.
  const sendRequest = async (req: MessageCreateRequest) => {
    try {
      await send(req);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'quoted_message_deleted') {
        setReplyingTo(null);
        setSendNotice('The message you replied to was deleted.');
        // After the composer has finished its own post-send reset.
        const body = req.body;
        if (body) {
          setTimeout(() => {
            const composer = composerRef.current;
            if (composer && composer.getText() === '') composer.setText(body);
          }, 0);
        }
        return;
      }
      throw err;
    }
    setReplyingToState(null);
    // Sending is reading: the divider goes.
    setUnreadMarker(null);
    draftRef.current = { text: '', replyTo: null };
    const key = draftKeyFor();
    if (key) clearDraft(storage, key);
  };

  const onSendBody = (body: string, opts?: { quoted_message_id?: Uuid; attachment_ids?: Uuid[] }) =>
    sendRequest({
      body,
      ...(opts?.quoted_message_id ? { quoted_message_id: opts.quoted_message_id } : {}),
      ...(opts?.attachment_ids && opts.attachment_ids.length > 0
        ? { attachment_ids: opts.attachment_ids }
        : {}),
    });

  const onSendWithMentions = (req: MessageCreateRequest) => sendRequest(req);

  const attachmentRules = {
    ...(maxFileSize !== undefined ? { maxFileSize } : {}),
    ...(acceptFileTypes ? { acceptFileTypes } : {}),
  };

  // Mention input is only ergonomic when members are loaded. Falls back to
  // the plain composer otherwise. Both variants accept the same
  // `replyingTo` / `onCancelReply` props for the quote-reply chip, and
  // both expose the same `addFiles` imperative handle for drag-drop.
  const Composer = mentionComposer ? (
    <MentionInput
      key={conversationId}
      ref={composerRef}
      onValueChange={onComposerChange}
      conversationId={conversationId}
      onSend={onSendWithMentions}
      onTyping={signalTyping}
      attachments={attachments}
      emojiPicker={emojiPicker}
      {...attachmentRules}
      {...(labelFor ? { labelFor } : {})}
      {...(canQuote ? { replyingTo, onCancelReply: () => setReplyingTo(null) } : {})}
    />
  ) : (
    <MessageComposer
      key={conversationId}
      ref={composerRef}
      onValueChange={onComposerChange}
      onSend={onSendBody}
      onTyping={signalTyping}
      attachments={attachments}
      emojiPicker={emojiPicker}
      {...attachmentRules}
      {...(labelFor ? { labelFor } : {})}
      {...(canQuote ? { replyingTo, onCancelReply: () => setReplyingTo(null) } : {})}
    />
  );

  return (
    <div className="poolse-conversation-shell">
      <div
        className={[
          'poolse-conversation',
          `poolse-conversation--layout-${layout}`,
          `poolse-conversation--density-${density}`,
          dragActive ? 'is-drag-active' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {onJoinCall && (
          <JoinBanner
            conversationId={conversationId}
            meId={me?.id ?? null}
            currentCallId={currentCallId}
            onJoin={onJoinCall}
          />
        )}
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
        {focusMissing && (
          <div className="poolse-conversation__status" role="status" aria-live="polite">
            That message isn't available.
          </div>
        )}
        {sendNotice && (
          <div
            className="poolse-conversation__status poolse-conversation__status--error"
            role="alert"
          >
            {sendNotice}
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

          {/* Sticky, zero-height: the pill floats at the top of the feed. */}
          {showJump && (
            <div className="poolse-conversation__jump-unread">
              <button
                type="button"
                className="poolse-conversation__jump-unread-btn"
                onClick={jumpToFirstUnread}
                disabled={jump !== null}
              >
                <PoolseIcon name="chevron-up" size={14} label={null} />
                {jump ? 'Loading…' : 'Jump to first unread'}
              </button>
              <button
                type="button"
                className="poolse-conversation__jump-unread-close"
                aria-label="Dismiss"
                onClick={() => setJumpDismissed(true)}
              >
                <PoolseIcon name="close" size={12} label={null} />
              </button>
            </div>
          )}

          {loading && messages.length === 0 ? (
            <div className="poolse-conversation__empty">Loading…</div>
          ) : messages.length === 0 ? (
            <div className="poolse-conversation__empty">{emptyState ?? 'No messages yet.'}</div>
          ) : (
            visibleMessages.map((msg, idx) => {
              const prev: Message | null = idx > 0 ? (visibleMessages[idx - 1] ?? null) : null;
              const next: Message | null =
                idx < visibleMessages.length - 1 ? (visibleMessages[idx + 1] ?? null) : null;
              const groupPosition = grouping
                ? computeGroupPosition(msg, prev, next, groupWindowMs)
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
                showReadState && isSelf && maxReadByOthers !== null
                  ? maxReadByOthers >= msg.sequence
                    ? ('read' as const)
                    : ('sent' as const)
                  : undefined;
              const renderDefault = () => (
                <MessageRow
                  msg={enriched}
                  meId={me?.id ?? null}
                  reactions={reactions}
                  attachments={attachments}
                  actions={actions}
                  threads={threads}
                  quotations={canQuote}
                  groupPosition={groupPosition}
                  maxBodyLength={maxBodyLength}
                  markdown={markdown}
                  showSenderName={showSenderLabelsResolved}
                  showAvatar={showAvatarsResolved}
                  {...(onSenderPress ? { onSenderPress } : {})}
                  {...(onAvatarPress ? { onAvatarPress } : {})}
                  {...(readState ? { readState } : {})}
                  {...(labelFor ? { labelFor } : {})}
                  editing={editingId === msg.id}
                  {...(canEditOwnMessage({
                    isSelf,
                    deleted: !!msg.deleted_at,
                    receiptsVisible,
                    readState,
                    insertedAt: msg.inserted_at,
                  })
                    ? { onStartEdit: () => setEditingId(msg.id) }
                    : {})}
                  onCancelEdit={() => setEditingId(null)}
                  onSaveEdit={async (body: string) => {
                    await edit(msg.id, body);
                    setEditingId(null);
                  }}
                  onDelete={() => void deleteMsg(msg.id)}
                  onOpenThread={() => setThreadRootId(msg.id)}
                  onQuote={() => setReplyingTo(msg)}
                  {...(!isSelf && msg.sequence !== Number.MAX_SAFE_INTEGER
                    ? { onMarkUnread: () => void markUnreadFrom(msg) }
                    : {})}
                  onQuotedClick={scrollToOriginal}
                  {...(onCallBack ? { onCallBack } : {})}
                  {...layoutProps}
                  mentionsMe={mentionsViewer(msg, me?.id ?? null)}
                />
              );
              const divider =
                unread.firstId === msg.id ? (
                  <div
                    ref={dividerRef}
                    className="poolse-unread-divider"
                    role="separator"
                    aria-label="New messages"
                  >
                    <span>New messages</span>
                  </div>
                ) : null;
              if (renderMessage) {
                return (
                  <Fragment key={msg.id}>
                    {divider}
                    {renderMessage(msg, me?.id ?? null, {
                      layout,
                      groupPosition,
                      isRunStart:
                        layout === 'compact' ||
                        groupPosition === 'first' ||
                        groupPosition === 'standalone',
                      renderDefault,
                    })}
                  </Fragment>
                );
              }
              return (
                <Fragment key={msg.id}>
                  {showDaySeparator && (
                    <div className="poolse-day-separator" aria-hidden="false">
                      <span>{formatDayLabel(msg.inserted_at)}</span>
                    </div>
                  )}
                  {divider}
                  {renderDefault()}
                </Fragment>
              );
            })
          )}

          {visibleStreams.map((stream) =>
            stream.status === 'failed' ? (
              <div key={stream.id} className="poolse-stream-failed" role="status">
                {stream.error
                  ? `The agent couldn't reply: ${stream.error}`
                  : "The agent couldn't reply."}
              </div>
            ) : (
              <div key={stream.id} className="poolse-stream" aria-busy="true">
                <MessageRow
                  msg={streamingMessage(stream)}
                  meId={me?.id ?? null}
                  reactions={false}
                  actions={false}
                  threads={false}
                  quotations={false}
                  markdown={markdown}
                  showSenderName={showSenderLabelsResolved}
                  showAvatar={showAvatarsResolved}
                  {...(labelFor ? { labelFor } : {})}
                  {...layoutProps}
                />
              </div>
            ),
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
        {showComposer && (
          <div className="poolse-conversation__composer-row">
            <div className="poolse-conversation__composer-flex">{Composer}</div>
          </div>
        )}

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
            layout={layout}
            {...(timeFormat ? { timeFormat } : {})}
            {...attachmentRules}
          />
        </div>
      )}
    </div>
  );
}

interface UnreadMarker {
  conversationId: string;
  /** Messages after this sequence are unread. */
  afterSequence: number;
  /** The message read last, to page back to; null when none / unknown. */
  lastReadId: Uuid | null;
}

// `loadUntil` an id no message has: pages back to the start.
const NO_MESSAGE = '00000000-0000-0000-0000-000000000000';

function scrollDividerIntoView(el: HTMLElement | null): void {
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Scroll a message row into view and flash it.
function highlightRow(el: HTMLElement): void {
  if (typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  el.classList.add('poolse-message-row--highlight');
  setTimeout(() => el.classList.remove('poolse-message-row--highlight'), 1600);
}

// Grouping helpers live in `./grouping.ts` so they're testable in
// isolation. Re-imported above where they're used.

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

// A streaming agent reply shaped as a Message, so it renders with the
// same row and bubble as the finished one that replaces it.
function streamingMessage(stream: MessageStream): Message {
  const now = new Date().toISOString();
  return {
    id: stream.id,
    tenant_id: '',
    conversation_id: stream.conversation_id,
    sender_id: stream.sender_id,
    sender_external_id: stream.sender_external_id,
    type: 'text',
    body: stream.text,
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
