import type { RestClient } from '../rest-client.js';

/** Which push service a token belongs to. */
export type DevicePlatform = 'ios' | 'android';

/**
 * Which APNs environment issued the token. The two have disjoint token
 * spaces — a sandbox token is rejected by production APNs and vice
 * versa — so a debug build must say `sandbox` or its pushes vanish.
 */
export type DeviceEnvironment = 'production' | 'sandbox';

export interface RegisterDeviceRequest {
  /**
   * On iOS this MUST be the **PushKit VoIP token**, not the regular
   * APNs token. Apple issues them separately and a VoIP push aimed at a
   * normal token is discarded without an error.
   */
  token: string;
  platform: DevicePlatform;
  /** Defaults to `production` server-side. */
  environment?: DeviceEnvironment;
}

/** A registered device, minus the token itself. */
export interface Device {
  id: string;
  tenant_id: string;
  user_id: string;
  platform: DevicePlatform;
  environment: DeviceEnvironment;
  last_registered_at: string | null;
  inserted_at: string;
  updated_at: string;
}

/**
 * `/v1/devices` — where a call should ring when the app isn't running.
 *
 * The realtime `call:incoming` event only reaches a live WebSocket, and
 * iOS suspends sockets on background and drops them on close. Registering
 * here is what lets the server wake the app with a VoIP push instead.
 */
export class DevicesResource {
  constructor(private readonly client: RestClient) {}

  /**
   * POST /v1/devices
   *
   * Idempotent — PushKit hands the app a token on every launch, so call
   * this each time rather than trying to remember whether you already
   * did. Re-registering also refreshes the server's staleness clock.
   */
  register(body: RegisterDeviceRequest, signal?: AbortSignal): Promise<Device> {
    return this.client.request<Device>({
      method: 'POST',
      path: '/v1/devices',
      body,
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * DELETE /v1/devices/:token
   *
   * Call on sign-out, or the handset keeps ringing for a user who is no
   * longer on it.
   */
  unregister(token: string, signal?: AbortSignal): Promise<void> {
    return this.client.request<void>({
      method: 'DELETE',
      path: `/v1/devices/${encodeURIComponent(token)}`,
      ...(signal ? { signal } : {}),
    });
  }
}
