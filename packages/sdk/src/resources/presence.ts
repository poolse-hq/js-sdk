// Presence — who is online, away, in a call or offline.
//
// One store per `Poolse`: lookups from every caller are batched (one
// request per tick, ≤ 200 ids each), results are cached, and
// `presence:changed` on the user's own `user:<id>` channel keeps the
// cache live. Lookups go over the socket (`presence:get`, which also
// makes the socket hear those users' changes) while the user channel is
// joined, else over REST (`GET /v1/presence`); every (re)join asks again
// for everyone still subscribed, so a reconnect catches up and re-watches.
//
// The device's own state (`active` / `idle`) is reported with
// `setActivity` — by `trackActivity()` in a browser, by the app (e.g.
// React Native's AppState) elsewhere.

import type { RestClient } from '../rest-client.js';
import type { UserChannel } from '../realtime/realtime.js';
import type { PresenceChangedEvent, Unsubscribe } from '../realtime/types.js';
import type { Me, Presence, PresenceActivity, PresenceList, Uuid } from '../types.js';

/** Most ids one lookup takes (REST or socket). */
export const PRESENCE_MAX_LOOKUP = 200;

/** `active` is re-sent at most this often while the user keeps interacting. */
const ACTIVE_KEEPALIVE_MS = 60_000;
/** Default for `trackActivity`: no interaction for this long → idle. */
const DEFAULT_IDLE_AFTER_MS = 5 * 60_000;
/** Keeps a REST lookup's query string under common request-line limits. */
const MAX_QUERY_CHARS = 6_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'] as const;

/** Users to look up, by internal id and/or `external_id`. */
export interface PresenceLookup {
  userIds?: readonly string[];
  externalIds?: readonly string[];
}

/** Options for {@link PresenceResource.trackActivity}. */
export interface TrackActivityOptions {
  /** No pointer or key activity for this long reports `idle`. Default 5 minutes. */
  idleAfterMs?: number;
  /** The document to watch. Defaults to the global `document`. */
  document?: Document;
  /** The window to watch for focus, blur and interaction. Defaults to the global `window`. */
  window?: Window;
}

/** What the store needs from the realtime client. */
export interface PresenceRealtime {
  user(userId: string): UserChannel;
  peekUser(): UserChannel | null;
}

/** What the store needs from `poolse.me`. */
export interface PresenceMe {
  peek(): Me | null;
  show(): Promise<Me>;
  onChange(fn: (me: Me) => void): () => void;
}

interface Subscriber {
  ids: ReadonlySet<string>;
  fn: (presence: Presence) => void;
}

export class PresenceResource {
  private readonly byUser = new Map<Uuid, Presence>();
  private readonly extToUser = new Map<string, Uuid>();
  /** How many subscriptions want each id. */
  private readonly wanted = new Map<string, number>();
  /** Ids looked up (or being looked up) since the last join. */
  private readonly requested = new Set<string>();
  private readonly subscribers = new Set<Subscriber>();
  private pending = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private activity: PresenceActivity = 'active';
  private lastActiveSentAt = 0;

  private boundChannel: UserChannel | null = null;
  private unbindChannel: (() => void) | null = null;
  private waitingForMe: (() => void) | null = null;

  constructor(
    private readonly client: RestClient,
    private readonly realtime: PresenceRealtime,
    private readonly me: PresenceMe,
  ) {}

  // ── lookups ────────────────────────────────────────────────────────────

  /**
   * `GET /v1/presence` — the presence of these users, by internal id
   * and/or `external_id`. Any number of ids: more than 200 go out as
   * several requests. Unknown ids (and other tenants' users) are left
   * out. Results also land in the store.
   *
   * ```ts
   * const [ana] = await chat.presence.get({ externalIds: ['ana'] });
   * ana?.state; // 'online' | 'away' | 'in_call' | 'offline'
   * ```
   */
  async get(lookup: PresenceLookup, signal?: AbortSignal): Promise<Presence[]> {
    const requests = [
      ...queryChunks('user_ids', uniq(lookup.userIds ?? [])),
      ...queryChunks('external_ids', uniq(lookup.externalIds ?? [])),
    ].map((query) =>
      this.client
        .request<PresenceList>({
          method: 'GET',
          path: `/v1/presence?${query}`,
          ...(signal ? { signal } : {}),
        })
        .then((list) => list?.data ?? []),
    );
    const found = (await Promise.all(requests)).flat();
    this.store(found);
    return found;
  }

  /** The cached presence of a user (internal id or `external_id`), if known. */
  peek(id: string): Presence | undefined {
    const direct = this.byUser.get(id);
    if (direct) return direct;
    const userId = this.extToUser.get(id);
    return userId ? this.byUser.get(userId) : undefined;
  }

  /**
   * Keep these users' presence live. Ids may be internal user ids or
   * `external_id`s (UUID-shaped ids are tried as user ids first, then
   * as external ids). Ids not yet known are looked up — batched with
   * every other `subscribe` in the same tick — and `fn` is called with
   * each presence that arrives or changes. Read the current value
   * with {@link peek}.
   *
   * Joins the user's `user:<id>` channel (loading `/v1/me` first if
   * nobody has) so `presence:changed` arrives.
   *
   * ```ts
   * const off = chat.presence.subscribe(['ana', 'ben'], (p) => render(p.external_id, p.state));
   * ```
   */
  subscribe(ids: string | readonly string[], fn: (presence: Presence) => void): Unsubscribe {
    const list = uniq(typeof ids === 'string' ? [ids] : ids).filter((id) => id !== '');
    const sub: Subscriber = { ids: new Set(list), fn };
    this.subscribers.add(sub);
    for (const id of list) {
      this.wanted.set(id, (this.wanted.get(id) ?? 0) + 1);
      if (!this.requested.has(id)) this.pending.add(id);
    }
    this.ensureChannel();
    this.scheduleFlush();

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.subscribers.delete(sub);
      for (const id of list) {
        const n = (this.wanted.get(id) ?? 1) - 1;
        if (n > 0) this.wanted.set(id, n);
        else this.wanted.delete(id);
      }
    };
  }

  // ── this device's activity ─────────────────────────────────────────────

  /** What this device last reported: `active` (the default) or `idle`. */
  getActivity(): PresenceActivity {
    return this.activity;
  }

  /**
   * Report this device `active` or `idle` (`presence:set`). Call it
   * from whatever knows: `trackActivity()` does in a browser; in React
   * Native, map `AppState` (`active` → `active`, otherwise `idle`).
   *
   * Cheap to call often: an unchanged state isn't re-sent, except
   * `active`, which goes out again at most once a minute so the server
   * (which idles a device after 10 silent minutes) keeps it online.
   * While the user channel isn't joined the state is kept and carried
   * by the next join.
   */
  setActivity(state: PresenceActivity): void {
    const now = Date.now();
    if (state === this.activity) {
      if (state === 'idle' || now - this.lastActiveSentAt < ACTIVE_KEEPALIVE_MS) return;
    }
    this.activity = state;
    const channel = this.realtime.peekUser();
    if (!channel?.isJoined()) return;
    if (state === 'active') this.lastActiveSentAt = now;
    // A refusal (rate_limited) is harmless: the next change or
    // keepalive tries again.
    void channel.setPresence(state).catch(() => {});
  }

  /**
   * Report activity from the browser: `idle` when the page is hidden
   * or the window loses focus, or after `idleAfterMs` (default 5 min)
   * without pointer or key input; `active` on return and on
   * interaction. Returns a function that stops tracking. A no-op where
   * there is no `document` (React Native, Node).
   */
  trackActivity(opts: TrackActivityOptions = {}): Unsubscribe {
    const doc = opts.document ?? (globalThis as { document?: Document }).document;
    const win = opts.window ?? (globalThis as { window?: Window }).window;
    if (!doc || typeof doc.addEventListener !== 'function') return () => {};
    const idleAfterMs = opts.idleAfterMs ?? DEFAULT_IDLE_AFTER_MS;

    let lastInteraction = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    // One timer, re-armed for the remainder when input arrived since.
    const arm = (ms: number) => {
      clear();
      timer = setTimeout(() => {
        timer = null;
        const quiet = Date.now() - lastInteraction;
        if (quiet >= idleAfterMs) this.setActivity('idle');
        else arm(idleAfterMs - quiet);
      }, ms);
    };
    const hidden = () => doc.visibilityState === 'hidden';
    const onActive = () => {
      if (hidden()) return;
      lastInteraction = Date.now();
      this.setActivity('active');
      if (!timer) arm(idleAfterMs);
    };
    const onIdle = () => {
      clear();
      this.setActivity('idle');
    };
    const onVisibility = () => (hidden() ? onIdle() : onActive());

    doc.addEventListener('visibilitychange', onVisibility);
    win?.addEventListener('blur', onIdle);
    win?.addEventListener('focus', onActive);
    for (const evt of INTERACTION_EVENTS) {
      win?.addEventListener(evt, onActive, { passive: true });
    }

    if (hidden()) onIdle();
    else onActive();

    return () => {
      clear();
      doc.removeEventListener('visibilitychange', onVisibility);
      win?.removeEventListener('blur', onIdle);
      win?.removeEventListener('focus', onActive);
      for (const evt of INTERACTION_EVENTS) win?.removeEventListener(evt, onActive);
    };
  }

  // ── internal ───────────────────────────────────────────────────────────

  /** @internal Join params for the `user:<id>` channel. */
  _joinParams(): Record<string, unknown> {
    return { presence: this.activity };
  }

  /** @internal Called by `Poolse` when the `user:<id>` channel handle is created. */
  _bind(channel: UserChannel): void {
    if (this.boundChannel === channel) return;
    this.unbindChannel?.();
    this.boundChannel = channel;
    const offChanged = channel.onPresenceChanged((evt) => this.applyChanged(evt));
    const offJoined = channel.onJoined(() => this.onJoined());
    this.unbindChannel = () => {
      offChanged();
      offJoined();
    };
  }

  /** @internal */
  _destroy(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.waitingForMe?.();
    this.waitingForMe = null;
    this.unbindChannel?.();
    this.unbindChannel = null;
    this.boundChannel = null;
    this.subscribers.clear();
  }

  private onJoined(): void {
    // The join params carried the device's state; the server's idle
    // clock restarts from here.
    if (this.activity === 'active') this.lastActiveSentAt = Date.now();
    // A new socket process watches nobody it wasn't told about, and
    // changes during the outage were never sent: ask again for every
    // user still subscribed — over the socket, so it watches them.
    this.requested.clear();
    for (const id of this.wanted.keys()) this.pending.add(id);
    this.scheduleFlush();
  }

  private ensureChannel(): void {
    if (this.realtime.peekUser() || this.waitingForMe) return;
    const known = this.me.peek();
    if (known) {
      this.realtime.user(known.id);
      return;
    }
    this.waitingForMe = this.me.onChange((me) => {
      this.waitingForMe?.();
      this.waitingForMe = null;
      this.realtime.user(me.id);
    });
    void this.me.show().catch(() => {
      // Without the user there's no channel; lookups still work over REST.
    });
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.pending.size === 0) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, 0);
  }

  private async flush(): Promise<void> {
    const ids = [...this.pending];
    this.pending = new Set();
    if (ids.length === 0) return;
    for (const id of ids) this.requested.add(id);

    const uuidLike = ids.filter((id) => UUID_RE.test(id));
    const others = ids.filter((id) => !UUID_RE.test(id));
    try {
      const byId = await this.lookup('user_ids', uuidLike);
      const found = new Set(byId.map((p) => p.user_id));
      // A UUID-shaped id the server doesn't know as a user id may be
      // an external id.
      const retry = uuidLike.filter((id) => !found.has(id));
      await this.lookup('external_ids', [...others, ...retry]);
    } catch {
      // Let a later subscribe (or the next join) try these again.
      for (const id of ids) this.requested.delete(id);
    }
  }

  private async lookup(field: 'user_ids' | 'external_ids', ids: string[]): Promise<Presence[]> {
    if (ids.length === 0) return [];
    const channel = this.realtime.peekUser();
    const out: Presence[] = [];
    for (const chunk of chunked(ids, PRESENCE_MAX_LOOKUP)) {
      let presences: Presence[] | null = null;
      if (channel?.isJoined()) {
        const payload = field === 'user_ids' ? { user_ids: chunk } : { external_ids: chunk };
        presences = await channel.getPresence(payload).catch(() => null);
      }
      if (presences === null) {
        presences = await this.get(
          field === 'user_ids' ? { userIds: chunk } : { externalIds: chunk },
        );
      } else {
        this.store(presences);
      }
      out.push(...presences);
    }
    return out;
  }

  private applyChanged(evt: PresenceChangedEvent): void {
    const prev = this.byUser.get(evt.user_id);
    // The event carries no DND fields: keep what the last lookup said.
    this.store([{ ...prev, ...evt }]);
  }

  private store(presences: readonly Presence[]): void {
    const changed: Presence[] = [];
    for (const p of presences) {
      if (!p?.user_id) continue;
      const prev = this.byUser.get(p.user_id);
      if (p.external_id) this.extToUser.set(p.external_id, p.user_id);
      if (prev && samePresence(prev, p)) continue;
      this.byUser.set(p.user_id, p);
      changed.push(p);
    }
    if (changed.length === 0) return;
    for (const sub of [...this.subscribers]) {
      for (const p of changed) {
        if (sub.ids.has(p.user_id) || (p.external_id !== null && sub.ids.has(p.external_id))) {
          sub.fn(p);
        }
      }
    }
  }
}

function samePresence(a: Presence, b: Presence): boolean {
  return (
    a.state === b.state &&
    a.last_seen_at === b.last_seen_at &&
    a.external_id === b.external_id &&
    a.dnd_until === b.dnd_until &&
    a.do_not_disturb === b.do_not_disturb
  );
}

function uniq(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Query strings for a lookup: ≤ 200 ids each and short enough for a
 * request line. Comma-separated (`user_ids=a,b`), or repeated
 * (`external_ids[]=a`) when an id itself contains a comma.
 */
function queryChunks(field: 'user_ids' | 'external_ids', ids: readonly string[]): string[] {
  const out: string[] = [];
  const repeated = ids.some((id) => id.includes(','));
  let chunk: string[] = [];
  let chars = 0;
  const emit = () => {
    if (chunk.length === 0) return;
    out.push(
      repeated
        ? chunk
            .map((id) => `${encodeURIComponent(`${field}[]`)}=${encodeURIComponent(id)}`)
            .join('&')
        : `${field}=${chunk.map(encodeURIComponent).join(',')}`,
    );
    chunk = [];
    chars = 0;
  };
  for (const id of ids) {
    const cost = encodeURIComponent(id).length + (repeated ? field.length + 8 : 3);
    if (
      chunk.length >= PRESENCE_MAX_LOOKUP ||
      (chunk.length > 0 && chars + cost > MAX_QUERY_CHARS)
    ) {
      emit();
    }
    chunk.push(id);
    chars += cost;
  }
  emit();
  return out;
}
