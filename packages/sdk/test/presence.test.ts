import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from 'phoenix';
import { UserChannel } from '../src/realtime/realtime.js';
import {
  PresenceResource,
  type PresenceMe,
  type PresenceRealtime,
} from '../src/resources/presence.js';
import { ChannelReplyError, Poolse, type Me, type Presence } from '../src/index.js';
import { buildClient, jsonResponse, scriptedFetch } from './_helpers.js';

const UUID_A = '00000000-0000-4000-8000-00000000000a';
const UUID_B = '00000000-0000-4000-8000-00000000000b';

const presence = (over: Partial<Presence> = {}): Presence => ({
  user_id: UUID_A,
  external_id: 'ana',
  state: 'online',
  last_seen_at: '2026-11-21T09:00:00Z',
  dnd_until: null,
  do_not_disturb: false,
  ...over,
});

const me: Me = {
  id: 'u-me',
  tenant_id: 't-1',
  external_id: 'me',
  display_name: 'Me',
  custom_data: {},
  is_blocked: false,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

type Reply = { status: 'ok' | 'error' | 'timeout'; response?: unknown };

/** Just enough of a Phoenix channel: bindings, a scripted join and pushes. */
class FakeChannel {
  state = 'closed';
  readonly pushes: Array<{ event: string; payload: Record<string, unknown> }> = [];
  responder: (event: string, payload: Record<string, unknown>) => Reply = () => ({
    status: 'ok',
    response: {},
  });
  private readonly bindings = new Map<string, Array<(p: unknown) => void>>();
  private readonly joinOk: Array<() => void> = [];

  on(event: string, cb: (p: unknown) => void) {
    this.bindings.set(event, [...(this.bindings.get(event) ?? []), cb]);
    return 0;
  }
  onClose() {}
  trigger(event: string, payload: unknown) {
    this.bindings.get(event)?.forEach((cb) => cb(payload));
  }
  join() {
    const push = {
      receive: (status: string, cb: () => void) => {
        if (status === 'ok') this.joinOk.push(cb);
        return push;
      },
    };
    return push;
  }
  /** The server accepted the (re)join. */
  joined() {
    this.state = 'joined';
    this.joinOk.forEach((cb) => cb());
  }
  push(event: string, payload: Record<string, unknown>) {
    this.pushes.push({ event, payload });
    const reply = this.responder(event, payload);
    const push = {
      receive: (status: string, cb: (r: unknown) => void) => {
        if (status === reply.status) queueMicrotask(() => cb(reply.response));
        return push;
      },
    };
    return push;
  }
  leave() {}
}

function setup(
  script: Response[] = [],
  opts: { knownMe?: Me | null } = {},
): {
  store: PresenceResource;
  fetchFn: ReturnType<typeof scriptedFetch>;
  fake: FakeChannel;
  realtime: PresenceRealtime & { channel: UserChannel | null };
  meApi: PresenceMe & { emit(m: Me): void };
} {
  const fetchFn = scriptedFetch(script);
  const fake = new FakeChannel();
  const listeners = new Set<(m: Me) => void>();
  let current: Me | null = opts.knownMe === undefined ? me : opts.knownMe;
  const meApi = {
    peek: () => current,
    show: vi.fn(async () => me),
    onChange: (fn: (m: Me) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(m: Me) {
      current = m;
      listeners.forEach((l) => l(m));
    },
  };
  const realtime = {
    channel: null as UserChannel | null,
    user(id: string) {
      if (!this.channel) {
        this.channel = new UserChannel(id, fake as unknown as Channel);
        store._bind(this.channel);
        this.channel._join();
      }
      return this.channel;
    },
    peekUser() {
      return this.channel;
    },
  };
  const store = new PresenceResource(buildClient(fetchFn), realtime, meApi);
  return { store, fetchFn, fake, realtime, meApi };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => {
  await tick();
  await tick();
  await tick();
};

afterEach(() => {
  vi.useRealTimers();
});

describe('presence.get (REST)', () => {
  it('GET /v1/presence with comma-separated ids', async () => {
    const { store, fetchFn } = setup([
      jsonResponse({ data: [presence()] }),
      jsonResponse({ data: [presence({ user_id: UUID_B, external_id: 'ben' })] }),
    ]);

    const out = await store.get({ userIds: [UUID_A, UUID_A], externalIds: ['ben'] });

    const first = new URL(fetchFn.calls[0]!.url);
    expect(first.pathname).toBe('/v1/presence');
    expect(first.searchParams.get('user_ids')).toBe(UUID_A);
    expect(new URL(fetchFn.calls[1]!.url).searchParams.get('external_ids')).toBe('ben');
    expect(out.map((p) => p.external_id)).toEqual(['ana', 'ben']);
    expect(store.peek('ana')?.state).toBe('online');
    expect(store.peek(UUID_B)?.external_id).toBe('ben');
  });

  it('splits more than 200 ids into several requests', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `user-${i}`);
    const { store, fetchFn } = setup([
      jsonResponse({ data: [] }),
      jsonResponse({ data: [] }),
      jsonResponse({ data: [] }),
    ]);

    await store.get({ externalIds: ids });

    expect(fetchFn.calls).toHaveLength(3);
    const sizes = fetchFn.calls.map(
      (c) => new URL(c.url).searchParams.get('external_ids')!.split(',').length,
    );
    expect(sizes).toEqual([200, 200, 50]);
  });

  it('repeats the key when an id contains a comma', async () => {
    const { store, fetchFn } = setup([jsonResponse({ data: [] })]);

    await store.get({ externalIds: ['a,b', 'c'] });

    expect(new URL(fetchFn.calls[0]!.url).searchParams.getAll('external_ids[]')).toEqual([
      'a,b',
      'c',
    ]);
  });

  it('makes no request without ids', async () => {
    const { store, fetchFn } = setup([]);
    expect(await store.get({})).toEqual([]);
    expect(fetchFn.calls).toHaveLength(0);
  });

  it('surfaces 422 validation_failed', async () => {
    const { store } = setup([
      jsonResponse(
        { error: { code: 'validation_failed', message: 'x', doc_url: '' } },
        { status: 422 },
      ),
    ]);
    await expect(store.get({ userIds: [UUID_A] })).rejects.toMatchObject({
      status: 422,
      code: 'validation_failed',
    });
  });
});

describe('presence.subscribe', () => {
  it('batches every subscribe in a tick into one lookup', async () => {
    const { store, fetchFn } = setup([
      jsonResponse({
        data: [presence(), presence({ user_id: 'u-ben', external_id: 'ben', state: 'away' })],
      }),
    ]);
    const a = vi.fn();
    const b = vi.fn();

    store.subscribe('ana', a);
    store.subscribe(['ben', 'ana'], b);
    await flush();

    expect(fetchFn.calls).toHaveLength(1);
    expect(new URL(fetchFn.calls[0]!.url).searchParams.get('external_ids')).toBe('ana,ben');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    expect(store.peek('ben')?.state).toBe('away');
  });

  it('does not look up an id again for a later subscriber', async () => {
    const { store, fetchFn } = setup([jsonResponse({ data: [presence()] })]);
    store.subscribe('ana', () => {});
    await flush();
    store.subscribe('ana', () => {});
    await flush();
    expect(fetchFn.calls).toHaveLength(1);
  });

  it('tries an unknown UUID-shaped id as an external id', async () => {
    const { store, fetchFn } = setup([
      jsonResponse({ data: [] }),
      jsonResponse({ data: [presence({ user_id: 'u-x', external_id: UUID_B })] }),
    ]);

    store.subscribe(UUID_B, () => {});
    await flush();

    expect(new URL(fetchFn.calls[0]!.url).searchParams.get('user_ids')).toBe(UUID_B);
    expect(new URL(fetchFn.calls[1]!.url).searchParams.get('external_ids')).toBe(UUID_B);
    expect(store.peek(UUID_B)?.user_id).toBe('u-x');
  });

  it('joins the user channel, loading me when unknown', async () => {
    const { store, realtime, meApi } = setup([jsonResponse({ data: [] })], { knownMe: null });

    store.subscribe('ana', () => {});
    expect(meApi.show).toHaveBeenCalledTimes(1);
    expect(realtime.channel).toBeNull();

    meApi.emit(me);
    expect(realtime.channel?.userId).toBe('u-me');
    await flush();
  });

  it('applies presence:changed, keeping DND fields, only to subscribers of that user', async () => {
    const { store, fake } = setup([
      jsonResponse({
        data: [presence({ do_not_disturb: true, dnd_until: '2026-11-22T00:00:00Z' })],
      }),
    ]);
    const anaFn = vi.fn();
    const benFn = vi.fn();
    store.subscribe('ana', anaFn);
    store.subscribe('ben', benFn);
    await flush();
    anaFn.mockClear();

    fake.trigger('presence:changed', {
      user_id: UUID_A,
      external_id: 'ana',
      state: 'away',
      last_seen_at: '2026-11-21T09:10:00Z',
    });

    expect(anaFn).toHaveBeenCalledTimes(1);
    expect(benFn).not.toHaveBeenCalled();
    expect(store.peek('ana')).toMatchObject({
      state: 'away',
      do_not_disturb: true,
      dnd_until: '2026-11-22T00:00:00Z',
    });
  });

  it('stops calling back after unsubscribe', async () => {
    const { store, fake } = setup([jsonResponse({ data: [presence()] })]);
    const fn = vi.fn();
    const off = store.subscribe('ana', fn);
    await flush();
    off();
    fn.mockClear();

    fake.trigger('presence:changed', { ...presence({ state: 'offline' }) });

    expect(fn).not.toHaveBeenCalled();
    expect(store.peek('ana')?.state).toBe('offline');
  });

  it('asks over the socket while joined, and again for everyone on rejoin', async () => {
    const { store, fake, fetchFn } = setup([]);
    fake.responder = (event, payload) =>
      event === 'presence:get'
        ? {
            status: 'ok',
            response: {
              presences: ((payload['external_ids'] as string[]) ?? []).map((ext) =>
                presence({ user_id: `u-${ext}`, external_id: ext }),
              ),
            },
          }
        : { status: 'ok', response: {} };

    store.subscribe('ana', () => {});
    fake.joined();
    await flush();

    const gets = () => fake.pushes.filter((p) => p.event === 'presence:get');
    expect(fetchFn.calls).toHaveLength(0);
    expect(gets()).toHaveLength(1);
    expect(gets()[0]!.payload).toEqual({ external_ids: ['ana'] });

    store.subscribe('ben', () => {});
    await flush();
    expect(gets()[1]!.payload).toEqual({ external_ids: ['ben'] });

    // Reconnect: both are asked for again in one push.
    fake.joined();
    await flush();
    expect(gets()[2]!.payload).toEqual({ external_ids: ['ana', 'ben'] });
  });

  it('falls back to REST when presence:get is refused', async () => {
    const { store, fake, fetchFn } = setup([jsonResponse({ data: [presence()] })]);
    fake.responder = () => ({ status: 'error', response: { reason: 'too_many' } });
    fake.joined();

    store.subscribe('ana', () => {});
    await flush();

    expect(fetchFn.calls).toHaveLength(1);
    expect(store.peek('ana')?.state).toBe('online');
  });

  it('retries ids whose lookup failed on the next subscribe', async () => {
    const { store, fetchFn } = setup([
      jsonResponse({ error: { code: 'x', message: 'x', doc_url: '' } }, { status: 400 }),
      jsonResponse({ data: [presence()] }),
    ]);
    store.subscribe('ana', () => {});
    await flush();
    store.subscribe('ana', () => {});
    await flush();
    expect(fetchFn.calls).toHaveLength(2);
    expect(store.peek('ana')).toBeDefined();
  });
});

describe('UserChannel presence requests', () => {
  it('setPresence rejects with ChannelReplyError', async () => {
    const fake = new FakeChannel();
    fake.responder = () => ({ status: 'error', response: { reason: 'rate_limited' } });
    const channel = new UserChannel('u-me', fake as unknown as Channel);

    const err = await channel.setPresence('idle').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ChannelReplyError);
    expect((err as ChannelReplyError).reason).toBe('rate_limited');
    expect(fake.pushes[0]).toEqual({ event: 'presence:set', payload: { state: 'idle' } });
  });

  it('getPresence resolves the presences', async () => {
    const fake = new FakeChannel();
    fake.responder = () => ({ status: 'ok', response: { presences: [presence()] } });
    const channel = new UserChannel('u-me', fake as unknown as Channel);

    expect(await channel.getPresence({ user_ids: [UUID_A] })).toEqual([presence()]);
  });

  it('a timeout rejects with reason timeout', async () => {
    const fake = new FakeChannel();
    fake.responder = () => ({ status: 'timeout' });
    const channel = new UserChannel('u-me', fake as unknown as Channel);

    await expect(channel.getPresence({ external_ids: ['a'] })).rejects.toMatchObject({
      reason: 'timeout',
    });
  });
});

describe('activity reporting', () => {
  it('sends changes, skips repeats, and re-sends active at most once a minute', async () => {
    vi.useFakeTimers();
    const { store, fake, realtime } = setup([]);
    realtime.user('u-me');
    fake.joined();
    const sets = () => fake.pushes.filter((p) => p.event === 'presence:set');

    store.setActivity('active'); // joined as active a moment ago
    store.setActivity('idle');
    store.setActivity('idle');
    expect(sets().map((p) => p.payload['state'])).toEqual(['idle']);

    store.setActivity('active');
    store.setActivity('active');
    expect(sets()).toHaveLength(2);

    vi.advanceTimersByTime(61_000);
    store.setActivity('active');
    expect(sets()).toHaveLength(3);
  });

  it('keeps the state for the next join while not joined', () => {
    const { store, fake, realtime } = setup([]);
    realtime.user('u-me');

    store.setActivity('idle');

    expect(fake.pushes).toHaveLength(0);
    expect(store.getActivity()).toBe('idle');
    expect(store._joinParams()).toEqual({ presence: 'idle' });
  });

  it('Poolse joins the user channel with the presence join param', () => {
    const chat = new Poolse({
      apiUrl: 'https://chat.example',
      getToken: () => 'tok',
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
    });
    chat.presence.setActivity('idle');
    const user = chat.realtime.user('u-1');

    const params = (user._channel() as unknown as { params: () => unknown }).params();

    expect(params).toEqual({ presence: 'idle' });
    chat.destroy();
  });

  it('trackActivity: hidden/blur → idle, focus/input → active, idle timer', () => {
    vi.useFakeTimers();
    const { store, fake, realtime } = setup([]);
    realtime.user('u-me');
    fake.joined();

    const doc = new EventTarget() as EventTarget & { visibilityState: string };
    doc.visibilityState = 'visible';
    const win = new EventTarget();
    const stop = store.trackActivity({
      document: doc as unknown as Document,
      window: win as unknown as Window,
      idleAfterMs: 1_000,
    });
    const states = () =>
      fake.pushes.filter((p) => p.event === 'presence:set').map((p) => p.payload['state']);

    win.dispatchEvent(new Event('blur'));
    expect(store.getActivity()).toBe('idle');
    win.dispatchEvent(new Event('focus'));
    expect(store.getActivity()).toBe('active');

    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(store.getActivity()).toBe('idle');
    // Input on a hidden page doesn't count.
    win.dispatchEvent(new Event('keydown'));
    expect(store.getActivity()).toBe('idle');

    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(store.getActivity()).toBe('active');

    // Input pushes the idle deadline out.
    vi.advanceTimersByTime(800);
    win.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(800);
    expect(store.getActivity()).toBe('active');
    vi.advanceTimersByTime(300);
    expect(store.getActivity()).toBe('idle');

    expect(states()).toEqual(['idle', 'active', 'idle', 'active', 'idle']);

    stop();
    win.dispatchEvent(new Event('focus'));
    expect(store.getActivity()).toBe('idle');
  });

  it('trackActivity is a no-op without a document', () => {
    const { store } = setup([]);
    const stop = store.trackActivity();
    expect(typeof stop).toBe('function');
    stop();
  });
});
