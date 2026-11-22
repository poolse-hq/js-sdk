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
import { ChannelReplyError, PoolseError } from '../errors.js';
import type { TokenCache } from '../token-cache.js';
import { openDocChannel, type DocChannel } from './doc.js';
import type { Presence, PresenceActivity } from '../types.js';
import type { ConsentDecision, Recording, RecordingMode } from '../resources/calls.js';
import type {
  AppEvent,
  CallFinishedEvent,
  CallParticipantsEvent,
  CallStartedEvent,
  ConversationCreatedEvent,
  ConversationReadEvent,
  ConversationUpdatedEvent,
  MemberReadEvent,
  MentionEvent,
  MessageDeletedEvent,
  MessageStreamEvent,
  MessageNewEvent,
  MessageUpdatedEvent,
  PresenceChangedEvent,
  PresenceSnapshot,
  ReactionEvent,
  RealtimeStatus,
  RecordingChangedEvent,
  RecordingConsentEvent,
  RecordingStartedEvent,
  TranscriptChangedEvent,
  TranscriptJoinReply,
  TranscriptSegmentEvent,
  TranscriptSpeakersEvent,
  RingEndedEvent,
  ThreadUpdatedEvent,
  TypingEvent,
  UnreadTotalsEvent,
  Unsubscribe,
} from './types.js';

const TOKEN_REFRESH_ON_ERROR_MS = 30_000;

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
  /** Called once when the `user:<id>` channel handle is created. */
  onUserChannel?: (channel: UserChannel) => void;
  /**
   * Join params for the `user:<id>` channel, read on every (re)join —
   * e.g. `{ presence: 'idle' }` for a device that starts idle.
   */
  userJoinParams?: () => Record<string, unknown>;
  /** Called every time the socket opens (first connect and every reconnect). */
  onOpen?: () => void;
}

export class PoolseRealtime {
  private readonly config: ResolvedConfig;
  private readonly tokenCache: TokenCache;
  private readonly socketPath: string;
  private readonly wsUrl: string;
  private readonly onUserChannel: ((channel: UserChannel) => void) | undefined;
  private readonly userJoinParams: (() => Record<string, unknown>) | undefined;
  private readonly onOpen: (() => void) | undefined;

  private socket: Socket | null = null;
  private readonly conversations = new Map<string, ConversationChannel>();
  private readonly transcripts = new Map<string, TranscriptChannel>();
  private userChannel: UserChannel | null = null;

  private status: RealtimeStatus = 'idle';
  private paused = false;
  /** `_close()` ran: the client is destroyed and never connects again. */
  private closedForGood = false;
  private lastTokenRefreshMs = 0;
  private readonly statusListeners = new Set<(s: RealtimeStatus) => void>();

  constructor(config: ResolvedConfig, tokenCache: TokenCache, opts: RealtimeOptions = {}) {
    this.config = config;
    this.tokenCache = tokenCache;
    this.socketPath = opts.socketPath ?? '/socket';
    this.wsUrl = opts.wsUrl ?? deriveWsUrl(config.apiUrl);
    this.onUserChannel = opts.onUserChannel;
    this.userJoinParams = opts.userJoinParams;
    this.onOpen = opts.onOpen;
  }

  /** Whether `pause()` holds the socket closed. */
  isPaused(): boolean {
    return this.paused;
  }

  /** The `user:<id>` handle if something has joined it, else null. Never connects. */
  peekUser(): UserChannel | null {
    return this.userChannel;
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

    // Paused before the first connect (a client created in the
    // background): build the socket so channels can attach, but leave
    // it closed until `resume()`.
    if (!this.paused) this.setStatus('connecting');

    const socket = new Socket(`${this.wsUrl}${this.socketPath}`, {
      params: () => ({ token: this.tokenCache.peekToken() ?? '' }),
      // Phoenix's default reconnect strategy: 10ms, 50ms, 100ms, 150ms,
      // 200ms, 250ms, 500ms, 1s, 2s, 5s — perfectly reasonable for chat.
    });

    socket.onOpen(() => {
      this.setStatus('connected');
      this.onOpen?.();
    });
    socket.onClose(() => {
      // `onClose` fires for both intentional disconnect and network drop.
      // Phoenix triggers reconnect on its own for the latter; we just
      // surface the transitional state to UIs.
      if (this.paused || this.socket !== socket) return;
      this.setStatus(this.status === 'closed' ? 'closed' : 'reconnecting');
    });
    socket.onError((err) => {
      // A socket closed by pause() can still report its last error.
      if (this.paused || this.socket !== socket) return;
      // Errors don't tear down the socket — Phoenix retries internally.
      // Surface as `reconnecting` so the UI can show a banner.
      this.setStatus('reconnecting');
      // A handshake the server refuses looks like any other error here.
      // If the cached token was revoked, every retry would present it
      // again, so fetch a fresh one — at most every 30s, since a plain
      // network outage lands here too.
      if (Date.now() - this.lastTokenRefreshMs > TOKEN_REFRESH_ON_ERROR_MS) {
        this.lastTokenRefreshMs = Date.now();
        void this.tokenCache.getToken({ forceRefresh: true }).catch(() => {});
      }
      this.config.onSocketError?.(new PoolseError(`socket error: ${String(err)}`));
    });

    this.socket = socket;

    this.lastTokenRefreshMs = Date.now();
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
        if (this.socket === socket && !this.paused) socket.connect();
      });
  }

  /**
   * Close the socket but keep every channel handle and its listeners
   * (for an app going to the background). `resume()` reopens it and
   * Phoenix rejoins the channels. Events sent in between are not
   * replayed; the React hooks reload from REST on reconnect.
   */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    // Not connected yet: the first `connect()` builds the socket but
    // leaves it closed.
    if (!this.socket) return;
    this.setStatus('closed');
    this.socket.disconnect();
  }

  /** Reopen a socket closed by `pause()`, with a fresh token. */
  resume(): void {
    if (!this.paused || this.closedForGood) return;
    this.paused = false;
    const socket = this.socket;
    // Never connected: the next `conversation()` / `user()` connects.
    if (!socket) return;
    this.setStatus('connecting');
    void this.tokenCache
      .getToken()
      .catch((err) => {
        this.config.onSocketError?.(
          new PoolseError(`token fetch failed before socket open: ${String(err)}`),
        );
      })
      .finally(() => {
        // A disconnect() meanwhile dropped this socket.
        if (this.socket === socket && !this.paused) socket.connect();
      });
  }

  /**
   * Disconnect for good (the client is being destroyed): a hook that
   * still asks for a channel afterwards gets an inert handle instead of
   * opening a new socket.
   *
   * @internal
   */
  _close(): void {
    this.disconnect();
    this.closedForGood = true;
    this.paused = true;
    this.statusListeners.clear();
  }

  /** Close the socket and tear down every joined channel. */
  disconnect(): void {
    if (this.closedForGood) return;
    this.paused = false;
    this.setStatus('closed');
    this.conversations.forEach((c) => c._destroy());
    this.conversations.clear();
    this.transcripts.forEach((t) => t._destroy());
    this.transcripts.clear();
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
    // A channel the server closes (the user was removed from the
    // conversation) is never rejoined: drop the handle so the next
    // `conversation(id)` — say after being added back — joins afresh.
    const handle: ConversationChannel = new ConversationChannel(conversationId, channel, () => {
      if (this.conversations.get(conversationId) === handle)
        this.conversations.delete(conversationId);
    });
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

    // Phoenix accepts a function for params and calls it on every
    // (re)join, so a rejoin carries the device's current state.
    const params = this.userJoinParams;
    const channel = this.socket.channel(`user:${userId}`, params ? () => params() : {});
    const handle = new UserChannel(userId, channel);
    this.userChannel = handle;
    handle._join();
    this.onUserChannel?.(handle);
    return handle;
  }

  /**
   * Open a call's live transcript (`transcript:<call_id>`) — members of
   * the call's conversation only. Each call takes a hold on one shared
   * handle; `release()` each hold when done, and the channel is left
   * once nobody holds it. Joining doesn't start transcription
   * (`calls.transcription.start` does): it only streams what there is.
   */
  transcript(callId: string): TranscriptChannel {
    const existing = this.transcripts.get(callId);
    if (existing && !existing.closed) {
      existing._hold();
      return existing;
    }

    this.connect();

    if (!this.socket) {
      throw new PoolseError('socket not initialised — call connect() first');
    }

    const channel = this.socket.channel(`transcript:${callId}`, {});
    const handle: TranscriptChannel = new TranscriptChannel(callId, channel, () => {
      if (this.transcripts.get(callId) === handle) this.transcripts.delete(callId);
    });
    this.transcripts.set(callId, handle);
    handle._hold();
    handle._join();
    return handle;
  }

  /**
   * **Experimental.** Open a live doc's relay (`doc:<doc_id>`, the
   * server's docs/DOCS_RELAY.md) with a doc token from the doc's owner
   * (the Workspace API). `clientId`: the Yjs awareness clientID, shown in
   * presence. Each call opens its own channel; `leave()` it when the
   * editor closes.
   */
  doc(docId: string, docToken: string, opts: { clientId?: number } = {}): DocChannel {
    this.connect();
    if (!this.socket) {
      throw new PoolseError('socket not initialised — call connect() first');
    }
    return openDocChannel(this.socket, docId, docToken, opts);
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
  private readonly closedListeners = new Set<() => void>();

  constructor(conversationId: string, channel: Channel, onGone?: () => void) {
    this.conversationId = conversationId;
    this.channel = channel;

    channel.onClose(() => {
      onGone?.();
      this.closedListeners.forEach((l) => l());
      this.closedListeners.clear();
    });

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

  /** Tombstone for a soft-deleted message (`thread_root_id` says which thread it was in). */
  onMessageDeleted(fn: (evt: MessageDeletedEvent) => void): Unsubscribe {
    return this.subscribe('message:deleted', fn as (p: unknown) => void);
  }

  /**
   * A thread's summary changed (`thread:updated`): a reply was posted
   * or deleted. Merge it into the root with `applyThreadUpdate`.
   */
  onThreadUpdated(fn: (evt: ThreadUpdatedEvent) => void): Unsubscribe {
    return this.subscribe('thread:updated', fn as (p: unknown) => void);
  }

  /** An AI agent's reply as it's written (`message:stream`); see `MessageStreamEvent`. */
  onMessageStream(fn: (evt: MessageStreamEvent) => void): Unsubscribe {
    return this.subscribe('message:stream', fn as (p: unknown) => void);
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

  /** A call went live on this conversation (`call:started`). */
  onCallStarted(fn: (evt: CallStartedEvent) => void): Unsubscribe {
    return this.subscribe('call:started', fn as (p: unknown) => void);
  }

  /** Someone joined or left the live call (`call:participants`): user ids in the room now. */
  onCallParticipants(fn: (evt: CallParticipantsEvent) => void): Unsubscribe {
    return this.subscribe('call:participants', fn as (p: unknown) => void);
  }

  /** The call is over for everyone (`call:finished`). */
  onCallFinished(fn: (evt: CallFinishedEvent) => void): Unsubscribe {
    return this.subscribe('call:finished', fn as (p: unknown) => void);
  }

  /** A call here started being recorded (`recording:started`). */
  onRecordingStarted(fn: (evt: RecordingStartedEvent) => void): Unsubscribe {
    return this.subscribe('recording:started', fn as (p: unknown) => void);
  }

  /** The recording stopped (`recording:stopped`); the file is still being stored. */
  onRecordingStopped(fn: (evt: RecordingChangedEvent) => void): Unsubscribe {
    return this.subscribe('recording:stopped', fn as (p: unknown) => void);
  }

  /** The recording's file is stored (`recording:ready`, `status: ready`) or it failed (`failed`). */
  onRecordingReady(fn: (evt: RecordingChangedEvent) => void): Unsubscribe {
    return this.subscribe('recording:ready', fn as (p: unknown) => void);
  }

  /** Someone answered the consent prompt (`recording:consent`). */
  onRecordingConsent(fn: (evt: RecordingConsentEvent) => void): Unsubscribe {
    return this.subscribe('recording:consent', fn as (p: unknown) => void);
  }

  /** A live transcript started (`transcript:started`). */
  onTranscriptStarted(fn: (evt: TranscriptChangedEvent) => void): Unsubscribe {
    return this.subscribe('transcript:started', fn as (p: unknown) => void);
  }

  /** The live transcript was switched off (`transcript:stopped`). */
  onTranscriptStopped(fn: (evt: TranscriptChangedEvent) => void): Unsubscribe {
    return this.subscribe('transcript:stopped', fn as (p: unknown) => void);
  }

  /** The call is over and its transcript is stored (`transcript:ready`). */
  onTranscriptReady(fn: (evt: TranscriptChangedEvent) => void): Unsubscribe {
    return this.subscribe('transcript:ready', fn as (p: unknown) => void);
  }

  /**
   * A call's summary was written, failed or was skipped (`summary:ready`
   * `{cv, call_id, conversation_id, summary}`); read it with
   * `summaryFromWire(evt.summary)` or `meetings.summary(callId)`.
   */
  onSummaryReady(
    fn: (evt: { call_id: string; conversation_id: string; summary: unknown }) => void,
  ): Unsubscribe {
    return this.subscribe('summary:ready', fn as (p: unknown) => void);
  }

  /** A clip was cut (or failed): `clip:ready` `{cv, call_id, conversation_id, clip}`. */
  onClipReady(
    fn: (evt: { call_id: string; conversation_id: string; clip: unknown }) => void,
  ): Unsubscribe {
    return this.subscribe('clip:ready', fn as (p: unknown) => void);
  }

  /** A clip was deleted: `clip:deleted` `{cv, call_id, conversation_id, clip}`. */
  onClipDeleted(
    fn: (evt: { call_id: string; conversation_id: string; clip: unknown }) => void,
  ): Unsubscribe {
    return this.subscribe('clip:deleted', fn as (p: unknown) => void);
  }

  /** A speaker was renamed (`transcript:speakers`). */
  onTranscriptSpeakers(fn: (evt: TranscriptSpeakersEvent) => void): Unsubscribe {
    return this.subscribe('transcript:speakers', fn as (p: unknown) => void);
  }

  /**
   * Start recording over the socket (`recording:start`); the same rules
   * and errors as `calls.recording.start`, as a {@link ChannelReplyError}
   * `reason`. The call must be on this conversation.
   */
  startRecording(callId: string, mode?: RecordingMode): Promise<Recording> {
    return this.request<{ recording: Recording }>('recording:start', {
      call_id: callId,
      ...(mode ? { mode } : {}),
    }).then((r) => r.recording);
  }

  /** Stop recording over the socket (`recording:stop`). */
  stopRecording(callId: string): Promise<Recording> {
    return this.request<{ recording: Recording }>('recording:stop', { call_id: callId }).then(
      (r) => r.recording,
    );
  }

  /** Answer the consent prompt over the socket (`recording:consent`). */
  sendConsent(
    callId: string,
    decision: ConsentDecision,
  ): Promise<{ call_id: string; user_id: string; decision: ConsentDecision }> {
    return this.request('recording:consent', { call_id: callId, decision });
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

  /**
   * The channel closed for good: the server removed you from the
   * conversation, or `leave()` / `disconnect()` was called. No more
   * events arrive on this handle; `realtime.conversation(id)` returns a
   * fresh one.
   */
  onClosed(fn: () => void): Unsubscribe {
    this.closedListeners.add(fn);
    return () => {
      this.closedListeners.delete(fn);
    };
  }

  /**
   * Any server event on this conversation's topic, by name — for events
   * without a typed handler here (the live meeting events in
   * `meetings-live.ts` read through this). The payload is as sent.
   */
  on(event: string, fn: (payload: unknown) => void): Unsubscribe {
    return this.subscribe(event, fn);
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

  private request<T>(event: string, payload: object): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.channel
        .push(event, payload)
        .receive('ok', (reply: unknown) => resolve(reply as T))
        .receive('error', (reply: unknown) => reject(new ChannelReplyError(event, reply)))
        .receive('timeout', () => reject(new ChannelReplyError(event, { reason: 'timeout' })));
    });
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

// ── TranscriptChannel ──────────────────────────────────────────────────

/**
 * A call's live transcript (`transcript:<call_id>`), from
 * `realtime.transcript(callId)`. The join reply — the transcript so far,
 * its last 200 final segments — arrives on every (re)join through
 * `onJoined`, and is replayed to late subscribers; segments stream
 * through `onSegment`.
 */
export class TranscriptChannel {
  public readonly callId: string;
  private readonly channel: Channel;
  private readonly onGone: (() => void) | undefined;
  private readonly segmentListeners = new Set<(evt: TranscriptSegmentEvent) => void>();
  private readonly joinedListeners = new Set<(reply: TranscriptJoinReply) => void>();
  private readonly errorListeners = new Set<(reason: string) => void>();
  private lastReply: TranscriptJoinReply | null = null;
  private holders = 0;
  private _closed = false;

  constructor(callId: string, channel: Channel, onGone?: () => void) {
    this.callId = callId;
    this.channel = channel;
    this.onGone = onGone;
    channel.on('transcript:segment', (payload: unknown) => {
      this.segmentListeners.forEach((l) => l(payload as TranscriptSegmentEvent));
    });
    channel.onClose(() => this.finish());
  }

  /** True once the channel is gone (released, refused, or removed from the conversation). */
  get closed(): boolean {
    return this._closed;
  }

  /** Every pushed segment, interim and final (fold with `applyLiveSegment`). */
  onSegment(fn: (evt: TranscriptSegmentEvent) => void): Unsubscribe {
    this.segmentListeners.add(fn);
    return () => {
      this.segmentListeners.delete(fn);
    };
  }

  /** The join reply, on every (re)join — resync from it. Replayed at once when already joined. */
  onJoined(fn: (reply: TranscriptJoinReply) => void): Unsubscribe {
    this.joinedListeners.add(fn);
    if (this.lastReply) fn(this.lastReply);
    return () => {
      this.joinedListeners.delete(fn);
    };
  }

  /**
   * The join was refused (`forbidden`, `not_found`). The channel is left
   * — it is not retried. Replayed to late subscribers.
   */
  onError(fn: (reason: string) => void): Unsubscribe {
    this.errorListeners.add(fn);
    if (this.refusedReason) fn(this.refusedReason);
    return () => {
      this.errorListeners.delete(fn);
    };
  }

  private refusedReason: string | null = null;

  /** Let go of one hold from `realtime.transcript(callId)`; the last one leaves the channel. */
  release(): void {
    this.holders = Math.max(0, this.holders - 1);
    if (this.holders === 0) this._destroy();
  }

  /** @internal */
  _hold(): void {
    this.holders += 1;
  }

  /** @internal */
  _join(): void {
    this.channel
      .join()
      .receive('ok', (reply: unknown) => {
        const r = (reply ?? {}) as Partial<TranscriptJoinReply>;
        this.lastReply = {
          conversation_id: r.conversation_id ?? '',
          transcript: r.transcript ?? null,
          segments: Array.isArray(r.segments) ? r.segments : [],
        };
        this.joinedListeners.forEach((l) => l(this.lastReply!));
      })
      .receive('error', (reply: unknown) => {
        const reason =
          reply &&
          typeof reply === 'object' &&
          typeof (reply as { reason?: unknown }).reason === 'string'
            ? (reply as { reason: string }).reason
            : 'error';
        // Phoenix would rejoin forever; a refusal doesn't change by retrying.
        this.refusedReason = reason;
        this.errorListeners.forEach((l) => l(reason));
        this._destroy();
      });
  }

  /** @internal */
  _destroy(): void {
    if (this._closed) return;
    this.channel.leave();
    this.finish();
  }

  private finish(): void {
    if (this._closed) return;
    this._closed = true;
    this.onGone?.();
    this.segmentListeners.clear();
    this.joinedListeners.clear();
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
  // One Phoenix binding per event, fanned out — as in ConversationChannel.
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  private readonly joinedListeners = new Set<() => void>();

  constructor(userId: string, channel: Channel) {
    this.userId = userId;
    this.channel = channel;
  }

  /**
   * The underlying Phoenix channel, for hosts that listen to events the
   * handle has no method for (a native call host forwards
   * `call:ring_ended` / `call:finished` to its call core).
   *
   * @internal
   */
  _channel(): Channel {
    return this.channel;
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

  /**
   * Your ring for a call ended — answered on another device, declined,
   * cancelled by the caller or timed out. Stop ringing on this device.
   */
  onRingEnded(fn: (evt: RingEndedEvent) => void): Unsubscribe {
    return this.subscribe('call:ring_ended', fn as (p: unknown) => void);
  }

  /**
   * A call you were part of (rung or joined) is over. Arrives on the
   * user channel, which the app stays joined to even after leaving the
   * conversation's channel mid-call.
   */
  onCallFinished(fn: (evt: CallFinishedEvent) => void): Unsubscribe {
    return this.subscribe('call:finished', fn as (p: unknown) => void);
  }

  /**
   * Your read position in a conversation moved — on this device or
   * another one. Carries the fresh `unread_count` and
   * `mention_unread_count` to show on the conversation's badge.
   */
  onConversationRead(fn: (evt: ConversationReadEvent) => void): Unsubscribe {
    return this.subscribe('conversation:read', fn as (p: unknown) => void);
  }

  /**
   * The account's unread totals changed (`unread:totals`). Pushed only
   * to a socket that joined with `unread_totals: true` — `poolse.unread`
   * opts in while it has subscribers.
   */
  onUnreadTotals(fn: (evt: UnreadTotalsEvent) => void): Unsubscribe {
    return this.subscribe('unread:totals', fn as (p: unknown) => void);
  }

  /** Ask for the unread totals now (`unread:totals`; 60/min per socket). */
  requestUnreadTotals(): Promise<UnreadTotalsEvent> {
    return this.request('unread:totals', {});
  }

  /**
   * An app-defined event sent to this user (`app:event`) — e.g. the
   * Workspace API's `member:updated` / `workspace:updated`.
   */
  onAppEvent(fn: (evt: AppEvent) => void): Unsubscribe {
    return this.subscribe('app:event', fn as (p: unknown) => void);
  }

  /**
   * An agent's approval request for you was made or decided
   * (`agent:approval` `{event: "requested" | "decided", approval}`) —
   * `poolse.approvals` follows it.
   */
  onAgentApproval(fn: (evt: { event: string; approval: unknown }) => void): Unsubscribe {
    return this.subscribe('agent:approval', fn as (p: unknown) => void);
  }

  /**
   * Someone's presence changed (`presence:changed`). Most apps read
   * presence through `poolse.presence` instead, which keeps a store.
   */
  onPresenceChanged(fn: (evt: PresenceChangedEvent) => void): Unsubscribe {
    return this.subscribe('presence:changed', fn as (p: unknown) => void);
  }

  /**
   * Report this device `active` or `idle` (`presence:set`). Rejects
   * with a {@link ChannelReplyError} (`invalid_state`, `rate_limited` —
   * 30 a minute per socket — or `timeout`).
   */
  setPresence(state: PresenceActivity): Promise<{ state: PresenceActivity }> {
    return this.request('presence:set', { state });
  }

  /**
   * Look up to 200 users' presence (`presence:get`) by internal id or
   * `external_id`; from then on this socket also hears their
   * `presence:changed`. Unknown ids are left out.
   */
  async getPresence(
    lookup: { user_ids: string[] } | { external_ids: string[] },
  ): Promise<Presence[]> {
    const reply = await this.request<{ presences?: Presence[] }>('presence:get', lookup);
    return reply?.presences ?? [];
  }

  /** Called after every successful join and rejoin of the channel. */
  onJoined(fn: () => void): Unsubscribe {
    this.joinedListeners.add(fn);
    return () => {
      this.joinedListeners.delete(fn);
    };
  }

  /** Whether the channel is joined right now (pushes go out at once). */
  isJoined(): boolean {
    return (this.channel as { state?: string }).state === 'joined';
  }

  /** @internal */
  _join(): void {
    // The join push keeps its hooks across rejoins, so `ok` fires on
    // every successful (re)join.
    this.channel.join().receive('ok', () => {
      this.joinedListeners.forEach((l) => l());
    });
  }

  /** @internal */
  _destroy(): void {
    this.joinedListeners.clear();
    this.listeners.clear();
    this.mentionListeners.clear();
    this.conversationCreatedListeners.clear();
    this.conversationUpdatedListeners.clear();
    this.channel.leave();
  }

  private subscribe(event: string, fn: (payload: unknown) => void): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
      this.channel.on(event, (payload: unknown) => {
        this.listeners.get(event)?.forEach((l) => l(payload));
      });
    }
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }

  private request<T>(event: string, payload: object): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.channel
        .push(event, payload)
        .receive('ok', (reply: unknown) => resolve(reply as T))
        .receive('error', (reply: unknown) => reject(new ChannelReplyError(event, reply)))
        .receive('timeout', () => reject(new ChannelReplyError(event, { reason: 'timeout' })));
    });
  }
}

// ── helpers ────────────────────────────────────────────────────────────

function deriveWsUrl(apiUrl: string): string {
  // http(s):// → ws(s)://. Same host + port. The realtime endpoint
  // typically shares its origin with the REST API (single VPS) but
  // can be overridden via `RealtimeOptions.wsUrl`.
  return apiUrl.replace(/^http/, 'ws');
}
