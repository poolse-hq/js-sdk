import { AI_REQUEST_TIMEOUT_MS } from '../config.js';
import type { RestClient } from '../rest-client.js';
import type {
  IncludeDeletedOption,
  Message,
  MessageCreateRequest,
  MessageEditList,
  MessageList,
  MessageUpdateRequest,
  ReactionRequest,
  Uuid,
} from '../types.js';
import { safeUuid } from '../uuid.js';
import type {
  AttachmentListOptions,
  AttachmentPage,
  BlockActionRequest,
  CatchUp,
  CatchUpRequest,
  ForwardRequest,
  MessageTranslation,
  PollState,
  ScheduleMessageRequest,
  ScheduledMessage,
  ScheduledMessageStatus,
  ScheduledMessageUpdate,
  ThreadFollowState,
} from '../messaging-plus.js';

/** Per-conversation message collection: send, list, mark-read. */
export class ConversationMessages {
  constructor(
    private readonly client: RestClient,
    private readonly conversationId: Uuid,
  ) {}

  /**
   * History, newest first. `before` is a sequence; `include_deleted`
   * returns every deleted message as a tombstone.
   */
  list(
    opts: { limit?: number; before?: number } & IncludeDeletedOption = {},
    signal?: AbortSignal,
  ): Promise<MessageList> {
    return this.client.request<MessageList>({
      method: 'GET',
      path: `/v1/conversations/${this.conversationId}/messages`,
      query: {
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        ...(opts.before !== undefined ? { before: opts.before } : {}),
        ...(opts.include_deleted ? { include_deleted: true } : {}),
      },
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * Send a message to this conversation.
   *
   * If `attrs.id` is omitted the SDK generates a v4 UUID and uses it
   * as both the wire-level idempotency key AND the literal message.id
   * the server stores. Two side-effects that make a real-time UI
   * trivial:
   *
   *   * Resending the same `id` (e.g. a network-retry) returns the
   *     ORIGINAL message instead of inserting a duplicate.
   *   * The realtime `message:new` broadcast carries this same id,
   *     so an optimistic UI can pre-render the row under the final id
   *     and dedup by id alone — no client/server id swap needed.
   *
   * Pass an explicit `attrs.id` only when you generated it yourself
   * upstream (e.g. you already render an optimistic row in your hook
   * and want the server to confirm under the same key).
   */
  send(attrs: MessageCreateRequest, signal?: AbortSignal): Promise<Message> {
    const body: MessageCreateRequest =
      attrs.id !== undefined ? attrs : { ...attrs, id: generateClientMessageId() };
    return this.client.request<Message>({
      method: 'POST',
      path: `/v1/conversations/${this.conversationId}/messages`,
      body,
      ...(signal ? { signal } : {}),
    });
  }

  markRead(messageId: Uuid, signal?: AbortSignal): Promise<void> {
    return this.client.request<void>({
      method: 'POST',
      path: `/v1/conversations/${this.conversationId}/read`,
      body: { message_id: messageId },
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * `POST …/scheduled-messages` (MS1): send `body` at `send_at`. Text
   * only; checked now as a send would be (word filter, DLP — 422
   * `dlp_warning` / `dlp_blocked`). 422 `too_many_scheduled` over 100.
   */
  schedule(attrs: ScheduleMessageRequest, signal?: AbortSignal): Promise<ScheduledMessage> {
    return this.client.request<ScheduledMessage>({
      method: 'POST',
      path: `/v1/conversations/${this.conversationId}/scheduled-messages`,
      body: attrs,
      ...(signal ? { signal } : {}),
    });
  }

  /** `GET …/pins` (MS13): pinned messages, newest pin first. */
  async pins(signal?: AbortSignal): Promise<Message[]> {
    const res = await this.client.request<{ data: Message[] }>({
      method: 'GET',
      path: `/v1/conversations/${this.conversationId}/pins`,
      ...(signal ? { signal } : {}),
    });
    return res.data;
  }

  /**
   * `POST …/catch-up` (MS20): "what did I miss" since `since` (default:
   * your read position). 503 `no_model`, 502 `model_failed`, 10/min.
   */
  catchUp(opts: CatchUpRequest = {}, signal?: AbortSignal): Promise<CatchUp> {
    return this.client.request<CatchUp>({
      method: 'POST',
      path: `/v1/conversations/${this.conversationId}/catch-up`,
      body: opts,
      minTimeoutMs: AI_REQUEST_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
    });
  }

  /** `GET …/attachments` (MS18): the conversation's files, newest first, newest version of each. */
  files(opts: AttachmentListOptions = {}, signal?: AbortSignal): Promise<AttachmentPage> {
    return this.client.request<AttachmentPage>({
      method: 'GET',
      path: `/v1/conversations/${this.conversationId}/attachments`,
      query: {
        ...(opts.kind ? { kind: opts.kind } : {}),
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        ...(opts.before ? { before: opts.before } : {}),
      },
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * "Mark as unread": `messageId` and everything after it count as unread
   * again. The caller's devices get `conversation:read` with the new
   * counts; other members' read receipts don't move.
   */
  markUnread(messageId: Uuid, signal?: AbortSignal): Promise<void> {
    return this.client.request<void>({
      method: 'POST',
      path: `/v1/conversations/${this.conversationId}/unread`,
      body: { message_id: messageId },
      ...(signal ? { signal } : {}),
    });
  }
}

/** Per-message operations: read, edit, delete, react, list replies. */
export class MessageHandle {
  constructor(
    private readonly client: RestClient,
    public readonly id: Uuid,
  ) {}

  /**
   * `GET /v1/messages/:id` — one message with its thread summary and
   * quote. A deleted message comes back as its tombstone
   * (`deleted_at` set, `body: null`). 403 for non-members, 404.
   */
  get(signal?: AbortSignal): Promise<Message> {
    return this.client.request<Message>({
      method: 'GET',
      path: `/v1/messages/${this.id}`,
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * `GET /v1/messages/:id/edits` — earlier versions of an edited
   * message, oldest first (version 1 is the original). Sender and
   * conversation owners/admins only (403 otherwise).
   */
  edits(signal?: AbortSignal): Promise<MessageEditList> {
    return this.client.request<MessageEditList>({
      method: 'GET',
      path: `/v1/messages/${this.id}/edits`,
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * `PATCH /v1/messages/:id` — edit `body` and/or drop link previews
   * (`remove_link_previews: [url, …]` or `true` for all). Sender only;
   * 409 `message_deleted` on a tombstone.
   */
  update(attrs: MessageUpdateRequest, signal?: AbortSignal): Promise<Message> {
    return this.client.request<Message>({
      method: 'PATCH',
      path: `/v1/messages/${this.id}`,
      body: attrs,
      ...(signal ? { signal } : {}),
    });
  }

  delete(signal?: AbortSignal): Promise<void> {
    return this.client.request<void>({
      method: 'DELETE',
      path: `/v1/messages/${this.id}`,
      ...(signal ? { signal } : {}),
    });
  }

  /** Thread replies, oldest first; `include_deleted` adds tombstones. */
  replies(
    opts: { limit?: number; after?: number } & IncludeDeletedOption = {},
    signal?: AbortSignal,
  ): Promise<MessageList> {
    return this.client.request<MessageList>({
      method: 'GET',
      path: `/v1/messages/${this.id}/replies`,
      query: {
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        ...(opts.after !== undefined ? { after: opts.after } : {}),
        ...(opts.include_deleted ? { include_deleted: true } : {}),
      },
      ...(signal ? { signal } : {}),
    });
  }

  addReaction(emoji: string, signal?: AbortSignal): Promise<Message> {
    const body: ReactionRequest = { emoji };
    return this.client.request<Message>({
      method: 'POST',
      path: `/v1/messages/${this.id}/reactions`,
      body,
      ...(signal ? { signal } : {}),
    });
  }

  /** `GET /v1/messages/:id/poll` (MS3). */
  poll(signal?: AbortSignal): Promise<PollState> {
    return this.client.request<PollState>({
      method: 'GET',
      path: `/v1/messages/${this.id}/poll`,
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * `PUT /v1/messages/:id/poll/votes`: replace your votes (`[]` takes
   * them back). 409 `poll_closed`, 422 `single_choice` / `invalid_option`.
   */
  vote(optionIds: string[], signal?: AbortSignal): Promise<PollState> {
    return this.client.request<PollState>({
      method: 'PUT',
      path: `/v1/messages/${this.id}/poll/votes`,
      body: { option_ids: optionIds },
      ...(signal ? { signal } : {}),
    });
  }

  /** `POST /v1/messages/:id/poll/close` — the poll's sender or an owner/admin. */
  closePoll(signal?: AbortSignal): Promise<PollState> {
    return this.client.request<PollState>({
      method: 'POST',
      path: `/v1/messages/${this.id}/poll/close`,
      ...(signal ? { signal } : {}),
    });
  }

  /** `POST /v1/messages/:id/pin` (MS13); idempotent. 422 `too_many_pins` over 100. */
  pin(signal?: AbortSignal): Promise<Message> {
    return this.client.request<Message>({
      method: 'POST',
      path: `/v1/messages/${this.id}/pin`,
      ...(signal ? { signal } : {}),
    });
  }

  /** `DELETE /v1/messages/:id/pin`; idempotent. */
  unpin(signal?: AbortSignal): Promise<Message> {
    return this.client.request<Message>({
      method: 'DELETE',
      path: `/v1/messages/${this.id}/pin`,
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * `POST /v1/messages/:id/forward` (MS13) to 1–10 conversations; one new
   * message per target, in order. 422 `cannot_forward` (polls, blocks,
   * system, deleted), 403 when any target refuses.
   */
  async forward(req: ForwardRequest, signal?: AbortSignal): Promise<Message[]> {
    const res = await this.client.request<{ data: Message[] }>({
      method: 'POST',
      path: `/v1/messages/${this.id}/forward`,
      body: req,
      ...(signal ? { signal } : {}),
    });
    return res.data;
  }

  /** `GET /v1/messages/:id/follow` (MS19) — `:id` may be the root or any reply. */
  followState(signal?: AbortSignal): Promise<ThreadFollowState> {
    return this.client.request<ThreadFollowState>({
      method: 'GET',
      path: `/v1/messages/${this.id}/follow`,
      ...(signal ? { signal } : {}),
    });
  }

  /** Follow (`true`) or unfollow the thread: who gets a push for its replies. */
  setFollow(following: boolean, signal?: AbortSignal): Promise<ThreadFollowState> {
    return this.client.request<ThreadFollowState>({
      method: following ? 'PUT' : 'DELETE',
      path: `/v1/messages/${this.id}/follow`,
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * `POST /v1/messages/:id/translate` (MS21) into `language` (BCP 47),
   * cached per message. 422 `nothing_to_translate`, 503 `no_model`.
   */
  translate(language: string, signal?: AbortSignal): Promise<MessageTranslation> {
    return this.client.request<MessageTranslation>({
      method: 'POST',
      path: `/v1/messages/${this.id}/translate`,
      body: { language },
      minTimeoutMs: AI_REQUEST_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * `POST /v1/messages/:id/actions` (IN4): a button, a select's value, or
   * a form's `values` with a `submit` button. 202; the app answers by
   * editing the message (`message:updated`).
   */
  action(req: BlockActionRequest, signal?: AbortSignal): Promise<{ action_event_id: Uuid }> {
    return this.client.request<{ action_event_id: Uuid }>({
      method: 'POST',
      path: `/v1/messages/${this.id}/actions`,
      body: req,
      ...(signal ? { signal } : {}),
    });
  }

  removeReaction(emoji: string, signal?: AbortSignal): Promise<Message> {
    return this.client.request<Message>({
      method: 'DELETE',
      path: `/v1/messages/${this.id}/reactions/${encodeURIComponent(emoji)}`,
      ...(signal ? { signal } : {}),
    });
  }
}

/** Top-level `/v1/messages` namespace — `chat.messages.one(id)`, or the shortcuts below. */
export class MessagesResource {
  constructor(private readonly client: RestClient) {}

  one(id: Uuid): MessageHandle {
    return new MessageHandle(this.client, id);
  }

  /** Shortcut for `one(id).get()`. */
  get(id: Uuid, signal?: AbortSignal): Promise<Message> {
    return this.one(id).get(signal);
  }

  /** Shortcut for `one(id).edits()`. */
  edits(id: Uuid, signal?: AbortSignal): Promise<MessageEditList> {
    return this.one(id).edits(signal);
  }

  /**
   * Shortcut for `one(id).update(attrs)`.
   *
   * ```ts
   * await chat.messages.update(id, { remove_link_previews: true });
   * ```
   */
  update(id: Uuid, attrs: MessageUpdateRequest, signal?: AbortSignal): Promise<Message> {
    return this.one(id).update(attrs, signal);
  }
}

/**
 * Client-side message id generator. Delegates to the SDK's `safeUuid`
 * which works in every supported runtime (browsers, Node ≥ 19, RN /
 * Hermes — with or without a crypto polyfill). Server enforces real
 * auth + dedup; in-process collisions are effectively impossible at
 * any practical message volume.
 */
function generateClientMessageId(): Uuid {
  return safeUuid();
}

/** `/v1/scheduled-messages` — your own scheduled messages (MS1). */
export class ScheduledMessagesResource {
  constructor(private readonly client: RestClient) {}

  /** Soonest first. `status` defaults to `scheduled`. */
  async list(
    opts: { conversation_id?: Uuid; status?: ScheduledMessageStatus | 'all' } = {},
    signal?: AbortSignal,
  ): Promise<ScheduledMessage[]> {
    const res = await this.client.request<{ data: ScheduledMessage[] }>({
      method: 'GET',
      path: '/v1/scheduled-messages',
      query: {
        ...(opts.conversation_id ? { conversation_id: opts.conversation_id } : {}),
        ...(opts.status ? { status: opts.status } : {}),
      },
      ...(signal ? { signal } : {}),
    });
    return res.data;
  }

  /** Change the text or time while it is still scheduled (409 `not_scheduled` after). */
  update(id: Uuid, attrs: ScheduledMessageUpdate, signal?: AbortSignal): Promise<ScheduledMessage> {
    return this.client.request<ScheduledMessage>({
      method: 'PATCH',
      path: `/v1/scheduled-messages/${encodeURIComponent(id)}`,
      body: attrs,
      ...(signal ? { signal } : {}),
    });
  }

  /** Cancel: removes it. */
  cancel(id: Uuid, signal?: AbortSignal): Promise<void> {
    return this.client.request<void>({
      method: 'DELETE',
      path: `/v1/scheduled-messages/${encodeURIComponent(id)}`,
      ...(signal ? { signal } : {}),
    });
  }

  /** Send it now; the message keeps the scheduled id. */
  sendNow(id: Uuid, signal?: AbortSignal): Promise<Message> {
    return this.client.request<Message>({
      method: 'POST',
      path: `/v1/scheduled-messages/${encodeURIComponent(id)}/send`,
      ...(signal ? { signal } : {}),
    });
  }
}
