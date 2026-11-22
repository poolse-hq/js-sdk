// Public entry-point for the SDK. One instance per End User session.
// Re-create when the user signs out or rotates tenants.
//
// Several instances live side by side (one per workspace server the
// user is signed in to): each owns its socket, caches, outbox and
// storage namespace, and nothing is shared at module level, so
// `destroy()` on one leaves the others untouched.

import type { PoolseConfig, ResolvedConfig } from './config.js';
import { resolveConfig } from './config.js';
import { PoolseRealtime, type UserChannel } from './realtime/realtime.js';
import type { AppEvent, Unsubscribe } from './realtime/types.js';
import { AttachmentsResource } from './resources/attachments.js';
import { ConversationsResource } from './resources/conversations.js';
import { DevicesResource } from './resources/devices.js';
import { MeResource } from './resources/me.js';
import { MessagesResource, ScheduledMessagesResource } from './resources/messages.js';
import { PresenceResource } from './resources/presence.js';
import { NotificationActions } from './notification-actions.js';
import { UsersResource } from './resources/users.js';
import { CallTokensResource } from './resources/call-tokens.js';
import { LiveCallsResource } from './resources/live-calls.js';
import { CallsResource } from './resources/calls.js';
import { RoomsResource } from './resources/rooms.js';
import { AgentsResource, ApprovalsResource } from './agents.js';
import { MeetingsResource } from './meetings.js';
import { LiveMeetingsResource } from './meetings-live.js';
import { CallRoom } from './voice/call-room.js';
import type { CallRoomOptions } from './voice/livekit-types.js';
import { RestClient } from './rest-client.js';
import { TokenCache } from './token-cache.js';
import { LocalCache } from './local-cache.js';
import { Outbox } from './outbox.js';
import { UnreadResource } from './resources/unread.js';
import { ScopedStorage } from './storage.js';
import { ClientTimings } from './timings.js';
import type { Me } from './types.js';

/** Options for {@link Poolse.destroy}. */
export interface DestroyOptions {
  /**
   * Also delete what this client wrote to `config.storage` (outbox,
   * cached history, the user) and what `scoped` services keep for it
   * (drafts) — for a sign-out. Default `false`: kept for the next
   * session of the same user on the same server.
   */
  clearStorage?: boolean;
}

/**
 * Something tied to one client's lifetime, made by
 * {@link Poolse.scoped}. `destroy` runs when the client is destroyed.
 */
export interface ScopedService {
  destroy?: (opts: Required<DestroyOptions>) => void | Promise<void>;
}

/** Options for {@link Poolse.wake}. */
export interface WakeOptions {
  /** How long to stay connected before pausing again (if still in the background). Default 30 s. */
  forMs?: number;
}

export class Poolse {
  /** `/v1/me` — current End User. */
  public readonly me: MeResource;

  /**
   * `/v1/devices` — push destinations, so an incoming call can ring a
   * phone whose app isn't running. Only meaningful on mobile.
   */
  public readonly devices: DevicesResource;
  /** `/v1/conversations` collection + per-conversation handle factory. */
  public readonly conversations: ConversationsResource;
  /** `/v1/messages/:id/*` — accessed via `chat.messages.one(id)`. */
  public readonly messages: MessagesResource;
  /** `/v1/scheduled-messages` — your scheduled messages (MS1); schedule with `conversations.one(id).messages.schedule`. */
  public readonly scheduledMessages: ScheduledMessagesResource;
  /** `/v1/attachments/*` — presigned-URL uploads/downloads. */
  public readonly attachments: AttachmentsResource;

  /**
   * Customer-supplied user metadata, cached + dedup'd.
   * `chat.users.get(userId)` returns `{ displayName, avatarUrl }`
   * via the optional `config.userResolver`. UI components
   * (`MessageBubble`, `MemberList`, `TypingIndicator`) pick this up
   * automatically via the `useUser` hook in `@poolse/react`.
   *
   * If no resolver is configured, `get` always returns `null` and
   * UI falls back to the userId slice + initials avatar.
   */
  public readonly users: UsersResource;

  /**
   * Low-level REST client. Exposed for advanced use cases (custom endpoints,
   * raw retry/headers control). Most callers should use the resources above.
   */
  public readonly rest: RestClient;

  /**
   * WebSocket / Phoenix Channels client. Lazily connects on the first
   * `poolse.realtime.conversation(id)` / `poolse.realtime.user(id)`
   * call — passing `config.apiUrl` (with `http(s)://` swapped to
   * `ws(s)://`) for the socket URL by default, overridable via
   * `config.wsUrl`.
   */
  public readonly realtime: PoolseRealtime;
  /** SFU credentials for a call's media — see `CallTokensResource`. */
  public readonly callTokens: CallTokensResource;
  /** Whether a call is running on a conversation — for a Join banner. */
  public readonly liveCalls: LiveCallsResource;
  /**
   * Recording, consent and transcripts of a call (docs/RECORDING.md):
   * `calls.recording.start(callId, { mode })`, `calls.consent(callId, 'accepted')`,
   * `calls.transcription.start(callId)`, `calls.transcript.get(callId)`.
   */
  public readonly calls: CallsResource;
  /** A conversation's drop-in room: voice or video, nobody rung. */
  public readonly rooms: RoomsResource;
  /**
   * An agent's requests to act (send an email, create an issue…) and
   * your answers: `list()` the pending ones, `approve(id)`, `deny(id,
   * { reason })`; `subscribe` for a live view (AG4).
   */
  public readonly approvals: ApprovalsResource;
  /**
   * The agent directory (`list()`), an agent's scope in a conversation
   * (`inConversation`, `setScope`, `resetScope`), "What we know"
   * (`memory`, `addMemory`…) and follow-ups (`followups`, `followupDone`…).
   */
  public readonly agents: AgentsResource;
  /** Ask what was said in your meetings: `meetings.ask({ question, callId })` (RT8). */
  public readonly meetings: MeetingsResource;
  /**
   * The live meeting features of a call (docs/MEETINGS.md): `stage`
   * (roles, raised hands), `questions` (Q&A with votes), `breakouts`,
   * `lobby`, `moments`, `agenda`, `whiteboard(callId)`, `moveHere(callId)`,
   * and `subscribe(conversationId, callId, listeners)` for live changes.
   */
  public readonly live: LiveMeetingsResource;
  /**
   * Who is online, away, in a call or offline: `get` (REST), a live
   * store (`subscribe` / `peek`), and this device's own activity
   * (`setActivity`, `trackActivity`).
   */
  public readonly presence: PresenceResource;
  /**
   * Reply / mark read with a notification's grant (no session needed;
   * see also `createNotificationActions`).
   */
  public readonly notificationActions: NotificationActions;

  /**
   * Startup and switch timings (connect, first conversations, first
   * messages, …) for speed budgets; add your own with `start(name)`.
   */
  public readonly timings: ClientTimings;
  /** Unread and mention totals for this account, live (`subscribe`). */
  public readonly unread: UnreadResource;
  /**
   * Warm cache of the conversation list and recent messages — in
   * memory, and in `config.storage` when given. The React hooks read
   * and fill it.
   */
  public readonly cache: LocalCache;
  /**
   * Unsent messages: queued while offline, retried on reconnect, kept
   * as `failed` when refused. `useMessages().send` goes through it.
   */
  public readonly outbox: Outbox;

  private readonly resolved: ResolvedConfig;
  private readonly tokenCache: TokenCache;
  private readonly appEventListeners = new Set<(evt: AppEvent) => void>();
  private readonly destroyListeners = new Set<() => void>();
  private readonly services = new Map<string, unknown>();
  private readonly namespaceWaiters: Array<(ns: string) => void> = [];
  private ns: string | null = null;
  private scope: ScopedStorage | null = null;
  private background = false;
  private resumedAt: number | null = null;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private destroying: Promise<void> | null = null;

  constructor(config: PoolseConfig) {
    this.resolved = resolveConfig(config);

    // Wrap the consumer's `getToken` in a cache so the SDK doesn't
    // call back on every REST request / WebSocket connect. Both the
    // REST client and the realtime layer share this one instance so a
    // freshly-minted token from one path serves all subsequent calls.
    this.tokenCache = new TokenCache(this.resolved.getToken);
    const cachedConfig: ResolvedConfig = {
      ...this.resolved,
      getToken: () => this.tokenCache.getToken(),
    };

    this.rest = new RestClient(cachedConfig, this.tokenCache);
    this.me = new MeResource(this.rest);
    this.devices = new DevicesResource(this.rest);
    this.conversations = new ConversationsResource(this.rest);
    this.messages = new MessagesResource(this.rest);
    this.scheduledMessages = new ScheduledMessagesResource(this.rest);
    this.attachments = new AttachmentsResource(this.rest, cachedConfig.fetch);
    this.users = new UsersResource(cachedConfig);
    this.callTokens = new CallTokensResource(this.rest);
    this.liveCalls = new LiveCallsResource(this.rest);
    this.calls = new CallsResource(this.rest);
    this.rooms = new RoomsResource(this.rest);
    this.notificationActions = new NotificationActions(this.rest);

    this.timings = new ClientTimings();
    this.rest.observer = (method, path) => this.observeRequest(method, path);

    this.realtime = new PoolseRealtime(cachedConfig, this.tokenCache, {
      ...(this.resolved.wsUrl !== undefined ? { wsUrl: this.resolved.wsUrl } : {}),
      socketPath: this.resolved.socketPath,
      onUserChannel: (channel) => this.bindUserChannel(channel),
      userJoinParams: () => ({
        ...this.presence._joinParams(),
        ...(this.unread._wantsLive() ? { unread_totals: true } : {}),
      }),
      onOpen: () => this.onSocketOpen(),
    });
    this.presence = new PresenceResource(this.rest, this.realtime, this.me);
    this.unread = new UnreadResource(this.rest, this.realtime, this.me);
    this.agents = new AgentsResource(this.rest, (list) => {
      this.users.noteAgentProfiles(list);
      this.approvals._refreshAgents();
    });
    this.approvals = new ApprovalsResource(this.rest, this.realtime, this.me, (agentId) => {
      const a = this.agents.peek(agentId);
      return a ? { id: a.id, name: a.name, kind: a.template } : null;
    });
    this.meetings = new MeetingsResource(this.rest);
    this.live = new LiveMeetingsResource(this.rest, this.realtime);
    const scope = () => this.storageScope();
    this.cache = new LocalCache(scope, this.resolved.cache);
    this.outbox = new Outbox({
      send: (conversationId, request) =>
        this.conversations.one(conversationId).messages.send(request),
      scope,
      realtime: this.realtime,
      isBackground: () => this.background,
    });

    // The namespace: server + the session's user, as soon as either the
    // app says who it is or `GET /v1/me` does.
    if (this.resolved.storageNamespace) this.setNamespace(this.resolved.storageNamespace);
    this.me.onChange((me) => this.onMe(me));

    if (this.resolved.background) {
      this.background = true;
      this.realtime.pause();
    }
    // Restore what the last session left (offline start): the user, so
    // hooks keyed on it work, and queued sends.
    if (this.resolved.storage && this.ns) {
      void this.storageScope()
        .then((s) => s?.getJson<Me>('me'))
        .then((me) => {
          if (me && typeof me.id === 'string' && !this.destroying) this.me._hydrate(me);
        });
    }
    if (this.resolved.storage) void this.outbox.hydrate();
  }

  /**
   * This client's storage namespace — `poolse:v1:<apiUrl>#<user>` —
   * or null until the user is known (see `config.storageNamespace`).
   * Prefix anything you persist per session with it.
   */
  get namespace(): string | null {
    return this.ns;
  }

  /** The API URL this client talks to (no trailing slash). */
  get apiUrl(): string {
    return this.resolved.apiUrl;
  }

  /** Whether the outbox is on (`config.outbox`). */
  get outboxEnabled(): boolean {
    return this.resolved.outbox;
  }

  /** Resolves with {@link namespace} once it is known. */
  whenNamespace(): Promise<string> {
    if (this.ns) return Promise.resolve(this.ns);
    return new Promise((resolve) => this.namespaceWaiters.push(resolve));
  }

  /** Whether `destroy()` has been called. */
  get destroyed(): boolean {
    return this.destroying !== null;
  }

  /**
   * One instance of a service per client, made on first use and
   * destroyed with the client — how the UI packages keep their stores
   * (conversation list, drafts) per client instead of per module, so a
   * remounted provider finds them warm and two clients never share one.
   *
   *     const store = chat.scoped('my-app:sidebar', (c) => new SidebarStore(c));
   */
  scoped<T>(key: string, create: (client: Poolse) => T): T {
    if (this.services.has(key)) return this.services.get(key) as T;
    const made = create(this);
    this.services.set(key, made);
    return made;
  }

  /** Called once when the client is destroyed. */
  onDestroy(fn: () => void): Unsubscribe {
    this.destroyListeners.add(fn);
    return () => {
      this.destroyListeners.delete(fn);
    };
  }

  /**
   * Move the client to the background (`true`): the socket closes
   * (channel handles and listeners are kept), outbox timers stop, the
   * cache is written out. Back in the foreground (`false`) it
   * reconnects with a fresh token; the hooks catch up from REST and the
   * outbox flushes. For a workspace that isn't on screen on a phone —
   * `@poolse/react-native` has `useBackgroundClients()` for this.
   */
  setBackground(background: boolean): void {
    if (this.destroying || background === this.background) return;
    this.background = background;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
    if (background) {
      this.realtime.pause();
      void this.cache.flush();
    } else {
      this.resumeNow();
    }
  }

  /** Whether the client is in the background (`setBackground(true)` or `config.background`). */
  isBackground(): boolean {
    return this.background;
  }

  /**
   * Connect for a while although in the background — a push for this
   * workspace arrived: the socket opens, unread totals refresh, queued
   * sends go out, and after `forMs` (30 s) it closes again unless the
   * client came to the foreground meanwhile. In the foreground, it
   * just refreshes.
   */
  wake(opts: WakeOptions = {}): void {
    if (this.destroying) return;
    if (!this.background) {
      this.unread._poke();
      void this.outbox.flush();
      return;
    }
    this.resumeNow();
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      if (this.background && !this.destroying) {
        this.realtime.pause();
        void this.cache.flush();
      }
    }, opts.forMs ?? 30_000);
  }

  /**
   * App-defined events sent to the signed-in user (`app:event` on their
   * `user:<id>` channel) — e.g. the Workspace API's `member:updated`
   * after someone changes their name or picture, or
   * `workspace:updated`.
   *
   * Registering a handler joins the user channel as soon as the user is
   * known (after the first `me.show()`), if nothing has yet.
   *
   * Whether or not anything listens, `member:updated` drops the
   * member's cached profile (`users.invalidate(data.external_id)`, or
   * every profile when the event names nobody), so names and pictures
   * re-render with the new ones.
   *
   *     const off = chat.onAppEvent(({ type, data }) => {
   *       if (type === 'workspace:updated') reloadWorkspace();
   *     });
   */
  onAppEvent(fn: (evt: AppEvent) => void): Unsubscribe {
    this.appEventListeners.add(fn);
    let offMe: (() => void) | null = null;
    const me = this.me.peek();
    if (me) {
      this.realtime.user(me.id);
    } else {
      offMe = this.me.onChange((m) => {
        offMe?.();
        offMe = null;
        if (this.appEventListeners.has(fn)) this.realtime.user(m.id);
      });
    }
    return () => {
      this.appEventListeners.delete(fn);
      offMe?.();
    };
  }

  /**
   * A call's media, carried by the SFU.
   *
   * Media only — ringing, presence, roster and mute state stay on
   * poolse's own channels, and a client joins both. See {@link CallRoom}.
   *
   * `livekit` is your app's `livekit-client` import. This package cannot
   * import it for you: tsup rewrites `require()` into `__require()`,
   * which Metro cannot follow, so a dependency required from in here is
   * absent from every React Native bundle.
   *
   *     import * as livekit from 'livekit-client';
   *     const call = poolse.call(conversationId, { livekit, video: true });
   *     const joined = await call.join();   // false = calls aren't available on this deployment
   */
  call(
    conversationId: string,
    opts: Omit<CallRoomOptions, 'tokenProvider'> & Partial<Pick<CallRoomOptions, 'tokenProvider'>>,
  ): CallRoom {
    return new CallRoom({
      ...opts,
      tokenProvider: opts.tokenProvider ?? (() => this.callTokens.create(conversationId)),
    });
  }

  /**
   * Tear down this client: close its WebSocket, drop its channels,
   * timers, caches, outbox and scoped services. Other clients are not
   * touched. Call it when the user signs out of this workspace or the
   * instance is replaced; afterwards the instance is inert (hooks still
   * mounted get no events and open no socket).
   *
   * `{ clearStorage: true }` also deletes this client's data in
   * `config.storage` and its drafts — use it for a sign-out. Resolves
   * once storage is written / cleared; the socket closes at once.
   */
  destroy(opts: DestroyOptions = {}): Promise<void> {
    if (this.destroying) return this.destroying;
    const clearStorage = opts.clearStorage ?? false;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = null;

    // Synchronous part: nothing of this client talks to the server or
    // fires a listener after this.
    this.presence._destroy();
    this.realtime._close();
    this.unread._destroy();
    this.outbox._destroy();
    this.appEventListeners.clear();
    this.users.invalidateAll();
    const services = [...this.services.values()] as ScopedService[];
    this.services.clear();
    const destroyListeners = [...this.destroyListeners];
    this.destroyListeners.clear();

    const run = (async () => {
      for (const svc of services) {
        try {
          await svc?.destroy?.({ clearStorage });
        } catch {
          // One service failing must not keep the others alive.
        }
      }
      if (clearStorage) {
        await this.cache.clear();
        await this.outbox._clear();
        await this.scope?.clear();
      } else {
        await this.cache.flush();
      }
      this.cache._destroy();
      this.me._destroy();
      this.timings._destroy();
    })();
    this.destroying = run;
    for (const fn of destroyListeners) {
      try {
        fn();
      } catch {
        // ignore
      }
    }
    return run;
  }

  /**
   * This client's slice of `config.storage`, once the namespace is
   * known; null without storage.
   *
   * @internal
   */
  storageScope(): Promise<ScopedStorage | null> {
    const storage = this.resolved.storage;
    if (!storage) return Promise.resolve(null);
    if (this.scope) return Promise.resolve(this.scope);
    return this.whenNamespace().then((ns) => {
      this.scope ??= new ScopedStorage(storage, ns);
      return this.scope;
    });
  }

  private setNamespace(user: string): void {
    if (this.ns) return;
    this.ns = `poolse:v1:${this.resolved.apiUrl}#${user}`;
    const waiters = this.namespaceWaiters.splice(0);
    for (const fn of waiters) fn(this.ns);
  }

  private onMe(me: Me): void {
    this.setNamespace(me.id);
    if (this.resolved.storage && !this.destroying) {
      void this.storageScope().then((s) => s?.setJson('me', me));
    }
  }

  private resumeNow(): void {
    this.resumedAt = this.timings._now();
    this.realtime.resume();
    void this.outbox.flush();
  }

  private onSocketOpen(): void {
    this.timings._once('connect');
    if (this.resumedAt !== null) {
      this.timings.record('reconnect', this.timings._now() - this.resumedAt);
      this.resumedAt = null;
    }
  }

  private observeRequest(method: string, path: string): void {
    if (method !== 'GET') return;
    if (path === '/v1/me') this.timings._once('me');
    else if (path === '/v1/conversations') this.timings._once('firstConversations');
    else if (/^\/v1\/conversations\/[^/]+\/messages$/.test(path))
      this.timings._once('firstMessages');
  }

  private bindUserChannel(channel: UserChannel): void {
    this.presence._bind(channel);
    channel.onAppEvent((evt) => {
      if (evt?.type === 'member:updated') this.invalidateMember(evt.data);
      for (const fn of this.appEventListeners) fn(evt);
    });
  }

  private invalidateMember(data: Record<string, unknown> | null | undefined): void {
    const id = data?.['external_id'] ?? data?.['user_external_id'];
    if (typeof id === 'string' && id !== '') this.users.invalidate(id);
    else this.users.invalidateAll();
  }
}
