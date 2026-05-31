import type { RestClient } from '../rest-client.js';
import type { Me } from '../types.js';

/** `/v1/me` — the End-User identity behind the presented JWT. */
export class MeResource {
  constructor(private readonly client: RestClient) {}

  /** GET /v1/me */
  show(signal?: AbortSignal): Promise<Me> {
    return this.client.request<Me>({
      method: 'GET',
      path: '/v1/me',
      ...(signal ? { signal } : {}),
    });
  }
}
