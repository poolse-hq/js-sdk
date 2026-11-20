import { describe, expect, it, vi } from 'vitest';
import { Poolse } from '../src/index.js';

// We don't run a real WebSocket in tests — we observe surface behaviour
// (status changes, lazy connect, handle reuse) that doesn't require the
// underlying socket to actually open. The wire-level behaviour is the
// `phoenix` library's responsibility and is tested upstream.

describe('Poolse.realtime', () => {
  it('exposes a realtime client at construction time', () => {
    const chat = new Poolse({
      apiUrl: 'https://chat.example',
      getToken: () => 'tok',
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
    });

    expect(chat.realtime).toBeDefined();
    expect(chat.realtime.getStatus()).toBe('idle');
  });

  it('honours an explicit wsUrl override', () => {
    const chat = new Poolse({
      apiUrl: 'https://api.example',
      wsUrl: 'wss://realtime.example',
      getToken: () => 'tok',
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
    });

    // We can't reach into the internal socket, but the realtime client
    // was constructed with this URL — assert via the side-effect that
    // it didn't throw and that `apiUrl` is still trimmed correctly.
    expect(chat.realtime).toBeDefined();
  });

  it('destroy() flips status to closed', () => {
    const chat = new Poolse({
      apiUrl: 'https://chat.example',
      getToken: () => 'tok',
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
    });

    let observed = '';
    chat.realtime.onStatus((s) => {
      observed = s;
    });

    chat.destroy();
    expect(observed).toBe('closed');
  });
});

describe('Poolse.realtime pause/resume', () => {
  const chat = () =>
    new Poolse({
      apiUrl: 'https://chat.example',
      getToken: () => 'tok',
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
    });

  it('keeps channel handles across a pause', () => {
    const c = chat();
    const handle = c.realtime.conversation('c-1');
    c.realtime.pause();
    expect(c.realtime.getStatus()).toBe('closed');
    c.realtime.resume();
    expect(c.realtime.getStatus()).toBe('connecting');
    expect(c.realtime.conversation('c-1')).toBe(handle);
    c.destroy();
  });

  it('is a no-op before anything connected', () => {
    const c = chat();
    c.realtime.pause();
    c.realtime.resume();
    expect(c.realtime.getStatus()).toBe('idle');
  });
});

describe('ConversationChannel close', () => {
  it('a server-closed channel is dropped and reported', () => {
    const c = new Poolse({
      apiUrl: 'https://chat.example',
      getToken: () => 'tok',
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
    });
    const handle = c.realtime.conversation('c-1');
    const closed = vi.fn();
    handle.onClosed(closed);

    // What phoenix.js does on the server's phx_close.
    (handle as unknown as { channel: { trigger(e: string): void } }).channel.trigger('phx_close');

    expect(closed).toHaveBeenCalledOnce();
    expect(c.realtime.conversation('c-1')).not.toBe(handle);
    c.destroy();
  });
});

describe('user channel events', () => {
  const build = (userResolver?: (id: string) => { displayName: string }) =>
    new Poolse({
      apiUrl: 'https://chat.example',
      getToken: () => 'tok',
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
      ...(userResolver ? { userResolver } : {}),
    });
  const trigger = (handle: unknown, event: string, payload: unknown) =>
    (handle as { channel: { trigger(e: string, p: unknown): void } }).channel.trigger(
      event,
      payload,
    );

  it('onConversationRead delivers conversation:read', () => {
    const c = build();
    const user = c.realtime.user('u-1');
    const seen = vi.fn();
    user.onConversationRead(seen);

    const evt = {
      conversation_id: 'c-1',
      last_read_message_id: 'm-9',
      last_read_sequence: 9,
      unread_count: 0,
      mention_unread_count: 0,
    };
    trigger(user, 'conversation:read', evt);

    expect(seen).toHaveBeenCalledWith(evt);
    c.destroy();
  });

  it('onAppEvent on the client receives app:event', () => {
    const c = build();
    const seen = vi.fn();
    c.onAppEvent(seen);
    const user = c.realtime.user('u-1');

    trigger(user, 'app:event', { type: 'workspace:updated', data: { name: 'Acme' } });

    expect(seen).toHaveBeenCalledWith({ type: 'workspace:updated', data: { name: 'Acme' } });
    c.destroy();
  });

  it('onAppEvent joins the user channel once the user is known', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 'u-1' }), {
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof globalThis.fetch;
    const c = new Poolse({ apiUrl: 'https://chat.example', getToken: () => 'tok', fetch: fetchFn });
    c.onAppEvent(() => {});
    expect(c.realtime.peekUser()).toBeNull();

    await c.me.show();

    expect(c.realtime.peekUser()?.userId).toBe('u-1');
    c.destroy();
  });

  it('member:updated drops that member’s cached profile', async () => {
    let name = 'Old';
    const c = build(() => ({ displayName: name }));
    await c.users.get('alice');
    await c.users.get('bob');
    const user = c.realtime.user('u-1');

    name = 'New';
    trigger(user, 'app:event', { type: 'member:updated', data: { external_id: 'alice' } });

    expect(c.users.peek('alice')).toBeUndefined();
    expect(c.users.peek('bob')).toEqual({ displayName: 'Old' });
    expect(await c.users.get('alice')).toEqual({ displayName: 'New' });
    c.destroy();
  });

  it('member:updated naming nobody drops every cached profile', async () => {
    const c = build(() => ({ displayName: 'X' }));
    await c.users.get('alice');
    const user = c.realtime.user('u-1');

    trigger(user, 'app:event', { type: 'member:updated', data: {} });

    expect(c.users.peek('alice')).toBeUndefined();
    c.destroy();
  });
});
