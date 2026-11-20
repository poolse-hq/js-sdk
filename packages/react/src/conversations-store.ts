// The conversation list, shared by every `useConversations()` under one
// `<PoolseProvider>` — so marking a conversation read in one view clears
// its badge in every other (a sidebar, a tab bar, an inbox header).
//
// The store wakes up with its first subscriber: it fetches the list and
// listens on the user's `user:<id>` channel for `conversation:created`,
// `conversation:updated` and `conversation:read`. With its last
// subscriber gone it stops listening and keeps the rows it had; the next
// subscriber sees them at once while a quiet refetch catches up.

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
}

export class ConversationsStore {
  private state: ConversationsSnapshot = { conversations: [], loading: true, error: null };
  private readonly listeners = new Set<() => void>();
  private loaded = false;
  private inflight: Promise<void> | null = null;
  private unbind: (() => void) | null = null;

  constructor(private readonly chat: Poolse) {}

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

  async create(attrs: ConversationCreateRequest): Promise<Conversation> {
    const conv = await this.chat.conversations.create(attrs);
    // The realtime echo for the same row is deduped by id.
    this.setConversations((prev) => prepend(prev, conv));
    return conv;
  }

  /** Zero a conversation's unread and mention counts. */
  markRead(conversationId: Uuid): void {
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
    // Rows are kept while nobody listens, but may be stale: refetch
    // quietly when there's something to show meanwhile.
    void this.load(!this.loaded).catch(() => {});

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
          this.loaded = true;
          this.set({ conversations: list.data, loading: false, error: null });
        },
        (err: unknown) => {
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
