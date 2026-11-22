// Notification actions — reply to, or mark read, a conversation from a
// message notification, without a session. The push carried a reply
// grant (`reply_grant`) that names the user, device and conversation;
// it is the only credential these calls need, so they work from a
// notification handler with the app's session long gone.
//
// Grants last 24 h, may be reused, are limited to 20 actions a minute
// (429 `rate_limited`), and die with their device: once it is signed
// out the server answers 401 `device_signed_out`.

import { resolveConfig, type PoolseConfig } from './config.js';
import { RestClient } from './rest-client.js';
import { TokenCache } from './token-cache.js';
import type { Message, Uuid } from './types.js';
import {
  CALL_AGENTS_PATHS,
  escalationFromWire,
  escalationReplyBody,
  type AgentEscalation,
  type EscalationReply,
} from './call-agents.js';
import { safeUuid } from './uuid.js';

/** `POST /v1/notification-actions/reply`. */
export interface NotificationReplyRequest {
  /** The push's `reply_grant`. */
  token: string;
  /** The reply's text (trimmed server-side; empty is refused, 422). */
  text: string;
  /**
   * Client message id. Defaults to a fresh UUID; reuse it when retrying
   * so a reply that already landed comes back (200) instead of posting
   * twice.
   */
  id?: Uuid;
}

/** `POST /v1/notification-actions/read`. */
export interface NotificationReadRequest {
  /** The push's `reply_grant`. */
  token: string;
}

/**
 * `POST /v1/agent-escalations/:id/reply` with the push's token — answer
 * your agent from its notification (AG16, AGENTS_IN_CALLS.md §5).
 */
export type NotificationEscalationRequest = EscalationReply & {
  /** The push's `escalation_id`. */
  escalationId: string;
  /** The push's `reply_token`: this escalation only, until `expires_at`, once. */
  token: string;
};

/** An action a message notification offers (`MessagePushData.actions`). */
export type NotificationActionId = 'reply' | 'mark_read';

/**
 * The data of a new-message push (Android: the FCM data message; iOS:
 * the keys beside `aps`). FCM delivers every value as a string, so
 * numeric fields may arrive as either.
 */
export interface MessagePushData {
  cv: string;
  type: 'message';
  event: 'new';
  message_id: Uuid;
  conversation_id: Uuid;
  conversation_name: string;
  /** `"1"` for a group conversation. */
  group: '0' | '1';
  sender_user_id: string;
  sender_external_id: string;
  sender_name: string;
  /** The message text, or "New message" when the workspace hides previews. */
  text: string;
  /** `"1"` when the message mentions the recipient. */
  mentioned: '0' | '1';
  /** Unix milliseconds. */
  sent_at: number | string;
  /** The badge: unread messages across conversations, by each one's notify level and mute. */
  unread_total: number | string;
  /** Grant for {@link NotificationActions}; empty when none could be minted. */
  reply_grant: string;
  /** Comma-separated {@link NotificationActionId}s (`"reply,mark_read"`), empty without a grant. */
  actions: string;
  /** `"1"`: show a plain "New message" with nothing identifying. */
  private?: '1';
  /** The tenant (workspace) the push is from — route a tap to that workspace's client. */
  tenant_id?: Uuid;
  /** The workspace's name for the notification ("Acme"); `""` until set. */
  workspace_name?: string;
  /** The workspace's icon URL; `""` until set. */
  workspace_icon_url?: string;
}

/**
 * Read sync: the user read the conversation somewhere — drop its
 * notifications and set the badge. iOS sends it as a background push
 * with `type: "message_read"`.
 */
export interface MessageReadPushData {
  cv: string;
  type: 'message' | 'message_read';
  event: 'read';
  conversation_id: Uuid;
  unread_total: number | string;
  /** The tenant (workspace) the push is from — route a tap to that workspace's client. */
  tenant_id?: Uuid;
  /** The workspace's name for the notification ("Acme"); `""` until set. */
  workspace_name?: string;
  /** The workspace's icon URL; `""` until set. */
  workspace_icon_url?: string;
}

/** The actions a push's `actions` field lists (unknown names dropped). */
export function parseNotificationActions(
  actions: string | null | undefined,
): NotificationActionId[] {
  if (!actions) return [];
  return actions
    .split(',')
    .map((a) => a.trim())
    .filter((a): a is NotificationActionId => a === 'reply' || a === 'mark_read');
}

/**
 * Reply / mark read from a notification. Available as
 * `poolse.notificationActions`, or — with no session at all, e.g. in a
 * background notification handler — from
 * {@link createNotificationActions}.
 */
export class NotificationActions {
  constructor(private readonly client: RestClient) {}

  /**
   * Post `text` into the grant's conversation as the grant's user, then
   * mark the conversation read. Resolves the message (also on a retry
   * with the same `id`).
   */
  reply(req: NotificationReplyRequest, signal?: AbortSignal): Promise<Message> {
    const id = req.id ?? safeUuid();
    return this.client.request<Message>({
      method: 'POST',
      path: '/v1/notification-actions/reply',
      body: { text: req.text, id },
      bearer: req.token,
      // Retries of this request are retries of this reply.
      idempotencyKey: id,
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * Answer an agent's escalation with the push's token in the body — no
   * session needed, so it works from a notification handler (the native
   * core does this itself on the lock screen). Errors: 401
   * `invalid_token`, 409 `not_pending`, 410 `expired`, 422 a bad answer.
   */
  async escalation(
    req: NotificationEscalationRequest,
    signal?: AbortSignal,
  ): Promise<AgentEscalation | null> {
    const reply: EscalationReply =
      'answer' in req ? { answer: req.answer } : { decision: req.decision };
    const res = await this.client.request<unknown>({
      method: 'POST',
      path: CALL_AGENTS_PATHS.escalationReply(req.escalationId),
      body: escalationReplyBody(reply, req.token),
      // The token works once: never resent behind the user's back.
      maxRetries: 0,
      ...(signal ? { signal } : {}),
    });
    return escalationFromWire(res);
  }

  /** Mark the grant's conversation read up to its newest message. */
  read(req: NotificationReadRequest, signal?: AbortSignal): Promise<void> {
    return this.client.request<void>({
      method: 'POST',
      path: '/v1/notification-actions/read',
      body: {},
      bearer: req.token,
      ...(signal ? { signal } : {}),
    });
  }
}

/** Options for {@link createNotificationActions}: where the API is, and how to reach it. */
export type NotificationActionsOptions = Pick<
  PoolseConfig,
  'apiUrl' | 'fetch' | 'maxRetries' | 'baseBackoffMs' | 'maxBackoffMs' | 'generateIdempotencyKey'
>;

/**
 * Notification actions without a `Poolse` instance or session — only
 * the API URL and the push's grant.
 *
 * ```ts
 * const actions = createNotificationActions({ apiUrl: 'https://api.example.com' });
 * await actions.reply({ token: data.reply_grant, text: 'On my way' });
 * await actions.read({ token: data.reply_grant });
 * ```
 */
export function createNotificationActions(
  opts: NotificationActionsOptions = {},
): NotificationActions {
  // Every request presents its grant as the bearer; there is no session.
  const config = resolveConfig({ ...opts, getToken: () => null });
  return new NotificationActions(new RestClient(config, new TokenCache(config.getToken)));
}
