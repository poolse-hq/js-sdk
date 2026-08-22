// Public entry-point for the SDK. One instance per End User session.
// Re-create when the user signs out or rotates tenants.

import type { PoolseConfig, ResolvedConfig } from './config.js';
import { resolveConfig } from './config.js';
import { PoolseRealtime } from './realtime/realtime.js';
import { AttachmentsResource } from './resources/attachments.js';
import { ConversationsResource } from './resources/conversations.js';
import { DevicesResource } from './resources/devices.js';
import { MeResource } from './resources/me.js';
import { MessagesResource } from './resources/messages.js';
import { UsersResource } from './resources/users.js';
import { CallTokensResource } from './resources/call-tokens.js';
import { CallRoom } from './voice/call-room.js';
import type { CallRoomOptions } from './voice/livekit-types.js';
import { IceServersResource } from './resources/ice-servers.js';
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
  /** STUN/TURN servers for WebRTC — see `IceServersResource`. */
  public readonly iceServers: IceServersResource;
  /** SFU credentials for a call's media — see `CallTokensResource`. */
  public readonly callTokens: CallTokensResource;

  private readonly resolved: ResolvedConfig;
  private readonly tokenCache: TokenCache;

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
    this.iceServers = new IceServersResource(this.rest);
    this.callTokens = new CallTokensResource(this.rest);

    this.realtime = new PoolseRealtime(cachedConfig, this.tokenCache, {
      ...(this.resolved.wsUrl !== undefined ? { wsUrl: this.resolved.wsUrl } : {}),
      socketPath: this.resolved.socketPath,
      // Re-fetched on every room join rather than cached here: TURN
      // credentials expire, and a stale one is rejected silently — the
      // call connects and carries no media.
      iceServersProvider: async () => (await this.iceServers.list()).ice_servers,
    });
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
   *     const usingSfu = await call.join();   // false = no SFU, use the mesh
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
    this.realtime.disconnect();
  }
}
