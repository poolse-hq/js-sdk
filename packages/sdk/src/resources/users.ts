// Customer-supplied user metadata, cached — keyed by the tenant's
// `external_id` (the same string the customer passes when minting
// JWTs or referencing users in member lists).
//
// poolse has no concept of a "user profile" — names and avatars
// live in the customer's app, not ours. `UsersResource` wraps the
// `userResolver` the customer passed into `PoolseConfig` with:
//
//   * an in-memory cache keyed by external_id
//   * concurrent-request dedup (10 bubbles asking for the same user
//     on the same tick fire ONE resolver call)
//   * subscription so React (or any other UI) can re-render when a
//     pending lookup resolves
//
// Negative results (resolver returned null, threw, or the customer
// didn't configure a resolver at all) are cached too so we don't
// retry on every mount. Customers who want to invalidate the cache
// can call `chat.users.invalidate(externalId)` after their backend's
// user data changes (or `invalidateAll()` after a sign-out / tenant
// swap).

import type { ResolvedConfig } from '../config.js';
import { agentFromWire, type AgentInfo } from '../agents.js';
import type { PoolseUserProfile } from '../types.js';

type Listener = () => void;

export class UsersResource {
  private readonly cache = new Map<string, PoolseUserProfile | null>();
  private readonly pending = new Map<string, Promise<PoolseUserProfile | null>>();
  private readonly listeners = new Map<string, Set<Listener>>();
  /** Users the server said are agents (AG1), by external id. Kept across `invalidate`. */
  private readonly agents = new Map<string, AgentInfo>();

  constructor(private readonly config: ResolvedConfig) {}

  /**
   * Get the cached value if present. Returns `undefined` to mean
   * "not in cache yet" (different from `null`, which means "resolver
   * ran and the user wasn't found").
   */
  peek(externalId: string): PoolseUserProfile | null | undefined {
    return this.cache.get(externalId);
  }

  /**
   * Resolve a user, hitting the customer's `userResolver` on cache
   * miss. Concurrent calls for the same external_id share one Promise.
   */
  async get(externalId: string): Promise<PoolseUserProfile | null> {
    if (this.cache.has(externalId)) {
      return this.cache.get(externalId) ?? null;
    }
    const existingPending = this.pending.get(externalId);
    if (existingPending) return existingPending;

    const resolver = this.config.userResolver;
    if (!resolver) {
      this.cache.set(externalId, null);
      this.notify(externalId);
      return null;
    }

    const promise = Promise.resolve()
      .then(() => resolver(externalId))
      .then(
        (profile) => {
          this.cache.set(externalId, profile ?? null);
          this.pending.delete(externalId);
          this.notify(externalId);
          return profile ?? null;
        },
        (err: unknown) => {
          // Resolver errors are treated as "user not found" — log
          // once and cache the null so we don't hammer the failing
          // endpoint on every re-render. Customers can call
          // `invalidate(externalId)` to retry.
          console.error('[poolse] userResolver failed for', externalId, err);
          this.cache.set(externalId, null);
          this.pending.delete(externalId);
          this.notify(externalId);
          return null;
        },
      );
    this.pending.set(externalId, promise);
    return promise;
  }

  /**
   * Subscribe to changes for a single external_id. The listener fires
   * when the resolver lands (or when the entry is invalidated).
   * Returns an unsubscribe.
   *
   * `useUser` in @poolse/react uses this with `useSyncExternalStore`.
   */
  subscribe(externalId: string, listener: Listener): () => void {
    let set = this.listeners.get(externalId);
    if (!set) {
      set = new Set();
      this.listeners.set(externalId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  /**
   * The agent behind `externalId`, or null for a person: what the server
   * said on a user, member or message (see `noteAgents`), else the
   * resolver's `isAgent` / `agent`. Synchronous — the UI's badge check.
   */
  agentOf(externalId: string | null | undefined): AgentInfo | null {
    if (!externalId) return null;
    const known = this.agents.get(externalId);
    if (known) return known;
    const profile = this.cache.get(externalId);
    if (profile?.agent) {
      return {
        id: profile.agent.id ?? null,
        name: profile.agent.name ?? null,
        kind: profile.agent.kind ?? null,
      };
    }
    return profile?.isAgent ? { id: null, name: null, kind: null } : null;
  }

  /** Whether `externalId` is an agent (see `agentOf`). */
  isAgent(externalId: string | null | undefined): boolean {
    return this.agentOf(externalId) !== null;
  }

  /**
   * Remember which users are agents from server rows: members
   * (`external_id`) and messages (`sender_external_id`) with
   * `is_agent` / `agent`. Subscribers of those users hear about it. The
   * hooks in @poolse/react call this for every list they load.
   */
  noteAgents(rows: ReadonlyArray<object>): void {
    for (const row of rows) {
      const agent = agentFromWire(row);
      if (!agent) continue;
      const r = row as { external_id?: unknown; sender_external_id?: unknown };
      const id =
        typeof r.sender_external_id === 'string'
          ? r.sender_external_id
          : typeof r.external_id === 'string'
            ? r.external_id
            : null;
      if (!id) continue;
      const prev = this.agents.get(id);
      // A bare `is_agent` doesn't wipe details learned before.
      const next = prev && !agent.id && !agent.name ? prev : agent;
      if (prev && prev.id === next.id && prev.name === next.name && prev.kind === next.kind) {
        continue;
      }
      this.agents.set(id, next);
      this.notify(id);
    }
  }

  /** Drop a single cached entry — next `get` re-fetches via the resolver. */
  invalidate(externalId: string): void {
    this.cache.delete(externalId);
    this.pending.delete(externalId);
    this.notify(externalId);
  }

  /**
   * Drop the entire cache. Use after a sign-out, tenant swap, or any
   * other event that invalidates every cached profile (e.g., the
   * customer just renamed every user in bulk).
   */
  invalidateAll(): void {
    this.cache.clear();
    this.pending.clear();
    for (const externalId of this.listeners.keys()) {
      this.notify(externalId);
    }
  }

  private notify(externalId: string): void {
    const set = this.listeners.get(externalId);
    if (!set) return;
    for (const l of set) l();
  }
}
