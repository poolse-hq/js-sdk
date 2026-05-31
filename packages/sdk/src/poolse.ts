// Public entry-point for the SDK. One instance per End User session.
// Re-create when the user signs out or rotates tenants.

import type { PoolseConfig, ResolvedConfig } from './config.js';
import { resolveConfig } from './config.js';
import { PoolseRealtime } from './realtime/realtime.js';
import { AttachmentsResource } from './resources/attachments.js';
import { ConversationsResource } from './resources/conversations.js';
import { MeResource } from './resources/me.js';
import { MessagesResource } from './resources/messages.js';
import { RestClient } from './rest-client.js';
import { TokenCache } from './token-cache.js';

export class Poolse {
  /** `/v1/me` — current End User. */
  public readonly me: MeResource;
  /** `/v1/conversations` collection + per-conversation handle factory. */
  public readonly conversations: ConversationsResource;
  /** `/v1/messages/:id/*` — accessed via `chat.messages.one(id)`. */
  public readonly messages: MessagesResource;
  /** `/v1/attachments/*` — presigned-URL uploads/downloads. */
  public readonly attachments: AttachmentsResource;

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
    this.conversations = new ConversationsResource(this.rest);
    this.messages = new MessagesResource(this.rest);
    this.attachments = new AttachmentsResource(this.rest, cachedConfig.fetch);

    this.realtime = new PoolseRealtime(cachedConfig, this.tokenCache, {
      ...(this.resolved.wsUrl !== undefined ? { wsUrl: this.resolved.wsUrl } : {}),
      socketPath: this.resolved.socketPath,
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
