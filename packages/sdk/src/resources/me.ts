import type { RestClient } from '../rest-client.js';
import type { Me, NotificationPreferences } from '../types.js';

export interface UpdateMeRequest {
  /**
   * Whether others see when this user reads their messages. Accepted
   * only while the workspace lets users decide (`read_receipts.can_change`);
   * otherwise the server answers 409 `read_receipts_fixed`. Reciprocal:
   * turning it off also hides other people's.
   */
  read_receipts?: boolean;
  /**
   * The user's notification preferences; send only the keys that
   * change (`null` clears one): `paused_until` (do-not-disturb until
   * then), `groups` (`all` | `mentions` default for group
   * conversations) and `quiet_hours` (`{ start, end, timezone }`).
   * Send it on its own — the server applies `read_receipts` alone when
   * both are present.
   */
  notifications?: Partial<NotificationPreferences>;
}

/**
 * `/v1/me` — the End-User identity behind the presented JWT.
 *
 * Keeps the last-known user so every screen agrees: a change made
 * through `update` (say, turning read receipts off) reaches every
 * `onChange` subscriber at once instead of waiting for a remount.
 */
export class MeResource {
  private current: Me | null = null;
  // Whether `current` came from the server in this session (not only the
  // offline cache), and the `show` every `ensure` caller shares.
  private fresh = false;
  private inflight: Promise<Me> | null = null;
  private readonly listeners = new Set<(me: Me) => void>();

  constructor(private readonly client: RestClient) {}

  /** GET /v1/me */
  async show(signal?: AbortSignal): Promise<Me> {
    const me = await this.client.request<Me>({
      method: 'GET',
      path: '/v1/me',
      ...(signal ? { signal } : {}),
    });
    this.fresh = true;
    this.set(me);
    return me;
  }

  /**
   * The user, fetched at most once per session: resolves with the one
   * `show` already returned, or joins the request in flight. For the
   * many screens that each want the user at mount (`useMe`).
   */
  ensure(): Promise<Me> {
    if (this.fresh && this.current) return Promise.resolve(this.current);
    this.inflight ??= this.show().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** PATCH /v1/me — the user's own preferences. */
  async update(body: UpdateMeRequest, signal?: AbortSignal): Promise<Me> {
    const me = await this.client.request<Me>({
      method: 'PATCH',
      path: '/v1/me',
      body,
      ...(signal ? { signal } : {}),
    });
    this.set(me);
    return me;
  }

  /** The last user `show` / `update` returned, or null before the first. */
  peek(): Me | null {
    return this.current;
  }

  /** Called with the user whenever `show` or `update` returns a new one. */
  onChange(fn: (me: Me) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /**
   * Seed the user from a local cache (offline start) when none is known
   * yet. The next `show()` replaces it.
   *
   * @internal
   */
  _hydrate(me: Me): void {
    if (!this.current) this.set(me);
  }

  /** @internal */
  _destroy(): void {
    this.listeners.clear();
  }

  private set(me: Me): void {
    this.current = me;
    for (const fn of this.listeners) fn(me);
  }
}
