import type { RestClient } from '../rest-client.js';
import type { LiveCall } from './live-calls.js';

/** What starting or joining a room returns (the call contract's session bundle). */
export interface RoomSession {
  cv: number;
  /** True when this request started the room; false when it joined one already live. */
  created: boolean;
  /** The live room — or call: a ringing call already live there is joined instead. */
  call: LiveCall;
  /** SFU credentials for this participant. */
  livekit: { url: string; token: string };
  /** Authorizes leaving (`leave`); scoped to this call. */
  control_token: string;
}

/**
 * A conversation's room — the Meet-style way to talk: anyone in the
 * conversation drops in for voice or video while the chat carries on,
 * and nobody's phone rings. One room per conversation; starting one
 * while it is live (or while a call is) joins that instead.
 *
 * Members see it the same way as a call — `liveCalls.get`, the
 * `call:started` / `call:participants` / `call:finished` events, a Join
 * banner — and phones join it like any call. It ends once it has been
 * empty for a short grace, and leaves one line in the chat history.
 */
export class RoomsResource {
  constructor(private readonly client: RestClient) {}

  /** POST /v1/conversations/:id/room — start the room, or join what is live. */
  start(
    conversationId: string,
    media: 'audio' | 'video' = 'audio',
    signal?: AbortSignal,
  ): Promise<RoomSession> {
    return this.client.request<RoomSession>({
      method: 'POST',
      path: `/v1/conversations/${encodeURIComponent(conversationId)}/room`,
      body: { media },
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * POST /v1/conversations/:id/calls — like `start`, but RINGS the other
   * members' phones (a support desk calling a customer). Off by default
   * in the room UI; an app opts in. Joins whatever is live instead, the
   * same as `start`.
   */
  ring(
    conversationId: string,
    media: 'audio' | 'video' = 'audio',
    signal?: AbortSignal,
  ): Promise<RoomSession> {
    return this.client.request<RoomSession>({
      method: 'POST',
      path: `/v1/conversations/${encodeURIComponent(conversationId)}/calls`,
      body: { media },
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * POST /v1/calls/:id/hangup — leave. Never ends the room for the others;
   * it ends once empty. Authorized by the session's control token.
   */
  leave(session: Pick<RoomSession, 'call' | 'control_token'>): Promise<void> {
    return this.client.request<void>({
      method: 'POST',
      path: `/v1/calls/${encodeURIComponent(session.call.id)}/hangup`,
      bearer: session.control_token,
      idempotencyKey: null,
    });
  }
}
