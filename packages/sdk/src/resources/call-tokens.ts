import { ApiError } from '../errors.js';
import type { RestClient } from '../rest-client.js';
import type { CallConnection } from '../voice/livekit-types.js';

/**
 * `/v1/conversations/:id/call-token` — SFU credentials for a call.
 *
 * This is the SFU's access control, not a convenience: LiveKit trusts
 * the token completely and checks no membership of its own, so the
 * server mints one only after verifying the caller is in the
 * conversation.
 */
export class CallTokensResource {
  constructor(private readonly client: RestClient) {}

  /**
   * POST /v1/conversations/:conversationId/call-token
   *
   * Resolves `null` when the deployment has no SFU configured (503).
   * That is deliberately not an error — the caller falls back to the
   * peer-to-peer mesh, which is how every call worked before the SFU
   * existed. A 403 still throws: that one really is a refusal.
   */
  async create(conversationId: string, signal?: AbortSignal): Promise<CallConnection | null> {
    try {
      return await this.client.request<CallConnection>({
        method: 'POST',
        path: `/v1/conversations/${encodeURIComponent(conversationId)}/call-token`,
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) return null;
      throw err;
    }
  }
}
