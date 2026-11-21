// Unread and mention totals for the whole account on one server — what
// a workspace rail or switcher shows on each workspace's icon.
//
// The totals come from `GET /v1/me/unread` and are kept live from the
// user channel: `conversation:read` and `conversation:updated` carry the
// fresh per-conversation counts, and the store folds the difference
// into the totals. A conversation it hasn't seen before can't be folded
// (its old count is unknown), so that triggers a quiet re-fetch of the
// totals instead. On a server without the endpoint (404) the totals are
// the sum of the conversations seen so far — the loaded conversation
// list plus whatever realtime brought in.

import { ApiError } from '../errors.js';
import type { PoolseRealtime } from '../realtime/realtime.js';
import type { Unsubscribe } from '../realtime/types.js';
import type { RestClient } from '../rest-client.js';
import type { Conversation, Me, Uuid } from '../types.js';
import type { MeResource } from './me.js';

/** `GET /v1/me/unread`. */
export interface UnreadSummary {
  /** Unread messages across every conversation the user is in. */
  unread_total: number;
  /** How many of those mention the user. */
  mention_total: number;
  /** Conversations with at least one unread message. */
  conversations_with_unread: number;
}

export interface UnreadTotals {
  /** Unread messages across the account. */
  unread: number;
  /** Unread messages that mention the user. */
  mentions: number;
  /** Conversations with anything unread. */
  conversations: number;
  /**
   * `'server'` — from `GET /v1/me/unread`, kept live; `'local'` — the
   * server has no such endpoint, so these are the sum of the
   * conversations loaded so far.
   */
  source: 'server' | 'local';
  /** The first fetch hasn't answered yet. */
  loading: boolean;
  /** The last fetch failed (totals keep their previous values). */
  error: Error | null;
}

interface Counts {
  unread: number;
  mentions: number;
}

const REFETCH_DEBOUNCE_MS = 400;

export class UnreadResource {
  private totals: UnreadTotals = {
    unread: 0,
    mentions: 0,
    conversations: 0,
    source: 'server',
    loading: true,
    error: null,
  };
  /** Latest counts seen per conversation. */
  private readonly known = new Map<Uuid, Counts>();
  private readonly listeners = new Set<(t: UnreadTotals) => void>();
  private serverSupported: boolean | null = null;
  private inflight: Promise<void> | null = null;
  private refetchTimer: ReturnType<typeof setTimeout> | null = null;
  private unbind: (() => void) | null = null;
  private destroyed = false;

  constructor(
    private readonly rest: RestClient,
    private readonly realtime: PoolseRealtime,
    private readonly me: MeResource,
  ) {}

  /** `GET /v1/me/unread` — the raw summary, no store involved. */
  summary(signal?: AbortSignal): Promise<UnreadSummary> {
    return this.rest.request<UnreadSummary>({
      method: 'GET',
      path: '/v1/me/unread',
      ...(signal ? { signal } : {}),
    });
  }

  /** The current totals. */
  get(): UnreadTotals {
    return this.totals;
  }

  /**
   * Live totals. The first subscriber fetches them and joins the
   * user's channel; with the last one gone, events stop being followed
   * (the totals are kept and refreshed on the next subscribe).
   */
  subscribe(fn: (totals: UnreadTotals) => void): Unsubscribe {
    this.listeners.add(fn);
    if (this.listeners.size === 1) this.activate();
    return () => {
      if (!this.listeners.delete(fn)) return;
      if (this.listeners.size === 0) this.deactivate();
    };
  }

  /** Fetch the totals again (also done on every reconnect). */
  refresh(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    if (this.inflight) return this.inflight;
    const run = (async () => {
      if (this.serverSupported === false) {
        this.recomputeLocal();
        return;
      }
      try {
        const s = await this.summary();
        this.serverSupported = true;
        this.set({
          unread: num(s.unread_total),
          mentions: num(s.mention_total),
          conversations: num(s.conversations_with_unread),
          source: 'server',
          loading: false,
          error: null,
        });
      } catch (err) {
        if (err instanceof ApiError && (err.status === 404 || err.status === 405)) {
          this.serverSupported = false;
          this.recomputeLocal();
          return;
        }
        this.set({
          ...this.totals,
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    })().finally(() => {
      if (this.inflight === run) this.inflight = null;
    });
    this.inflight = run;
    return run;
  }

  /**
   * Feed counts the app already has — the rows of a conversation list
   * (`@poolse/react` does this for you). Rows already seen with other
   * counts move the totals by the difference.
   */
  observe(conversations: ReadonlyArray<Conversation>): void {
    let changed = false;
    for (const c of conversations) {
      if (typeof c.unread_count !== 'number') continue;
      changed = this.fold(c.id, c.unread_count, c.mention_unread_count ?? 0, false) || changed;
    }
    if (changed || this.serverSupported === false) this.recomputeLocal();
  }

  /**
   * A conversation's counts are now these (it was read here, say).
   * Totals move by the difference.
   */
  apply(conversationId: Uuid, unread: number, mentions: number): void {
    const changed = this.fold(conversationId, unread, mentions, true);
    if (changed || this.serverSupported === false) this.recomputeLocal();
  }

  /** Refresh if anything is subscribed. @internal */
  _poke(): void {
    if (this.listeners.size > 0) void this.refresh();
  }

  /** @internal */
  _destroy(): void {
    this.destroyed = true;
    this.deactivate();
    this.listeners.clear();
    this.known.clear();
  }

  // Returns whether the totals were changed in place.
  private fold(id: Uuid, unread: number, mentions: number, fromEvent: boolean): boolean {
    const next: Counts = { unread: Math.max(0, unread), mentions: Math.max(0, mentions) };
    const prev = this.known.get(id);
    this.known.set(id, next);
    if (this.serverSupported === false) return true;
    if (!prev) {
      // Its share of the server's totals is unknown: a list row is
      // already counted there; an event about it may not be.
      if (fromEvent && this.serverSupported) this.scheduleRefetch();
      return false;
    }
    if (prev.unread === next.unread && prev.mentions === next.mentions) return false;
    const t = this.totals;
    this.set({
      ...t,
      unread: Math.max(0, t.unread + next.unread - prev.unread),
      mentions: Math.max(0, t.mentions + next.mentions - prev.mentions),
      conversations: Math.max(
        0,
        t.conversations + (next.unread > 0 ? 1 : 0) - (prev.unread > 0 ? 1 : 0),
      ),
    });
    return false;
  }

  private recomputeLocal(): void {
    if (this.serverSupported !== false) return;
    let unread = 0;
    let mentions = 0;
    let conversations = 0;
    for (const c of this.known.values()) {
      unread += c.unread;
      mentions += c.mentions;
      if (c.unread > 0) conversations += 1;
    }
    const t = this.totals;
    if (
      t.source === 'local' &&
      !t.loading &&
      t.unread === unread &&
      t.mentions === mentions &&
      t.conversations === conversations
    )
      return;
    this.set({ unread, mentions, conversations, source: 'local', loading: false, error: null });
  }

  private scheduleRefetch(): void {
    if (this.refetchTimer || this.destroyed) return;
    this.refetchTimer = setTimeout(() => {
      this.refetchTimer = null;
      void this.refresh();
    }, REFETCH_DEBOUNCE_MS);
  }

  private activate(): void {
    void this.refresh();
    let offUser: (() => void) | null = null;
    let boundId: Uuid | null = null;
    const bind = (me: Me) => {
      if (me.id === boundId || this.destroyed) return;
      offUser?.();
      boundId = me.id;
      offUser = this.bindUser(me.id);
    };
    const known = this.me.peek();
    if (known) bind(known);
    else void this.me.show().catch(() => {});
    const offMe = this.me.onChange(bind);

    // Events missed while the socket was down are never replayed.
    let wasConnected = this.realtime.getStatus() === 'connected';
    let connectedBefore = wasConnected;
    const offStatus = this.realtime.onStatus((status) => {
      const reconnected = status === 'connected' && !wasConnected && connectedBefore;
      connectedBefore ||= status === 'connected';
      wasConnected = status === 'connected';
      if (reconnected) void this.refresh();
    });

    this.unbind = () => {
      offMe();
      offUser?.();
      offStatus();
    };
  }

  private deactivate(): void {
    if (this.refetchTimer) clearTimeout(this.refetchTimer);
    this.refetchTimer = null;
    this.unbind?.();
    this.unbind = null;
  }

  private bindUser(meId: Uuid): () => void {
    const user = this.realtime.user(meId);
    const offRead = user.onConversationRead((evt) =>
      this.apply(evt.conversation_id, evt.unread_count, evt.mention_unread_count ?? 0),
    );
    const offUpdated = user.onConversationUpdated(({ conversation, by_user_id }) => {
      if (typeof conversation.unread_count === 'number') {
        this.apply(
          conversation.id,
          conversation.unread_count,
          conversation.mention_unread_count ?? 0,
        );
        return;
      }
      // An older server without per-member counts on the wire.
      if (by_user_id === meId) return;
      const prev = this.known.get(conversation.id);
      if (prev) this.apply(conversation.id, prev.unread + 1, prev.mentions);
      else if (this.serverSupported) this.scheduleRefetch();
    });
    return () => {
      offRead();
      offUpdated();
    };
  }

  private set(totals: UnreadTotals): void {
    this.totals = totals;
    for (const fn of this.listeners) fn(totals);
  }
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0;
}
