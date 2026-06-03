// poolse Realtime — thin wrapper over Phoenix.Socket.
//
// Responsibilities:
//   * Lazy connection: socket opens on the first `conversation()` / `user()` call.
//   * Auto-reconnect with exponential backoff (default Phoenix behavior is fine).
//   * Auto-rejoin channels on reconnect (Phoenix handles this for joined channels).
//   * Typed listener API: `conv.onMessage((msg) => …)`.
//   * Token refresh: re-pulls `getToken` on every (re)connect so a refreshed
//     JWT lands the next time without manual intervention.
//
// Designed to be `instanceof`-stable so React hooks can mount/unmount
// without tearing down the socket — `Poolse` holds a single instance
// and consumers get back the same handle for the same conversation id.

import { Socket } from 'phoenix';
import type { Channel } from 'phoenix';

import type { ResolvedConfig } from '../config.js';
import { PoolseError } from '../errors.js';
import type { TokenCache } from '../token-cache.js';
import type {
  ConversationCreatedEvent,
  ConversationUpdatedEvent,
  MemberReadEvent,
  MentionEvent,
  MessageDeletedEvent,
  MessageNewEvent,
  MessageUpdatedEvent,
  PresenceSnapshot,
  ReactionEvent,
  RealtimeStatus,
  TypingEvent,
  Unsubscribe,
} from './types.js';

interface RealtimeOptions {
  /**
   * WebSocket endpoint path (mounted in caas_realtime). Defaults to
   * `'/socket'` — matches the path served by `CaasRealtimeWeb.UserSocket`.
   */
  socketPath?: string;
  /**
   * Override the Phoenix-derived WebSocket URL. Use when the realtime
   * gateway lives on a different host than the REST API (most common
   * in prod: `https://api.example.com` for REST, `wss://realtime.example.com`
   * for WebSocket). When unset, the WS URL is derived from `apiUrl` by
   * swapping http(s) → ws(s).
   */
  wsUrl?: string;
}

export class PoolseRealtime {
  private readonly config: ResolvedConfig;
  private readonly tokenCache: TokenCache;
  private readonly socketPath: string;
  private readonly wsUrl: string;

  private socket: Socket | null = null;
  private readonly conversations = new Map<string, ConversationChannel>();
  private userChannel: UserChannel | null = null;

  private status: RealtimeStatus = 'idle';
  private readonly statusListeners = new Set<(s: RealtimeStatus) => void>();

  constructor(config: ResolvedConfig, tokenCache: TokenCache, opts: RealtimeOptions = {}) {
    this.config = config;
    this.tokenCache = tokenCache;
    this.socketPath = opts.socketPath ?? '/socket';
    this.wsUrl = opts.wsUrl ?? deriveWsUrl(config.apiUrl);
  }

  /** Current connection status. */
  getStatus(): RealtimeStatus {
    return this.status;
  }

  /** Subscribe to connection-status changes. */
  onStatus(listener: (status: RealtimeStatus) => void): Unsubscribe {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /**
   * Open the socket (idempotent). Synchronous construction so callers
   * can join a channel on the next line; the underlying WebSocket
   * connects on the next tick once the JWT pre-fetch resolves.
   *
   * Phoenix.js invokes the `params` callback SYNCHRONOUSLY on every
   * (re)connect and does NOT await its return value — see
   * `phoenix/priv/static/phoenix.mjs::endPointURL`. So `params` has
   * to read a token that's already in hand. We:
   *
   *   1. Construct the Socket immediately (sets `this.socket` so
   *      concurrent `conversation()` / `user()` callers can attach
   *      channels — Phoenix buffers joins until the socket opens).
   *   2. Pre-fetch the JWT through `TokenCache`, which fills its
   *      internal cache.
   *   3. Call `socket.connect()` so phoenix.js's first handshake reads
   *      a primed `peekToken()`.
   *
   * On reconnect, Phoenix calls `params()` again; the cache is still
   * warm (default JWT exp ~1h, refresh window 30s) so `peekToken()`
   * returns the live token. When the token genuinely expires, our
   * REST 401 path invalidates the cache; the next reconnect's
   * `peekToken()` is `null` and the handshake intentionally fails so
   * the cache can re-fill on the next iteration.
   */
  connect(): void {
    if (this.socket) return;

    this.setStatus('connecting');

    const socket = new Socket(`${this.wsUrl}${this.socketPath}`, {
      params: () => ({ token: this.tokenCache.peekToken() ?? '' }),
      // Phoenix's default reconnect strategy: 10ms, 50ms, 100ms, 150ms,
      // 200ms, 250ms, 500ms, 1s, 2s, 5s — perfectly reasonable for chat.
    });

    socket.onOpen(() => this.setStatus('connected'));
    socket.onClose(() => {
      // `onClose` fires for both intentional disconnect and network drop.
      // Phoenix triggers reconnect on its own for the latter; we just
      // surface the transitional state to UIs.
      this.setStatus(this.status === 'closed' ? 'closed' : 'reconnecting');
    });
    socket.onError((err) => {
      // Errors don't tear down the socket — Phoenix retries internally.
      // Surface as `reconnecting` so the UI can show a banner.
      this.setStatus('reconnecting');
      this.config.onSocketError?.(new PoolseError(`socket error: ${String(err)}`));
    });

    this.socket = socket;

    // Pre-fetch the JWT, then open the socket. Channel joins called
    // between now and socket.connect() are buffered by Phoenix and
    // flushed on open, so callers don't need to await anything.
    void this.tokenCache
      .getToken()
      .catch((err) => {
        this.config.onSocketError?.(
          new PoolseError(`token fetch failed before socket open: ${String(err)}`),
        );
      })
      .finally(() => {
        socket.connect();
      });
  }

  /** Close the socket and tear down every joined channel. */
  disconnect(): void {
    this.setStatus('closed');
    this.conversations.forEach((c) => c._destroy());
    this.conversations.clear();
    this.userChannel?._destroy();
    this.userChannel = null;
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  /**
   * Subscribe to a conversation. Returns a typed handle with
   * `onMessage`, `onTyping`, etc. Reusing the same `id` returns the
   * same handle — re-subscribing doesn't open a second channel.
   */
  conversation(conversationId: string): ConversationChannel {
    const existing = this.conversations.get(conversationId);
    if (existing) return existing;

    this.connect();

    if (!this.socket) {
      throw new PoolseError('socket not initialised — call connect() first');
    }

    const channel = this.socket.channel(`conversation:${conversationId}`, {});
    const handle = new ConversationChannel(conversationId, channel);
    this.conversations.set(conversationId, handle);
    handle._join();
    return handle;
  }

  /**
   * Subscribe to the current user's `user:<id>` channel. Only the user
   * matching the JWT can join — poolse's UserChannel enforces this.
   */
  user(userId: string): UserChannel {
    if (this.userChannel) return this.userChannel;

    this.connect();

    if (!this.socket) {
      throw new PoolseError('socket not initialised — call connect() first');
    }

    const channel = this.socket.channel(`user:${userId}`, {});
    const handle = new UserChannel(userId, channel);
    this.userChannel = handle;
    handle._join();
    return handle;
  }

  /** Drop a conversation handle and leave the channel. */
  leave(conversationId: string): void {
    const handle = this.conversations.get(conversationId);
    if (!handle) return;
    handle._destroy();
    this.conversations.delete(conversationId);
  }

  private setStatus(status: RealtimeStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }
}

// ── ConversationChannel ────────────────────────────────────────────────

export class ConversationChannel {
  public readonly conversationId: string;
  private readonly channel: Channel;

  // Map from event-name → set of listeners. We bind one Phoenix `.on(...)`
  // per event name (no matter how many JS listeners) and fan out
  // ourselves — much cheaper than re-binding on every subscription.
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();

  // Phoenix.Presence pushes `presence_state` exactly ONCE right after
  // join, then `presence_diff` for every change. Late subscribers
  // (MemberList mounted after ConversationView has already joined the
  // channel) would otherwise never see the initial snapshot and stay
  // empty until somebody else joins or leaves. We cache the running
  // state here and replay it on subscribe.
  private presenceState: PresenceSnapshot = {};
  private presenceStateSeen = false;

  constructor(conversationId: string, channel: Channel) {
    this.conversationId = conversationId;
    this.channel = channel;

    // Bind presence handlers eagerly (not via the lazy `subscribe`
    // path) so the cache fills regardless of subscriber timing.
    channel.on('presence_state', (payload: unknown) => {
      this.presenceState = (payload ?? {}) as PresenceSnapshot;
      this.presenceStateSeen = true;
      const listeners = this.listeners.get('presence_state');
      if (listeners) listeners.forEach((l) => l(this.presenceState));
    });
    channel.on('presence_diff', (payload: unknown) => {
      const diff = (payload ?? {}) as { joins?: PresenceSnapshot; leaves?: PresenceSnapshot };
      const next: PresenceSnapshot = { ...this.presenceState };
      if (diff.joins) for (const [k, v] of Object.entries(diff.joins)) next[k] = v;
      if (diff.leaves) for (const k of Object.keys(diff.leaves)) delete next[k];
      this.presenceState = next;
      const listeners = this.listeners.get('presence_diff');
      if (listeners) listeners.forEach((l) => l(payload));
    });
  }

  /** New message pushed to the conversation. */
  onMessage(fn: (msg: MessageNewEvent) => void): Unsubscribe {
    return this.subscribe('message:new', fn as (p: unknown) => void);
  }

  /** Existing message edited by its sender. */
  onMessageUpdated(fn: (msg: MessageUpdatedEvent) => void): Unsubscribe {
    return this.subscribe('message:updated', fn as (p: unknown) => void);
  }

  /** Tombstone for a soft-deleted message. */
  onMessageDeleted(fn: (evt: MessageDeletedEvent) => void): Unsubscribe {
    return this.subscribe('message:deleted', fn as (p: unknown) => void);
  }

  onTypingStart(fn: (evt: TypingEvent) => void): Unsubscribe {
    return this.subscribe('typing:start', fn as (p: unknown) => void);
  }

  onTypingStop(fn: (evt: TypingEvent) => void): Unsubscribe {
    return this.subscribe('typing:stop', fn as (p: unknown) => void);
  }

  onReactionAdded(fn: (evt: ReactionEvent) => void): Unsubscribe {
    return this.subscribe('reaction:added', fn as (p: unknown) => void);
  }

  onReactionRemoved(fn: (evt: ReactionEvent) => void): Unsubscribe {
    return this.subscribe('reaction:removed', fn as (p: unknown) => void);
  }

  /**
   * A conversation member advanced their read cursor. Used to flip the
   * sender's read-receipt glyph from "sent" to "read" in real time.
   */
  onMemberRead(fn: (evt: MemberReadEvent) => void): Unsubscribe {
    return this.subscribe('member:read', fn as (p: unknown) => void);
  }

  onPresenceState(fn: (state: PresenceSnapshot) => void): Unsubscribe {
    let set = this.listeners.get('presence_state');
    if (!set) {
      set = new Set();
      this.listeners.set('presence_state', set);
    }
    set.add(fn as (p: unknown) => void);
    // Replay the cached presence_state to late subscribers — Phoenix
    // pushes it once on join and never resends, so MemberList mounted
    // after ConversationView would otherwise stay empty.
    if (this.presenceStateSeen) fn(this.presenceState);
    return () => {
      set.delete(fn as (p: unknown) => void);
    };
  }

  onPresenceDiff(fn: (diff: PresenceSnapshot) => void): Unsubscribe {
    return this.subscribe('presence_diff', fn as (p: unknown) => void);
  }

  /** Current presence snapshot for sync access — usually used in tests. */
  getPresenceState(): PresenceSnapshot {
    return this.presenceState;
  }

  /** Send a typing ping to the server. Debounced server-side. */
  sendTyping(): void {
    this.channel.push('typing', {});
  }

  /** @internal — called by `PoolseRealtime.conversation/1`. */
  _join(): void {
    this.channel.join();
  }

  /** @internal — called when the consumer leaves this conversation. */
  _destroy(): void {
    this.listeners.clear();
    this.channel.leave();
  }

  private subscribe(event: string, fn: (payload: unknown) => void): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
      this.channel.on(event, (payload: unknown) => {
        const listeners = this.listeners.get(event);
        if (listeners) listeners.forEach((l) => l(payload));
      });
    }
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }
}

// ── UserChannel ────────────────────────────────────────────────────────

export class UserChannel {
  public readonly userId: string;
  private readonly channel: Channel;
  private readonly mentionListeners = new Set<(evt: MentionEvent) => void>();
  private readonly conversationCreatedListeners = new Set<
    (evt: ConversationCreatedEvent) => void
  >();
  private readonly conversationUpdatedListeners = new Set<
    (evt: ConversationUpdatedEvent) => void
  >();
  private mentionBound = false;
  private conversationCreatedBound = false;
  private conversationUpdatedBound = false;

  constructor(userId: string, channel: Channel) {
    this.userId = userId;
    this.channel = channel;
  }

  onMention(fn: (evt: MentionEvent) => void): Unsubscribe {
    if (!this.mentionBound) {
      this.mentionBound = true;
      this.channel.on('mention:new', (payload: unknown) => {
        this.mentionListeners.forEach((l) => l(payload as MentionEvent));
      });
    }
    this.mentionListeners.add(fn);
    return () => {
      this.mentionListeners.delete(fn);
    };
  }

  /**
   * Subscribe to "you've been added to a conversation" notifications.
   * Fires once per new membership — either because you created the
   * conversation, or because someone added you to an existing one.
   *
   * Payload is the full {@link Conversation} row so consumers can
   * prepend it to a local list without a refetch.
   */
  onConversationCreated(fn: (conv: ConversationCreatedEvent) => void): Unsubscribe {
    if (!this.conversationCreatedBound) {
      this.conversationCreatedBound = true;
      this.channel.on('conversation:created', (payload: unknown) => {
        this.conversationCreatedListeners.forEach((l) => l(payload as ConversationCreatedEvent));
      });
    }
    this.conversationCreatedListeners.add(fn);
    return () => {
      this.conversationCreatedListeners.delete(fn);
    };
  }

  /**
   * Subscribe to "an existing conversation changed" notifications —
   * fires after every `send_message` in any conversation you're a
   * member of. Use this to update the conversation-list row's last
   * message preview, timestamp, and unread badge without polling.
   *
   * Compare `evt.by_user_id` to your own user id to decide whether
   * to increment a local unread counter; the server already keeps
   * your own outbound messages out of your unread count.
   */
  onConversationUpdated(fn: (evt: ConversationUpdatedEvent) => void): Unsubscribe {
    if (!this.conversationUpdatedBound) {
      this.conversationUpdatedBound = true;
      this.channel.on('conversation:updated', (payload: unknown) => {
        this.conversationUpdatedListeners.forEach((l) => l(payload as ConversationUpdatedEvent));
      });
    }
    this.conversationUpdatedListeners.add(fn);
    return () => {
      this.conversationUpdatedListeners.delete(fn);
    };
  }

  /** @internal */
  _join(): void {
    this.channel.join();
  }

  /** @internal */
  _destroy(): void {
    this.mentionListeners.clear();
    this.conversationCreatedListeners.clear();
    this.conversationUpdatedListeners.clear();
    this.channel.leave();
  }
}

// ── helpers ────────────────────────────────────────────────────────────

function deriveWsUrl(apiUrl: string): string {
  // http(s):// → ws(s)://. Same host + port. The realtime endpoint
  // typically shares its origin with the REST API (single VPS) but
  // can be overridden via `RealtimeOptions.wsUrl`.
  return apiUrl.replace(/^http/, 'ws');
}
