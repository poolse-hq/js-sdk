// The outbox: messages this client sent that haven't reached the server.
//
// A send made offline (or that fails on the network) is kept, under the
// message id the client generated, and sent again — same id, so the
// server stores it once — when the socket reconnects, the browser comes
// back online, or a backoff timer fires. A send the server refuses
// (4xx) stays as `failed` until the app retries or removes it, so it
// never silently disappears. With `config.storage` the outbox survives
// a restart.

import { ApiError, AuthError, PoolseError } from './errors.js';
import type { PoolseRealtime } from './realtime/realtime.js';
import type { Unsubscribe } from './realtime/types.js';
import type { ScopedStorage } from './storage.js';
import type { LocalMessageStatus, Message, MessageCreateRequest, Uuid } from './types.js';

export interface OutboxEntry {
  /** The message id (client-generated; the server keeps it). */
  id: Uuid;
  conversationId: Uuid;
  /** What goes to `POST /v1/conversations/:id/messages`, `id` included. */
  request: MessageCreateRequest & { id: Uuid };
  /** The row to show meanwhile, with `local_status` / `local_error`. */
  message: Message;
  status: LocalMessageStatus;
  /** Sends tried so far. */
  attempts: number;
  /** Why the last attempt failed, for display; null when it hasn't. */
  error: string | null;
  /** The server's error code when it refused (`ApiError.code`). */
  errorCode: string | null;
  /** `Date.now()` when it was first sent. */
  createdAt: number;
}

/**
 * The send couldn't reach the server and is waiting in the outbox; it
 * goes out by itself on reconnect. Not a failure to show — the row
 * stays in the list as `local_status: 'queued'`.
 */
export class MessageQueuedError extends PoolseError {
  public override readonly name: string = 'MessageQueuedError';
  public readonly code = 'queued' as const;
  public override readonly cause: unknown;

  constructor(
    public readonly messageId: Uuid,
    cause?: unknown,
  ) {
    super('Offline: the message is queued and will be sent on reconnect.');
    this.cause = cause;
  }
}

/** The message was removed from the outbox before it was sent. */
export class MessageDiscardedError extends PoolseError {
  public override readonly name: string = 'MessageDiscardedError';

  constructor(public readonly messageId: Uuid) {
    super('The unsent message was removed.');
  }
}

interface OutboxDeps {
  send: (conversationId: Uuid, request: MessageCreateRequest & { id: Uuid }) => Promise<Message>;
  scope: () => Promise<ScopedStorage | null>;
  realtime: PoolseRealtime;
  /** Whether the client is in the background (no timer retries then). */
  isBackground: () => boolean;
}

interface Waiter {
  resolve: (m: Message) => void;
  reject: (err: unknown) => void;
}

const STORAGE_KEY = 'outbox';
const MIN_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

export class Outbox {
  private items: OutboxEntry[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly sentListeners = new Set<(entry: OutboxEntry, message: Message) => void>();
  private readonly waiters = new Map<Uuid, Waiter[]>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private backoffStep = 0;
  private flushing: Promise<void> | null = null;
  private hydrated: Promise<void> | null = null;
  private destroyed = false;
  private persistChain: Promise<void> = Promise.resolve();
  private readonly offStatus: Unsubscribe;
  private readonly offOnline: () => void;

  constructor(private readonly deps: OutboxDeps) {
    this.offStatus = deps.realtime.onStatus((s) => {
      if (s === 'connected') void this.flush();
    });
    const g = globalThis as {
      addEventListener?: (t: string, fn: () => void) => void;
      removeEventListener?: (t: string, fn: () => void) => void;
    };
    const onOnline = () => void this.flush();
    if (typeof g.addEventListener === 'function') g.addEventListener('online', onOnline);
    this.offOnline = () => g.removeEventListener?.('online', onOnline);
  }

  /** Unsent messages, oldest first — of one conversation, or all. */
  entries(conversationId?: Uuid): OutboxEntry[] {
    return conversationId
      ? this.items.filter((e) => e.conversationId === conversationId)
      : this.items;
  }

  /** Called whenever an entry is added, changes status or leaves. */
  subscribe(fn: () => void): Unsubscribe {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Called when a queued or retried message reaches the server. */
  onSent(fn: (entry: OutboxEntry, message: Message) => void): Unsubscribe {
    this.sentListeners.add(fn);
    return () => {
      this.sentListeners.delete(fn);
    };
  }

  /**
   * Send through the outbox. Resolves with the server's message.
   * Rejects with {@link MessageQueuedError} when it couldn't reach the
   * server (it stays queued and goes out later — `whenSent(id)` resolves
   * then), or with the server's error when it was refused (it stays as
   * `failed`).
   */
  async send(
    conversationId: Uuid,
    request: MessageCreateRequest & { id: Uuid },
    optimistic: Message,
  ): Promise<Message> {
    await this.hydrate();
    const existing = this.items.find((e) => e.id === request.id);
    if (existing) return this.retry(existing.id);
    const entry: OutboxEntry = {
      id: request.id,
      conversationId,
      request,
      message: { ...optimistic, local_status: 'sending' },
      status: 'sending',
      attempts: 0,
      error: null,
      errorCode: null,
      createdAt: Date.now(),
    };
    this.items = [...this.items, entry];
    this.changed();
    if (isOffline()) {
      this.patch(entry.id, { status: 'queued', error: 'Offline' });
      this.schedule();
      throw new MessageQueuedError(entry.id);
    }
    return this.attempt(entry.id);
  }

  /** Resolves once the message reaches the server; rejects when it's removed or refused. */
  whenSent(id: Uuid): Promise<Message> {
    return new Promise<Message>((resolve, reject) => {
      if (!this.items.some((e) => e.id === id)) {
        reject(new MessageDiscardedError(id));
        return;
      }
      const list = this.waiters.get(id) ?? [];
      list.push({ resolve, reject });
      this.waiters.set(id, list);
    });
  }

  /** Send a queued or failed message again, now. */
  retry(id: Uuid): Promise<Message> {
    const entry = this.items.find((e) => e.id === id);
    if (!entry) return Promise.reject(new MessageDiscardedError(id));
    if (entry.status === 'sending') return this.whenSent(id);
    return this.attempt(id);
  }

  /** Drop an unsent message (the "Delete" on a failed row). */
  remove(id: Uuid): void {
    if (!this.items.some((e) => e.id === id)) return;
    this.items = this.items.filter((e) => e.id !== id);
    this.settle(id, null, new MessageDiscardedError(id));
    this.changed();
  }

  /** Send every queued message now (oldest first). Failed ones wait for `retry`. */
  flush(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    if (this.flushing) return this.flushing;
    const run = (async () => {
      await this.hydrate();
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      for (const entry of [...this.items]) {
        if (this.destroyed) return;
        const current = this.items.find((e) => e.id === entry.id);
        if (!current || current.status !== 'queued') continue;
        try {
          await this.attempt(current.id);
        } catch (err) {
          // Still offline: stop here and try again later, in order.
          if (err instanceof MessageQueuedError) return;
        }
      }
      this.backoffStep = 0;
    })().finally(() => {
      if (this.flushing === run) this.flushing = null;
    });
    this.flushing = run;
    return run;
  }

  /**
   * Load the stored outbox (once the client's namespace is known).
   * Entries left `sending` by a closed app become `queued`.
   *
   * @internal
   */
  hydrate(): Promise<void> {
    this.hydrated ??= (async () => {
      const scope = await this.deps.scope();
      if (!scope || this.destroyed) return;
      const stored = await scope.getJson<OutboxEntry[]>(STORAGE_KEY);
      if (!Array.isArray(stored) || stored.length === 0) return;
      const have = new Set(this.items.map((e) => e.id));
      const loaded = stored
        .filter((e) => e && typeof e.id === 'string' && !have.has(e.id))
        .map((e): OutboxEntry => {
          const status: LocalMessageStatus = e.status === 'failed' ? 'failed' : 'queued';
          return { ...e, status, message: { ...e.message, local_status: status } };
        });
      if (loaded.length === 0) return;
      this.items = [...loaded, ...this.items].sort((a, b) => a.createdAt - b.createdAt);
      this.changed();
      this.schedule(0);
    })();
    return this.hydrated;
  }

  /** Drop every entry (sign-out). Pending `send` / `whenSent` reject. @internal */
  async _clear(): Promise<void> {
    const ids = this.items.map((e) => e.id);
    this.items = [];
    for (const id of ids) this.settle(id, null, new MessageDiscardedError(id));
    const scope = await this.deps.scope();
    await scope?.remove(STORAGE_KEY);
  }

  /** @internal */
  _destroy(): void {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.offStatus();
    this.offOnline();
    this.listeners.clear();
    this.sentListeners.clear();
    for (const [id, list] of this.waiters) {
      for (const w of list) w.reject(new MessageDiscardedError(id));
    }
    this.waiters.clear();
  }

  private async attempt(id: Uuid): Promise<Message> {
    const entry = this.items.find((e) => e.id === id);
    if (!entry) throw new MessageDiscardedError(id);
    this.patch(id, {
      status: 'sending',
      attempts: entry.attempts + 1,
      error: null,
      errorCode: null,
    });
    try {
      const sent = await this.deps.send(entry.conversationId, entry.request);
      const still = this.items.find((e) => e.id === id);
      if (still) {
        this.items = this.items.filter((e) => e.id !== id);
        this.changed();
        for (const fn of this.sentListeners) fn(still, sent);
      }
      this.settle(id, sent, null);
      return sent;
    } catch (err) {
      if (!this.items.some((e) => e.id === id)) throw err;
      if (isRetryable(err)) {
        this.patch(id, { status: 'queued', error: describe(err), errorCode: null });
        this.schedule();
        throw new MessageQueuedError(id, err);
      }
      this.patch(id, {
        status: 'failed',
        error: describe(err),
        errorCode: err instanceof ApiError ? err.code : null,
      });
      // A failed message is settled for whoever awaited delivery.
      this.settle(id, null, err);
      throw err;
    }
  }

  private schedule(delay?: number): void {
    if (this.destroyed || this.timer) return;
    if (!this.items.some((e) => e.status === 'queued')) return;
    // In the background the resume (or a push waking the client)
    // flushes; no timers draining the battery meanwhile.
    if (this.deps.isBackground() && delay === undefined) return;
    const ms = delay ?? Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** this.backoffStep++);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  private patch(id: Uuid, fields: Partial<OutboxEntry>): void {
    let hit = false;
    this.items = this.items.map((e) => {
      if (e.id !== id) return e;
      hit = true;
      const next = { ...e, ...fields };
      next.message = {
        ...e.message,
        local_status: next.status,
        ...(next.error && next.status === 'failed' ? { local_error: next.error } : {}),
      };
      if (next.status !== 'failed') delete next.message.local_error;
      return next;
    });
    if (hit) this.changed();
  }

  private settle(id: Uuid, message: Message | null, err: unknown): void {
    const list = this.waiters.get(id);
    if (!list) return;
    this.waiters.delete(id);
    for (const w of list) {
      if (message) w.resolve(message);
      else w.reject(err);
    }
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
    void this.persist();
  }

  // Writes run one after another, each with the entries as they are
  // then, so the last write holds the latest state.
  private persist(): Promise<void> {
    this.persistChain = this.persistChain.then(async () => {
      if (this.destroyed) return;
      const scope = await this.deps.scope();
      if (!scope || this.destroyed) return;
      if (this.items.length === 0) await scope.remove(STORAGE_KEY);
      else await scope.setJson(STORAGE_KEY, this.items);
    });
    return this.persistChain;
  }
}

function isOffline(): boolean {
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
  return nav?.onLine === false;
}

/** Whether trying again later may work (network, server trouble, auth refresh). */
export function isRetryable(err: unknown): boolean {
  if (err instanceof AuthError) return true;
  if (err instanceof ApiError) return err.status >= 500 || err.status === 408 || err.status === 429;
  return true;
}

function describe(err: unknown): string {
  // `[422] code: message` → `message`.
  if (err instanceof ApiError) return err.message.replace(/^\[\d+\]\s*[^:]*:\s*/, '');
  if (err instanceof Error) return err.message;
  return String(err);
}
