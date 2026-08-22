import type { RestClient } from '../rest-client.js';
import type { VoiceIceServer } from '../voice/types.js';

export interface IceServerResponse {
  ice_servers: VoiceIceServer[];
  ttl_seconds: number;
}

/**
 * `/v1/ice-servers` — STUN, and TURN when the deployment has it.
 *
 * Fetched rather than configured because TURN credentials are
 * deliberately short-lived. A client that held a static one could not
 * refresh it, and a TURN password compiled into a mobile binary is
 * extractable by anyone who wants it.
 */
export class IceServersResource {
  constructor(private readonly client: RestClient) {}

  /** GET /v1/ice-servers */
  list(signal?: AbortSignal): Promise<IceServerResponse> {
    return this.client.request<IceServerResponse>({
      method: 'GET',
      path: '/v1/ice-servers',
      ...(signal ? { signal } : {}),
    });
  }
}
