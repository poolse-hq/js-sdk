// How long a client took to become useful, for speed budgets (cold start
// under 1.5 s, a workspace switch under 150 ms, a cached channel under
// 100 ms). The SDK records the milestones it sees itself; the app adds
// its own (a switch, opening a channel) with `start(name)`.

import type { Unsubscribe } from './realtime/types.js';

/**
 * Milestones the SDK records on its own, in milliseconds since the
 * client was created (`reconnect`: since `resume()`/`setBackground(false)`).
 */
export type BuiltInTiming =
  /** The WebSocket first opened. */
  | 'connect'
  /** The socket opened again after a pause (time from the resume). */
  | 'reconnect'
  /** The first `GET /v1/me` answered. */
  | 'me'
  /** The first conversation list arrived from the server. */
  | 'firstConversations'
  /** The first page of messages arrived from the server. */
  | 'firstMessages'
  /** A conversation list was shown from the local cache. */
  | 'cachedConversations'
  /** A conversation's messages were shown from the local cache. */
  | 'cachedMessages';

export interface TimingEvent {
  /** A {@link BuiltInTiming} or a name the app passed to `start` / `record`. */
  name: BuiltInTiming | (string & {});
  /** Duration in milliseconds. */
  ms: number;
  /** When it was recorded (`Date.now()`). */
  at: number;
}

const now: () => number =
  typeof globalThis.performance?.now === 'function'
    ? () => globalThis.performance.now()
    : () => Date.now();

export class ClientTimings {
  /** `performance.now()` when the client was created. */
  readonly origin = now();
  private readonly values = new Map<string, TimingEvent>();
  private readonly listeners = new Set<(evt: TimingEvent) => void>();

  /**
   * The latest value of every timing so far, by name:
   * `{ connect: 212, firstConversations: 340, switch: 38 }`.
   */
  get(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, evt] of this.values) out[name] = Math.round(evt.ms);
    return out;
  }

  /** The latest event for one name, if recorded. */
  peek(name: string): TimingEvent | undefined {
    return this.values.get(name);
  }

  /** Called for every timing as it is recorded. */
  on(fn: (evt: TimingEvent) => void): Unsubscribe {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /**
   * Start a measurement; call the returned function when it's done.
   *
   * ```ts
   * const done = chat.timings.start('switch');
   * showWorkspace(chat);
   * requestAnimationFrame(() => done());
   * ```
   */
  start(name: string): () => number {
    const t0 = now();
    let ended = false;
    return () => {
      const ms = now() - t0;
      if (!ended) this.record(name, ms);
      ended = true;
      return ms;
    };
  }

  /** Record a duration you measured yourself. */
  record(name: string, ms: number): void {
    const evt: TimingEvent = { name, ms, at: Date.now() };
    this.values.set(name, evt);
    for (const fn of this.listeners) fn(evt);
  }

  /** Record `name` as the time since the client was created, once. @internal */
  _once(name: BuiltInTiming): void {
    if (this.values.has(name)) return;
    this.record(name, now() - this.origin);
  }

  /** @internal */
  _now(): number {
    return now();
  }

  /** @internal */
  _destroy(): void {
    this.listeners.clear();
  }
}
