import type { RestClient } from '../rest-client.js';
import type {
  Message,
  MessageCreateRequest,
  MessageList,
  MessageUpdateRequest,
  ReactionRequest,
  Uuid,
} from '../types.js';

/** Per-conversation message collection: send, list, mark-read. */
export class ConversationMessages {
  constructor(
    private readonly client: RestClient,
    private readonly conversationId: Uuid,
  ) {}

  list(opts: { limit?: number; before?: number } = {}, signal?: AbortSignal): Promise<MessageList> {
    return this.client.request<MessageList>({
      method: 'GET',
      path: `/v1/conversations/${this.conversationId}/messages`,
      query: {
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        ...(opts.before !== undefined ? { before: opts.before } : {}),
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
}

/** Per-message operations: edit, delete, react, list replies. */
export class MessageHandle {
  constructor(
    private readonly client: RestClient,
    public readonly id: Uuid,
  ) {}

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

  replies(
    opts: { limit?: number; after?: number } = {},
    signal?: AbortSignal,
  ): Promise<MessageList> {
    return this.client.request<MessageList>({
      method: 'GET',
      path: `/v1/messages/${this.id}/replies`,
      query: {
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        ...(opts.after !== undefined ? { after: opts.after } : {}),
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

  removeReaction(emoji: string, signal?: AbortSignal): Promise<Message> {
    return this.client.request<Message>({
      method: 'DELETE',
      path: `/v1/messages/${this.id}/reactions/${encodeURIComponent(emoji)}`,
      ...(signal ? { signal } : {}),
    });
  }
}

/** Top-level `/v1/messages` namespace — accessed via `chat.messages(id)`. */
export class MessagesResource {
  constructor(private readonly client: RestClient) {}

  one(id: Uuid): MessageHandle {
    return new MessageHandle(this.client, id);
  }
}

/**
 * Client-side message id generator. Uses `globalThis.crypto.randomUUID()`
 * when available (browsers in secure contexts, Node 19+, RN 0.74+).
 * In runtimes without it (older RN, sandboxed workers) the caller
 * should generate ids themselves and pass via `attrs.id` — failing
 * loud here is better than silently shipping non-unique ids that
 * would cause server-side dedup collisions across users.
 */
function generateClientMessageId(): Uuid {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  throw new Error(
    'Poolse: globalThis.crypto.randomUUID() unavailable — pass `id` ' +
      'explicitly in MessageCreateRequest (your env lacks a built-in UUID generator).',
  );
}
