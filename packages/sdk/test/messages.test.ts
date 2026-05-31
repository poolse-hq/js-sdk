import { describe, expect, it } from 'vitest';
import { bodyJson, buildPoolse, jsonResponse, noContent, scriptedFetch } from './_helpers.js';

const baseMsg = {
  id: 'm-1',
  tenant_id: 't-1',
  conversation_id: 'c-1',
  sender_id: 'u-1',
  type: 'text' as const,
  body: 'hello',
  reply_to_id: null,
  thread_root_id: null,
  mentions: [],
  reactions: {},
  edited_at: null,
  deleted_at: null,
  sequence: 1,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('ConversationMessages', () => {
  it('list → GET with limit + before query params', async () => {
    const fetchFn = scriptedFetch([jsonResponse({ data: [baseMsg] })]);
    const chat = buildPoolse(fetchFn);

    await chat.conversations.one('c-1').messages.list({ limit: 25, before: 100 });

    const url = new URL(fetchFn.calls[0]!.url);
    expect(url.pathname).toBe('/v1/conversations/c-1/messages');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('before')).toBe('100');
  });

  describe('send (client_msg_id wiring)', () => {
    it('auto-fills `id` with a UUID when caller omits it', async () => {
      const fetchFn = scriptedFetch([jsonResponse(baseMsg, { status: 201 })]);
      const chat = buildPoolse(fetchFn);

      await chat.conversations.one('c-1').messages.send({ body: 'hello' });

      const body = (await bodyJson(fetchFn.calls[0]!)) as { body: string; id: string };
      expect(body.body).toBe('hello');
      expect(body.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('preserves an explicit `id` when caller provides one (idempotency-safe retries)', async () => {
      const fetchFn = scriptedFetch([jsonResponse(baseMsg, { status: 201 })]);
      const chat = buildPoolse(fetchFn);

      await chat.conversations.one('c-1').messages.send({
        body: 'hello',
        id: '00000000-0000-4000-8000-000000000001',
      });

      const body = (await bodyJson(fetchFn.calls[0]!)) as { id: string };
      expect(body.id).toBe('00000000-0000-4000-8000-000000000001');
    });

    it('POSTs to the right path with the body content-type', async () => {
      const fetchFn = scriptedFetch([jsonResponse(baseMsg, { status: 201 })]);
      const chat = buildPoolse(fetchFn);

      await chat.conversations
        .one('c-1')
        .messages.send({ body: 'hi', mentions: ['u-2'], reply_to_id: 'm-0' });

      expect(fetchFn.calls[0]?.method).toBe('POST');
      expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/conversations/c-1/messages');
      expect(fetchFn.calls[0]?.headers.get('content-type')).toBe('application/json');
      const body = (await bodyJson(fetchFn.calls[0]!)) as Record<string, unknown>;
      expect(body.body).toBe('hi');
      expect(body.mentions).toEqual(['u-2']);
      expect(body.reply_to_id).toBe('m-0');
    });
  });

  it('markRead → POST /v1/conversations/:id/read with {message_id}', async () => {
    const fetchFn = scriptedFetch([noContent()]);
    const chat = buildPoolse(fetchFn);

    await chat.conversations.one('c-1').messages.markRead('m-5');

    expect(fetchFn.calls[0]?.method).toBe('POST');
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/conversations/c-1/read');
    expect(await bodyJson(fetchFn.calls[0]!)).toEqual({ message_id: 'm-5' });
  });
});

describe('MessageHandle', () => {
  it('update → PATCH /v1/messages/:id', async () => {
    const fetchFn = scriptedFetch([jsonResponse({ ...baseMsg, body: 'edited' })]);
    const chat = buildPoolse(fetchFn);

    await chat.messages.one('m-1').update({ body: 'edited' });

    expect(fetchFn.calls[0]?.method).toBe('PATCH');
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/messages/m-1');
    expect(await bodyJson(fetchFn.calls[0]!)).toEqual({ body: 'edited' });
  });

  it('delete → DELETE /v1/messages/:id (idempotent — server returns 204 even on repeat)', async () => {
    const fetchFn = scriptedFetch([noContent()]);
    const chat = buildPoolse(fetchFn);

    await chat.messages.one('m-1').delete();

    expect(fetchFn.calls[0]?.method).toBe('DELETE');
  });

  it('replies → GET /v1/messages/:id/replies with cursor params', async () => {
    const fetchFn = scriptedFetch([jsonResponse({ data: [baseMsg] })]);
    const chat = buildPoolse(fetchFn);

    await chat.messages.one('m-1').replies({ limit: 10, after: 50 });

    const url = new URL(fetchFn.calls[0]!.url);
    expect(url.pathname).toBe('/v1/messages/m-1/replies');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.get('after')).toBe('50');
  });

  it('addReaction → POST /v1/messages/:id/reactions with {emoji}', async () => {
    const fetchFn = scriptedFetch([jsonResponse(baseMsg)]);
    const chat = buildPoolse(fetchFn);

    await chat.messages.one('m-1').addReaction('🎉');

    expect(fetchFn.calls[0]?.method).toBe('POST');
    expect(await bodyJson(fetchFn.calls[0]!)).toEqual({ emoji: '🎉' });
  });

  it('removeReaction → DELETE with URL-encoded emoji (multi-byte safe)', async () => {
    const fetchFn = scriptedFetch([jsonResponse(baseMsg)]);
    const chat = buildPoolse(fetchFn);

    await chat.messages.one('m-1').removeReaction('🎉');

    expect(fetchFn.calls[0]?.method).toBe('DELETE');
    expect(fetchFn.calls[0]?.url).toBe(
      `https://chat.test/v1/messages/m-1/reactions/${encodeURIComponent('🎉')}`,
    );
  });
});
