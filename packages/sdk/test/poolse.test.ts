import { describe, expect, it, vi } from 'vitest';
import { Poolse } from '../src/index.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('Poolse client', () => {
  it('constructs with required config', () => {
    const chat = new Poolse({
      apiUrl: 'https://chat.example.com',
      getToken: () => 'tok',
      fetch: vi.fn(),
    });

    expect(chat.me).toBeDefined();
    expect(chat.conversations).toBeDefined();
    expect(chat.messages).toBeDefined();
    expect(chat.rest).toBeDefined();
  });

  it('defaults apiUrl to the hosted poolse endpoint when not provided', () => {
    // No apiUrl — should not throw and should resolve to api.poolse.dev.
    const chat = new Poolse({ getToken: () => 'tok' });
    expect(chat.realtime).toBeDefined();
  });

  it('throws if getToken is missing', () => {
    expect(
      () =>
        // @ts-expect-error — deliberately missing required field
        new Poolse({ apiUrl: 'https://x' }),
    ).toThrow(/getToken/);
  });

  describe('me.show', () => {
    it('GETs /v1/me with the Bearer token', async () => {
      const fetchFn = vi.fn(async () =>
        jsonResponse({
          id: 'u-1',
          tenant_id: 't-1',
          external_id: 'alice',
          display_name: 'Alice',
          custom_data: {},
          is_blocked: false,
          inserted_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        }),
      ) as unknown as typeof globalThis.fetch;

      const chat = new Poolse({
        apiUrl: 'https://chat.example.com',
        getToken: async () => 'jwt-1',
        fetch: fetchFn,
      });

      const me = await chat.me.show();
      expect(me.id).toBe('u-1');
      const [url, init] = (fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock
        .calls[0]!;
      expect(url).toBe('https://chat.example.com/v1/me');
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer jwt-1');
    });
  });

  describe('conversations.create', () => {
    it('POSTs the body and returns the created conversation', async () => {
      const created = {
        id: 'c-1',
        tenant_id: 't-1',
        type: 'group',
        name: 'engineering',
        metadata: {},
        last_sequence: 0,
        last_message_at: null,
        inserted_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
      const fetchFn = vi.fn(async () =>
        jsonResponse(created, { status: 201 }),
      ) as unknown as typeof globalThis.fetch;

      const chat = new Poolse({
        apiUrl: 'https://chat.example.com',
        getToken: () => 'jwt-2',
        fetch: fetchFn,
      });

      const conv = await chat.conversations.create({ type: 'group', name: 'engineering' });
      expect(conv).toEqual(created);

      const [url, init] = (fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock
        .calls[0]!;
      expect(url).toBe('https://chat.example.com/v1/conversations');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({ type: 'group', name: 'engineering' });
    });
  });

  describe('messages handle', () => {
    it('addReaction POSTs to /v1/messages/:id/reactions', async () => {
      const fetchFn = vi.fn(async () => jsonResponse({ id: 'm-1', reactions: { '👍': ['u-1'] } }));

      const chat = new Poolse({
        apiUrl: 'https://chat.example.com',
        getToken: () => 'jwt',
        fetch: fetchFn as unknown as typeof globalThis.fetch,
      });

      await chat.messages.one('m-1').addReaction('👍');

      const [url, init] = (fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock
        .calls[0]!;
      expect(url).toBe('https://chat.example.com/v1/messages/m-1/reactions');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({ emoji: '👍' });
    });

    it('removeReaction URL-encodes the emoji path segment', async () => {
      const fetchFn = vi.fn(async () => jsonResponse({ id: 'm-1', reactions: {} }));

      const chat = new Poolse({
        apiUrl: 'https://chat.example.com',
        getToken: () => 'jwt',
        fetch: fetchFn as unknown as typeof globalThis.fetch,
      });

      await chat.messages.one('m-1').removeReaction('👍');

      const [url] = (fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock
        .calls[0]!;
      // %F0%9F%91%8D is the UTF-8 encoded thumbs-up.
      expect(url).toBe('https://chat.example.com/v1/messages/m-1/reactions/%F0%9F%91%8D');
    });
  });
});
