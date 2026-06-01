// Customer-supplied user metadata, cached.
//
// poolse has no concept of a "user profile" — names and avatars
// live in the customer's app, not ours. `UsersResource` wraps the
// `userResolver` the customer passed into `PoolseConfig` with:
//
//   * an in-memory cache keyed by user_id
//   * concurrent-request dedup (10 bubbles asking for the same user
//     on the same tick fire ONE resolver call)
//   * subscription so React (or any other UI) can re-render when a
//     pending lookup resolves
//
// Negative results (resolver returned null, threw, or the customer
// didn't configure a resolver at all) are cached too so we don't
// retry on every mount. Customers who want to invalidate the cache
// can call `chat.users.invalidate(userId)` after their backend's
// user data changes (or `invalidateAll()` after a sign-out / tenant
// swap).

import type { ResolvedConfig } from '../config.js';
import type { PoolseUserProfile } from '../types.js';

type Listener = () => void;

export class UsersResource {
  private readonly cache = new Map<string, PoolseUserProfile | null>();
  private readonly pending = new Map<string, Promise<PoolseUserProfile | null>>();
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(private readonly config: ResolvedConfig) {}

  /**
   * Get the cached value if present. Returns `undefined` to mean
   * "not in cache yet" (different from `null`, which means "resolver
   * ran and the user wasn't found").
   */
  peek(userId: string): PoolseUserProfile | null | undefined {
    return this.cache.get(userId);
  }

  /**
   * Resolve a user, hitting the customer's `userResolver` on cache
   * miss. Concurrent calls for the same id share one Promise.
   */
  async get(userId: string): Promise<PoolseUserProfile | null> {
    if (this.cache.has(userId)) {
      return this.cache.get(userId) ?? null;
    }
    const existingPending = this.pending.get(userId);
    if (existingPending) return existingPending;

    const resolver = this.config.userResolver;
    if (!resolver) {
      this.cache.set(userId, null);
      this.notify(userId);
      return null;
    }

    const promise = Promise.resolve()
      .then(() => resolver(userId))
      .then(
        (profile) => {
          this.cache.set(userId, profile ?? null);
          this.pending.delete(userId);
          this.notify(userId);
          return profile ?? null;
        },
        (err: unknown) => {
          // Resolver errors are treated as "user not found" — log
          // once and cache the null so we don't hammer the failing
          // endpoint on every re-render. Customers can call
          // `invalidate(userId)` to retry.
          console.error('[poolse] userResolver failed for', userId, err);
          this.cache.set(userId, null);
          this.pending.delete(userId);
          this.notify(userId);
          return null;
        },
      );
    this.pending.set(userId, promise);
    return promise;
  }

  /**
   * Subscribe to changes for a single user id. The listener fires
   * when the resolver lands (or when the entry is invalidated).
   * Returns an unsubscribe.
   *
   * `useUser` in @poolse/react uses this with `useSyncExternalStore`.
   */
  subscribe(userId: string, listener: Listener): () => void {
    let set = this.listeners.get(userId);
    if (!set) {
      set = new Set();
      this.listeners.set(userId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  /** Drop a single cached entry — next `get` re-fetches via the resolver. */
  invalidate(userId: string): void {
    this.cache.delete(userId);
    this.pending.delete(userId);
    this.notify(userId);
  }

  /**
   * Drop the entire cache. Use after a sign-out, tenant swap, or any
   * other event that invalidates every cached profile (e.g., the
   * customer just renamed every user in bulk).
   */
  invalidateAll(): void {
    this.cache.clear();
    this.pending.clear();
    for (const userId of this.listeners.keys()) {
      this.notify(userId);
    }
  }

  private notify(userId: string): void {
    const set = this.listeners.get(userId);
    if (!set) return;
    for (const l of set) l();
  }
}
