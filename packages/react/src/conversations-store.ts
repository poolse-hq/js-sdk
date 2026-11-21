// The conversation list, shared by every `useConversations()` under one
// `<PoolseProvider>` — so marking a conversation read in one view clears
// its badge in every other (a sidebar, a tab bar, an inbox header).
//
// The list is paged (`GET /v1/conversations` → `next_cursor`): the store
// loads the first page, and `loadMore()` appends the next. A quiet reload
// (remount, reconnect) refreshes the first page and keeps the rows of any
// further pages already loaded.
//
// The store wakes up with its first subscriber: it fetches the list and
// listens on the user's `user:<id>` channel for `conversation:created`,
// `conversation:updated` and `conversation:read`. With its last
// subscriber gone it stops listening and keeps the rows it had; the next
// subscriber sees them at once while a quiet refetch catches up.
//
// One store per client (`chat.scoped`), so it outlives a provider that
// unmounts and never mixes two workspaces' rows. Rows are also handed
// to the client's warm cache (shown at once on the next start, and
// offline, when the client has a storage) and to its unread totals.

import type {
  Conversation,
  ConversationCreateRequest,
  ConversationReadEvent,
  Me,
  Poolse,
  Uuid,
} from '@poolse/sdk';

export interface ConversationsSnapshot {
  conversations: Conversation[];
  loading: boolean;
  error: Error | null;
  /** The server has another page (`loadMore()`). */
  hasMore: boolean;
  /** A `loadMore()` is in flight. */
  loadingMore: boolean;
}

export class ConversationsStore {
  private state: ConversationsSnapshot = {
    conversations: [],
    loading: true,
    error: null,
    hasMore: false,
    loadingMore: false,
  };
  private readonly listeners = new Set<() => void>();
  private loaded = false;
  private inflight: Promise<void> | null = null;
  private moreInflight: Promise<void> | null = null;
  private unbind: (() => void) | null = null;
  /** Cursor of the next page not yet loaded; null when there is none. */
  private nextCursor: string | null = null;
  /** Whether rows beyond the first page are held. */
  private pagedBeyondFirst = false;

  private destroyed = false;
  private hydrating: Promise<void> | null = null;

  constructor(private readonly chat: Poolse) {
    const cached = chat.cache.peekConversations();
    if (cached && cached.length > 0) {
      this.state = { ...this.state, conversations: cached, loading: false };
    }
  }

  /** Called by `chat.destroy()`. @internal */
  destroy(): void {
    this.destroyed = true;
    this.deactivate();
    this.listeners.clear();
  }

  getSnapshot(): ConversationsSnapshot {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.activate();
    return () => {
      if (!this.listeners.delete(listener)) return;
      if (this.listeners.size === 0) this.deactivate();
    };
  }

  /** Reload the list from REST. Shows `loading` until it lands. */
  refetch(): Promise<void> {
    return this.load(true);
  }

  /**
   * Append the next page. Resolves at once when there is none or one
   * is already loading. Rows already held (moved up by realtime) are
   * not duplicated.
   */
  loadMore(): Promise<void> {
    if (this.moreInflight) return this.moreInflight;
    const cursor = this.nextCursor;
    if (!cursor) return Promise.resolve();
    this.set({ ...this.state, loadingMore: true });
    // A failure rejects to the caller and leaves the cursor, so a
    // retry asks for the same page.
    const run = this.chat.conversations
      .list({ cursor })
      .then((page) => {
        // A reload meanwhile may have moved the cursor on.
        if (this.nextCursor !== cursor) return;
        this.nextCursor = page.next_cursor ?? null;
        this.pagedBeyondFirst = true;
        const have = new Set(this.state.conversations.map((c) => c.id));
        this.set({
          ...this.state,
          conversations: [...this.state.conversations, ...page.data.filter((c) => !have.has(c.id))],
          hasMore: this.nextCursor !== null,
        });
      })
      .finally(() => {
        if (this.moreInflight === run) this.moreInflight = null;
        this.set({ ...this.state, loadingMore: false });
      });
    this.moreInflight = run;
    return run;
  }

  async create(attrs: ConversationCreateRequest): Promise<Conversation> {
    const conv = await this.chat.conversations.create(attrs);
    // The realtime echo for the same row is deduped by id.
    this.setConversations((prev) => prepend(prev, conv));
    return conv;
  }

  /** Zero a conversation's unread and mention counts. */
  markRead(conversationId: Uuid): void {
    this.chat.unread.apply(conversationId, 0, 0);
    this.setConversations((prev) =>
      patchRow(prev, conversationId, (c) =>
        c.unread_count === 0 && !c.mention_unread_count
          ? c
          : { ...c, unread_count: 0, mention_unread_count: 0 },
      ),
    );
  }

  /** Apply a `conversation:read` push. */
  applyRead(evt: ConversationReadEvent): void {
    this.setConversations((prev) =>
      patchRow(prev, evt.conversation_id, (c) => ({
        ...c,
        unread_count: evt.unread_count,
        mention_unread_count: evt.mention_unread_count,
      })),
    );
  }

  /** Merge a `conversation:updated` push. */
  applyUpdated(conversation: Conversation, fromMe: boolean): void {
    this.setConversations((prev) => mergeUpdated(prev, conversation, fromMe));
  }

  /** Add (or replace) a row from `conversation:created`. */
  applyCreated(conversation: Conversation): void {
    this.setConversations((prev) => prepend(prev, conversation));
  }

  private activate(): void {
    if (this.destroyed) return;
    // Rows are kept while nobody listens, but may be stale: refetch
    // quietly when there's something to show meanwhile.
    const showing = this.state.conversations.length > 0;
    void this.load(!this.loaded && !showing).catch(() => {});
    if (!this.loaded && !showing) this.hydrate();

    let off: (() => void) | null = null;
    let boundId: Uuid | null = null;
    const bind = (me: Me) => {
      if (me.id === boundId) return;
      off?.();
      boundId = me.id;
      off = this.bindRealtime(me.id);
    };
    const known = this.chat.me.peek();
    if (known) bind(known);
    const offMe = this.chat.me.onChange(bind);
    this.unbind = () => {
      offMe();
      off?.();
    };
  }

  // Show the stored list (a previous session's) while the first fetch
  // is out — or instead of it, offline.
  private hydrate(): void {
    this.hydrating ??= this.chat.cache.loadConversations().then((rows) => {
      if (this.destroyed || this.loaded || !rows || rows.length === 0) return;
      if (this.state.conversations.length > 0) return;
      this.chat.timings._once('cachedConversations');
      this.set({ ...this.state, conversations: rows, loading: false });
    });
  }

  private deactivate(): void {
    this.unbind?.();
    this.unbind = null;
  }

  private bindRealtime(meId: Uuid): () => void {
    const realtime = this.chat.realtime;
    const user = realtime.user(meId);
    const offCreated = user.onConversationCreated((conv) => this.applyCreated(conv));
    const offUpdated = user.onConversationUpdated(({ conversation, by_user_id }) =>
      this.applyUpdated(conversation, by_user_id === meId),
    );
    const offRead = user.onConversationRead((evt) => this.applyRead(evt));
    // Updates sent while the socket was down are never replayed: reload
    // the list once it is back. The first connect isn't a reconnect.
    let wasConnected = realtime.getStatus() === 'connected';
    let connectedBefore = wasConnected;
    const offStatus = realtime.onStatus((status) => {
      const reconnected = status === 'connected' && !wasConnected && connectedBefore;
      connectedBefore ||= status === 'connected';
      wasConnected = status === 'connected';
      if (reconnected) void this.load(false).catch(() => {});
    });
    return () => {
      offCreated();
      offUpdated();
      offRead();
      offStatus();
    };
  }

  private load(showLoading: boolean): Promise<void> {
    if (showLoading && !this.state.loading) this.set({ ...this.state, loading: true });
    if (this.inflight) return this.inflight;
    const run = this.chat.conversations
      .list()
      .then(
        (list) => {
          if (this.destroyed) return;
          this.loaded = true;
          let conversations = list.data;
          if (this.pagedBeyondFirst) {
            // Keep the later pages' rows, after the fresh first page.
            const fresh = new Set(list.data.map((c) => c.id));
            conversations = [
              ...list.data,
              ...this.state.conversations.filter((c) => !fresh.has(c.id)),
            ];
          } else {
            this.nextCursor = list.next_cursor ?? null;
          }
          this.set({
            ...this.state,
            conversations,
            loading: false,
            error: null,
            hasMore: this.nextCursor !== null,
          });
        },
        (err: unknown) => {
          if (this.destroyed) return;
          this.set({
            ...this.state,
            loading: false,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        },
      )
      .finally(() => {
        if (this.inflight === run) this.inflight = null;
      });
    this.inflight = run;
    return run;
  }

  private setConversations(fn: (prev: Conversation[]) => Conversation[]): void {
    const next = fn(this.state.conversations);
    if (next !== this.state.conversations) this.set({ ...this.state, conversations: next });
  }

  private set(state: ConversationsSnapshot): void {
    if (state.conversations !== this.state.conversations) {
      this.chat.unread.observe(state.conversations);
      if (this.loaded) this.chat.cache.setConversations(state.conversations);
    }
    this.state = state;
    for (const l of this.listeners) l();
  }
}

function patchRow(
  prev: Conversation[],
  id: Uuid,
  fn: (c: Conversation) => Conversation,
): Conversation[] {
  const idx = prev.findIndex((c) => c.id === id);
  if (idx === -1) return prev;
  const row = fn(prev[idx]!);
  if (row === prev[idx]) return prev;
  const next = prev.slice();
  next[idx] = row;
  return next;
}

/**
 * Prepend `conv` if its id isn't already in `prev`; otherwise replace
 * the existing row (covers the race where the realtime echo arrives
 * for a conversation our local `create()` already inserted).
 */
function prepend(prev: Conversation[], conv: Conversation): Conversation[] {
  const idx = prev.findIndex((c) => c.id === conv.id);
  if (idx === -1) return [conv, ...prev];
  const next = prev.slice();
  next[idx] = conv;
  return next;
}

/**
 * Apply a `conversation:updated` realtime payload: merge the fresh
 * surface fields (preview, timestamp, sequence, unread counts) into
 * the existing row and float it to the top.
 *
 * Preferred source for `unread_count` / `mention_unread_count` is the
 * wire payload — the server computes per-member counts and injects
 * them into each member's broadcast. Older servers don't include
 * them; we fall back to "increment when not from me" so the badge
 * still moves for unconsumed sends.
 *
 * If the conversation isn't in our local list yet (joined via a
 * different tab, or we just signed in), prepend the wire row as-is.
 */
function mergeUpdated(prev: Conversation[], next: Conversation, fromMe: boolean): Conversation[] {
  const idx = prev.findIndex((c) => c.id === next.id);
  if (idx === -1) return [next, ...prev];
  const existing = prev[idx]!;
  const wireUnread = typeof next.unread_count === 'number' ? next.unread_count : null;
  const unread_count =
    wireUnread !== null ? wireUnread : fromMe ? 0 : (existing.unread_count ?? 0) + 1;
  const merged: Conversation = {
    ...existing,
    last_message_at: next.last_message_at,
    last_message_preview: next.last_message_preview,
    last_sequence: next.last_sequence,
    unread_count,
  };
  if (typeof next.mention_unread_count === 'number') {
    merged.mention_unread_count = next.mention_unread_count;
  }
  const rest = prev.slice(0, idx).concat(prev.slice(idx + 1));
  return [merged, ...rest];
}
