import { ApiError } from '../errors.js';
import type { RestClient } from '../rest-client.js';

/** A member as a live call names them. */
export interface LiveCallMember {
  user_id: string;
  external_id: string | null;
  display_name: string | null;
}

/**
 * The call running on a conversation right now (CALL_CONTRACT.md §4.2's
 * CallSummary). `participants` is who is in the room at this moment.
 */
export interface LiveCall {
  id: string;
  conversation_id: string;
  conversation_name: string | null;
  media: 'audio' | 'video';
  /** `room` rang nobody (a drop-in meeting); `call` rang the members. Absent on older servers: call. */
  kind?: 'call' | 'room';
  state: 'live' | 'finished';
  started_by: LiveCallMember;
  started_at: string | null;
  ended_at: string | null;
  participants: LiveCallMember[];
  /**
   * Callee user id → `ringing` (their ring is out right now) | `answered`
   * | `declined` | `missed` (rang out unanswered).
   */
  ring_states: Record<string, 'ringing' | 'answered' | 'declined' | 'missed'>;
  /** The workspace's call limits (dashboard → Calls). False: hide the camera button. */
  video_allowed?: boolean;
  /** How many people the call holds; one more joining is refused with `call_full`. */
  max_participants?: number;
}

/**
 * `/v1/conversations/:id/call` — whether a call is running on a
 * conversation, for a "Call in progress · Join" banner. Live changes
 * arrive on the conversation channel (`onCallStarted`,
 * `onCallParticipants`, `onCallFinished`); this is the read on open.
 */
export class LiveCallsResource {
  constructor(private readonly client: RestClient) {}

  /** GET /v1/conversations/:conversationId/call — `null` when no call is live. */
  async get(conversationId: string, signal?: AbortSignal): Promise<LiveCall | null> {
    try {
      const res = await this.client.request<{ cv: number; call: LiveCall }>({
        method: 'GET',
        path: `/v1/conversations/${encodeURIComponent(conversationId)}/call`,
        ...(signal ? { signal } : {}),
      });
      return res.call.state === 'live' ? res.call : null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404 && err.code === 'no_live_call') return null;
      throw err;
    }
  }
}
