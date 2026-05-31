import type { RestClient } from '../rest-client.js';
import { ConversationMessages } from './messages.js';
import type {
  Conversation,
  ConversationCreateRequest,
  ConversationList,
  ConversationUpdateRequest,
  MemberRole,
  Membership,
  MembershipList,
  Uuid,
} from '../types.js';

/** Optional knobs accepted by every member-add call. */
export interface AddMemberOptions {
  /** Membership role — defaults to `"member"` server-side. */
  role?: MemberRole;
  /** AbortSignal for caller-driven cancellation. */
  signal?: AbortSignal;
}

/** Wraps a single conversation by id — used as the entry point for sub-resources. */
export class ConversationHandle {
  /**
   * Message ops scoped to this conversation: `list`, `send`, `markRead`.
   * Lazy: constructed on first access so an idle handle stays cheap.
   */
  public readonly messages: ConversationMessages;

  constructor(
    private readonly client: RestClient,
    public readonly id: Uuid,
  ) {
    this.messages = new ConversationMessages(this.client, this.id);
  }

  show(signal?: AbortSignal): Promise<Conversation> {
    return this.client.request<Conversation>({
      method: 'GET',
      path: `/v1/conversations/${this.id}`,
      ...(signal ? { signal } : {}),
    });
  }

  update(attrs: ConversationUpdateRequest, signal?: AbortSignal): Promise<Conversation> {
    return this.client.request<Conversation>({
      method: 'PATCH',
      path: `/v1/conversations/${this.id}`,
      body: attrs,
      ...(signal ? { signal } : {}),
    });
  }

  // ── members ────────────────────────────────────────────────────────────

  listMembers(signal?: AbortSignal): Promise<MembershipList> {
    return this.client.request<MembershipList>({
      method: 'GET',
      path: `/v1/conversations/${this.id}/members`,
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * Add multiple users to this conversation in one round-trip.
   *
   * `externalIds` are the stable customer-side identifiers you passed
   * to `POST /v1/users` when creating each user — the server resolves
   * them to internal user_ids and creates one membership row per id.
   *
   * Requires `:manage_members` on this conversation (owner or admin).
   *
   * ```ts
   * await chat.conversations.one(convId).addMembers(['alice', 'bob']);
   * ```
   */
  addMembers(externalIds: string[], opts: AddMemberOptions = {}): Promise<MembershipList> {
    return this.client.request<MembershipList>({
      method: 'POST',
      path: `/v1/conversations/${this.id}/members`,
      body: {
        external_ids: externalIds,
        ...(opts.role !== undefined ? { role: opts.role } : {}),
      },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  }

  /**
   * Add a single user. Convenience wrapper around {@link addMembers}
   * that unwraps the returned list to the single membership row.
   *
   * ```ts
   * const m = await chat.conversations.one(convId).addMember('alice');
   * ```
   */
  async addMember(externalId: string, opts: AddMemberOptions = {}): Promise<Membership> {
    const list = await this.addMembers([externalId], opts);
    const row = list.data[0];
    if (!row) {
      // Server should always return one membership per external_id;
      // empty data here means a contract violation, not a missing user
      // (the latter surfaces as a 422 user_not_found error).
      throw new Error('Poolse: addMember succeeded but server returned no membership row.');
    }
    return row;
  }

  removeMember(userId: Uuid, signal?: AbortSignal): Promise<void> {
    return this.client.request<void>({
      method: 'DELETE',
      path: `/v1/conversations/${this.id}/members/${userId}`,
      ...(signal ? { signal } : {}),
    });
  }
}

/** Top-level `/v1/conversations` collection. */
export class ConversationsResource {
  constructor(private readonly client: RestClient) {}

  list(signal?: AbortSignal): Promise<ConversationList> {
    return this.client.request<ConversationList>({
      method: 'GET',
      path: '/v1/conversations',
      ...(signal ? { signal } : {}),
    });
  }

  create(attrs: ConversationCreateRequest, signal?: AbortSignal): Promise<Conversation> {
    return this.client.request<Conversation>({
      method: 'POST',
      path: '/v1/conversations',
      body: attrs,
      ...(signal ? { signal } : {}),
    });
  }

  /** Returns a handle for further operations on a single conversation. */
  one(id: Uuid): ConversationHandle {
    return new ConversationHandle(this.client, id);
  }
}
