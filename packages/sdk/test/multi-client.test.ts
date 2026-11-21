import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  MessageQueuedError,
  Poolse,
  createIndexedDbStorage,
  memoryStorage,
  type Message,
  type PoolseConfig,
} from '../src/index.js';

// A fetch that answers by route; `handler` returns a Response or throws.
function routedFetch(handler: (method: string, path: string, body: unknown) => Response) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname, body });
    return handler(method, url.pathname, body);
  }) as unknown as typeof globalThis.fetch;
  return Object.assign(fn, { calls });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const apiError = (status: number, code: string) =>
  json({ error: { code, message: code.replace(/_/g, ' ') } }, status);

function client(over: Partial<PoolseConfig> = {}, fetchFn?: typeof globalThis.fetch) {
  return new Poolse({
    apiUrl: 'https://a.example',
    getToken: () => 'tok',
    fetch: fetchFn ?? (vi.fn() as unknown as typeof globalThis.fetch),
    maxRetries: 0,
    baseBackoffMs: 0,
    maxBackoffMs: 0,
    ...over,
  });
}

const trigger = (handle: unknown, event: string, payload: unknown) =>
  (handle as { channel: { trigger(e: string, p: unknown): void } }).channel.trigger(event, payload);

function msg(id: string, conversationId = 'c-1', sequence = 1): Message {
  return {
    id,
    tenant_id: 't',
    conversation_id: conversationId,
    sender_id: 'u-1',
    sender_external_id: 'alice',
    type: 'text',
    body: `body ${id}`,
    reply_to_id: null,
    thread_root_id: null,
    mentions: [],
    reactions: {},
    edited_at: null,
    deleted_at: null,
    sequence,
    inserted_at: '2026-11-21T10:00:00Z',
    updated_at: '2026-11-21T10:00:00Z',
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('several clients side by side', () => {
  it('namespaces by server and user', async () => {
    const a = client({ storageNamespace: 'ana' });
    const b = client({ apiUrl: 'https://b.example', storageNamespace: 'ana' });
    expect(a.namespace).toBe('poolse:v1:https://a.example#ana');
    expect(b.namespace).toBe('poolse:v1:https://b.example#ana');
    const c = client(
      {},
      routedFetch(() => json({ id: 'u-9' })),
    );
    expect(c.namespace).toBeNull();
    await c.me.show();
    expect(c.namespace).toBe('poolse:v1:https://a.example#u-9');
    await Promise.all([a.destroy(), b.destroy(), c.destroy()]);
  });

  it('keeps scoped services per client', async () => {
    const a = client();
    const b = client();
    const sa = a.scoped('k', () => ({ n: 1 }));
    expect(a.scoped('k', () => ({ n: 2 }))).toBe(sa);
    expect(b.scoped('k', () => ({ n: 3 }))).not.toBe(sa);
    await Promise.all([a.destroy(), b.destroy()]);
  });

  it('destroying one leaves the other connected and its listeners alive', async () => {
    const a = client();
    const b = client();
    const ha = a.realtime.conversation('c-1');
    const hb = b.realtime.conversation('c-1');
    expect(ha).not.toBe(hb);
    const onB = vi.fn();
    hb.onMessage(onB);
    const destroyedA = vi.fn();
    a.onDestroy(destroyedA);
    const svc = { destroy: vi.fn() };
    a.scoped('svc', () => svc);

    await a.destroy();

    expect(destroyedA).toHaveBeenCalledOnce();
    expect(svc.destroy).toHaveBeenCalledWith({ clearStorage: false });
    expect(a.destroyed).toBe(true);
    expect(a.realtime.getStatus()).toBe('closed');
    expect(b.realtime.getStatus()).toBe('connecting');
    trigger(hb, 'message:new', msg('m-1'));
    expect(onB).toHaveBeenCalledOnce();
    // A destroyed client opens no new socket for a late subscriber.
    a.realtime.conversation('c-2');
    a.setBackground(false);
    expect(a.realtime.getStatus()).toBe('closed');
    await b.destroy();
  });

  it('clearStorage removes only that client’s keys from a shared storage', async () => {
    const storage = memoryStorage();
    const a = client({ storage, storageNamespace: 'ana' });
    const b = client({ storage, storageNamespace: 'bo' });
    a.cache.setMessages('c-1', [msg('m-1')]);
    b.cache.setMessages('c-1', [msg('m-2')]);
    await Promise.all([a.cache.flush(), b.cache.flush()]);
    const before = storage.size;
    expect(before).toBeGreaterThanOrEqual(4); // two entries + two indexes

    await a.destroy({ clearStorage: true });

    const again = client({ storage, storageNamespace: 'ana' });
    expect(await again.cache.loadMessages('c-1')).toBeNull();
    const bAgain = client({ storage, storageNamespace: 'bo' });
    expect((await bAgain.cache.loadMessages('c-1'))?.map((m) => m.id)).toEqual(['m-2']);
    await Promise.all([b.destroy(), again.destroy(), bAgain.destroy()]);
  });

  it('warm cache is per client', async () => {
    const a = client();
    const b = client();
    a.cache.setMessages('c-1', [msg('m-1')]);
    expect(a.cache.peekMessages('c-1')).toHaveLength(1);
    expect(b.cache.peekMessages('c-1')).toBeUndefined();
    await Promise.all([a.destroy(), b.destroy()]);
  });
});

describe('background', () => {
  it('a client created in the background stays closed until foregrounded', async () => {
    const c = client({ background: true });
    c.realtime.conversation('c-1');
    expect(c.isBackground()).toBe(true);
    expect(c.realtime.getStatus()).toBe('idle');
    c.setBackground(false);
    expect(c.realtime.getStatus()).toBe('connecting');
    c.setBackground(true);
    expect(c.realtime.getStatus()).toBe('closed');
    await c.destroy();
  });

  it('wake() connects for a while, then pauses again', async () => {
    vi.useFakeTimers();
    const c = client();
    c.realtime.conversation('c-1');
    c.setBackground(true);
    expect(c.realtime.getStatus()).toBe('closed');
    c.wake({ forMs: 1000 });
    expect(c.realtime.getStatus()).toBe('connecting');
    await vi.advanceTimersByTimeAsync(1000);
    expect(c.realtime.getStatus()).toBe('closed');
    // Foregrounded during a wake: the timer doesn't pause it.
    c.wake({ forMs: 1000 });
    c.setBackground(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(c.realtime.getStatus()).toBe('connecting');
    await c.destroy();
  });
});

describe('timings', () => {
  it('records the first conversation list and messages page', async () => {
    const fetchFn = routedFetch((_m, path) =>
      path.endsWith('/messages') ? json({ data: [] }) : json({ data: [], next_cursor: null }),
    );
    const c = client({}, fetchFn);
    const seen = vi.fn();
    c.timings.on(seen);
    await c.conversations.list();
    await c.conversations.one('c-1').messages.list();
    const t = c.timings.get();
    expect(t['firstConversations']).toBeTypeOf('number');
    expect(t['firstMessages']).toBeTypeOf('number');
    expect(seen.mock.calls.map(([e]) => e.name)).toEqual(['firstConversations', 'firstMessages']);
    const done = c.timings.start('switch');
    expect(done()).toBeGreaterThanOrEqual(0);
    expect(c.timings.peek('switch')).toBeDefined();
    await c.destroy();
  });
});

describe('unread totals', () => {
  it('folds conversation:read into the server totals', async () => {
    const fetchFn = routedFetch((_m, path) => {
      if (path === '/v1/me/unread')
        return json({ unread_total: 7, mention_total: 2, conversations_with_unread: 2 });
      if (path === '/v1/me') return json({ id: 'u-1' });
      throw new Error(path);
    });
    const c = client({}, fetchFn);
    const seen = vi.fn();
    c.unread.subscribe(seen);
    await vi.waitFor(() => expect(c.unread.get().loading).toBe(false));
    expect(c.unread.get()).toMatchObject({
      unread: 7,
      mentions: 2,
      conversations: 2,
      source: 'server',
    });

    c.unread.observe([
      { id: 'c-1', unread_count: 5, mention_unread_count: 2 } as never,
      { id: 'c-2', unread_count: 2, mention_unread_count: 0 } as never,
    ]);
    await vi.waitFor(() => expect(c.realtime.peekUser()).not.toBeNull());
    trigger(c.realtime.peekUser(), 'conversation:read', {
      conversation_id: 'c-1',
      last_read_message_id: 'm',
      last_read_sequence: 1,
      unread_count: 0,
      mention_unread_count: 0,
    });
    expect(c.unread.get()).toMatchObject({ unread: 2, mentions: 0, conversations: 1 });
    await c.destroy();
  });

  it('re-fetches when an event names a conversation it has not seen', async () => {
    let total = 1;
    const fetchFn = routedFetch((_m, path) => {
      if (path === '/v1/me/unread')
        return json({ unread_total: total, mention_total: 0, conversations_with_unread: total });
      return json({ id: 'u-1' });
    });
    const c = client({}, fetchFn);
    c.unread.subscribe(() => {});
    await vi.waitFor(() => expect(c.unread.get().unread).toBe(1));
    await vi.waitFor(() => expect(c.realtime.peekUser()).not.toBeNull());
    total = 2;
    trigger(c.realtime.peekUser(), 'conversation:updated', {
      conversation: { id: 'c-new', unread_count: 1, mention_unread_count: 0 },
      by_user_id: 'u-2',
    });
    await vi.waitFor(() => expect(c.unread.get().unread).toBe(2), { timeout: 2000 });
    await c.destroy();
  });

  it('takes pushed unread:totals and conversation:read totals as they come', async () => {
    const fetchFn = routedFetch((_m, path) =>
      path === '/v1/me/unread'
        ? json({ unread_total: 1, mention_total: 0, conversations_with_unread: 1 })
        : json({ id: 'u-1' }),
    );
    const c = client({}, fetchFn);
    c.unread.subscribe(() => {});
    await vi.waitFor(() => expect(c.realtime.peekUser()).not.toBeNull());
    await vi.waitFor(() => expect(c.unread.get().loading).toBe(false));
    const user = c.realtime.peekUser();
    trigger(user, 'unread:totals', {
      unread_total: 9,
      mention_total: 3,
      conversations_with_unread: 4,
    });
    expect(c.unread.get()).toMatchObject({ unread: 9, mentions: 3, conversations: 4 });
    trigger(user, 'conversation:read', {
      conversation_id: 'c-x',
      last_read_message_id: 'm',
      last_read_sequence: 1,
      unread_count: 0,
      mention_unread_count: 0,
      totals: { unread_total: 5, mention_total: 1, conversations_with_unread: 3 },
    });
    expect(c.unread.get()).toMatchObject({ unread: 5, mentions: 1, conversations: 3 });
    await c.destroy();
  });

  it('sums the loaded conversations on a server without the endpoint', async () => {
    const fetchFn = routedFetch((_m, path) =>
      path === '/v1/me/unread' ? apiError(404, 'not_found') : json({ id: 'u-1' }),
    );
    const c = client({}, fetchFn);
    c.unread.subscribe(() => {});
    await vi.waitFor(() => expect(c.unread.get().source).toBe('local'));
    c.unread.observe([
      { id: 'c-1', unread_count: 3, mention_unread_count: 1 } as never,
      { id: 'c-2', unread_count: 0, mention_unread_count: 0 } as never,
    ]);
    expect(c.unread.get()).toMatchObject({ unread: 3, mentions: 1, conversations: 1 });
    c.unread.apply('c-1', 0, 0);
    expect(c.unread.get()).toMatchObject({ unread: 0, mentions: 0, conversations: 0 });
    await c.destroy();
  });
});

describe('outbox', () => {
  const request = (id: string) => ({ id, body: 'hi' });

  it('queues a send that cannot reach the server and resends it with the same id', async () => {
    let online = false;
    const fetchFn = routedFetch((_m, _p, body) => {
      if (!online) throw new TypeError('Failed to fetch');
      return json(msg((body as { id: string }).id));
    });
    const c = client({}, fetchFn);
    const sent = vi.fn();
    c.outbox.onSent(sent);

    await expect(c.outbox.send('c-1', request('m-1'), msg('m-1'))).rejects.toBeInstanceOf(
      MessageQueuedError,
    );
    expect(c.outbox.entries('c-1')).toMatchObject([
      { id: 'm-1', status: 'queued', message: { local_status: 'queued' } },
    ]);
    const delivered = c.outbox.whenSent('m-1');

    online = true;
    await c.outbox.flush();

    expect((await delivered).id).toBe('m-1');
    expect(sent).toHaveBeenCalledOnce();
    expect(c.outbox.entries()).toEqual([]);
    const posts = fetchFn.calls.filter((r) => r.method === 'POST');
    expect(posts.map((r) => (r.body as { id: string }).id)).toEqual(['m-1', 'm-1']);
    await c.destroy();
  });

  it('keeps a refused send as failed until retried or removed', async () => {
    let refuse = true;
    const fetchFn = routedFetch((_m, _p, body) =>
      refuse ? apiError(422, 'invalid_body') : json(msg((body as { id: string }).id)),
    );
    const c = client({}, fetchFn);
    await expect(c.outbox.send('c-1', request('m-1'), msg('m-1'))).rejects.toBeInstanceOf(ApiError);
    expect(c.outbox.entries()[0]).toMatchObject({
      status: 'failed',
      errorCode: 'invalid_body',
      message: { local_status: 'failed', local_error: expect.any(String) },
    });
    // flush() leaves failed ones alone.
    await c.outbox.flush();
    expect(c.outbox.entries()).toHaveLength(1);

    refuse = false;
    expect((await c.outbox.retry('m-1')).id).toBe('m-1');
    expect(c.outbox.entries()).toEqual([]);

    refuse = true;
    await c.outbox.send('c-1', request('m-2'), msg('m-2')).catch(() => {});
    c.outbox.remove('m-2');
    expect(c.outbox.entries()).toEqual([]);
    await c.destroy();
  });

  it('a 409 message_id_conflict is a permanent failure', async () => {
    const fetchFn = routedFetch(() => apiError(409, 'message_id_conflict'));
    const c = client({}, fetchFn);
    await c.outbox.send('c-1', request('m-1'), msg('m-1')).catch(() => {});
    expect(c.outbox.entries()[0]).toMatchObject({
      status: 'failed',
      errorCode: 'message_id_conflict',
      error: 'message id conflict',
    });
    await c.outbox.flush();
    expect(fetchFn.calls.filter((r) => r.method === 'POST')).toHaveLength(1);
    await c.destroy();
  });

  it('survives a restart through the storage, per namespace', async () => {
    const storage = memoryStorage();
    const offline = routedFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const a = client({ storage, storageNamespace: 'ana' }, offline);
    await a.outbox.send('c-1', request('m-1'), msg('m-1')).catch(() => {});
    await a.destroy();

    const other = client({ storage, storageNamespace: 'bo' }, offline);
    await other.outbox.hydrate();
    expect(other.outbox.entries()).toEqual([]);

    const fetchFn = routedFetch((_m, _p, body) => json(msg((body as { id: string }).id)));
    const again = client({ storage, storageNamespace: 'ana' }, fetchFn);
    await again.outbox.hydrate();
    expect(again.outbox.entries()).toMatchObject([{ id: 'm-1', status: 'queued' }]);
    await again.outbox.flush();
    expect(again.outbox.entries()).toEqual([]);
    await Promise.all([other.destroy(), again.destroy()]);
  });
});

describe('storage', () => {
  it('createIndexedDbStorage falls back to memory without IndexedDB', async () => {
    const s = createIndexedDbStorage();
    await s.set('k', 'v');
    expect(await s.get('k')).toBe('v');
    await s.remove('k');
    expect(await s.get('k')).toBeNull();
  });

  it('the cached user is restored for an offline start', async () => {
    const storage = memoryStorage();
    const a = client(
      { storage, storageNamespace: 'ana' },
      routedFetch(() => json({ id: 'u-1' })),
    );
    await a.me.show();
    await a.destroy();
    const b = client({ storage, storageNamespace: 'ana' });
    await vi.waitFor(() => expect(b.me.peek()?.id).toBe('u-1'));
    await b.destroy();
  });
});
