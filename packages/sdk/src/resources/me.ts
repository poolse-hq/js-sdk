import type { RestClient } from '../rest-client.js';
import type { Me } from '../types.js';

export interface UpdateMeRequest {
  /**
   * Whether others see when this user reads their messages. Accepted
   * only while the workspace lets users decide (`read_receipts.can_change`);
   * otherwise the server answers 409 `read_receipts_fixed`. Reciprocal:
   * turning it off also hides other people's.
   */
  read_receipts?: boolean;
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
  private readonly listeners = new Set<(me: Me) => void>();

  constructor(private readonly client: RestClient) {}

  /** GET /v1/me */
  async show(signal?: AbortSignal): Promise<Me> {
    const me = await this.client.request<Me>({
      method: 'GET',
      path: '/v1/me',
      ...(signal ? { signal } : {}),
    });
    this.set(me);
    return me;
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

  private set(me: Me): void {
    this.current = me;
    for (const fn of this.listeners) fn(me);
  }
}
