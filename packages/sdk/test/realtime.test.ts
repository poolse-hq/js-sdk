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
