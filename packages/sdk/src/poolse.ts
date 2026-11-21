// Public entry-point for the SDK. One instance per End User session.
// Re-create when the user signs out or rotates tenants.

import type { PoolseConfig, ResolvedConfig } from './config.js';
import { resolveConfig } from './config.js';
import { PoolseRealtime, type UserChannel } from './realtime/realtime.js';
import type { AppEvent, Unsubscribe } from './realtime/types.js';
import { AttachmentsResource } from './resources/attachments.js';
import { ConversationsResource } from './resources/conversations.js';
import { DevicesResource } from './resources/devices.js';
import { MeResource } from './resources/me.js';
import { MessagesResource } from './resources/messages.js';
import { PresenceResource } from './resources/presence.js';
import { NotificationActions } from './notification-actions.js';
import { UsersResource } from './resources/users.js';
import { CallTokensResource } from './resources/call-tokens.js';
import { LiveCallsResource } from './resources/live-calls.js';
import { RoomsResource } from './resources/rooms.js';
import { CallRoom } from './voice/call-room.js';
import type { CallRoomOptions } from './voice/livekit-types.js';
import { RestClient } from './rest-client.js';
import { TokenCache } from './token-cache.js';

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
  /** A conversation's drop-in room: voice or video, nobody rung. */
  public readonly rooms: RoomsResource;
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

  private readonly resolved: ResolvedConfig;
  private readonly tokenCache: TokenCache;
  private readonly appEventListeners = new Set<(evt: AppEvent) => void>();

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
    this.attachments = new AttachmentsResource(this.rest, cachedConfig.fetch);
    this.users = new UsersResource(cachedConfig);
    this.callTokens = new CallTokensResource(this.rest);
    this.liveCalls = new LiveCallsResource(this.rest);
    this.rooms = new RoomsResource(this.rest);
    this.notificationActions = new NotificationActions(this.rest);

    this.realtime = new PoolseRealtime(cachedConfig, this.tokenCache, {
      ...(this.resolved.wsUrl !== undefined ? { wsUrl: this.resolved.wsUrl } : {}),
      socketPath: this.resolved.socketPath,
      onUserChannel: (channel) => this.bindUserChannel(channel),
      userJoinParams: () => this.presence._joinParams(),
    });
    this.presence = new PresenceResource(this.rest, this.realtime, this.me);
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
   * Tear down the SDK: close the WebSocket, drop all channels.
   * No-op for REST — fetch() doesn't keep persistent state.
   * Call this when the user signs out or the SDK instance is
   * being replaced.
   */
  destroy(): void {
    this.presence._destroy();
    this.realtime.disconnect();
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
