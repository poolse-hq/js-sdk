import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  applyThreadUpdate,
  isTombstone,
  markQuoteDeleted,
  mergeMessage,
  Poolse,
  toTombstone,
  type Message,
} from '../src/index.js';
import { bodyJson, buildPoolse, jsonResponse, scriptedFetch } from './_helpers.js';

const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm-1',
  tenant_id: 't-1',
  conversation_id: 'c-1',
  sender_id: 'u-1',
  sender_external_id: 'one',
  type: 'text',
  body: 'see https://example.com/a',
  reply_to_id: null,
  thread_root_id: null,
  mentions: ['u-2'],
  reactions: { '👍': ['u-2'] },
  attachments: [],
  link_previews: [],
  edited_at: null,
  deleted_at: null,
  sequence: 1,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
});

const errorBody = (code: string) => ({ error: { code, message: code, doc_url: '' } });

describe('messages: get / edits / update', () => {
  it('get → GET /v1/messages/:id', async () => {
    const tomb = msg({ deleted_at: '2026-01-02T00:00:00Z', body: null });
    const fetchFn = scriptedFetch([jsonResponse(tomb)]);
    const chat = buildPoolse(fetchFn);

    const got = await chat.messages.get('m-1');

    expect(fetchFn.calls[0]?.method).toBe('GET');
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/messages/m-1');
    expect(isTombstone(got)).toBe(true);
  });

  it('get surfaces 403 / 404 as ApiError', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse(errorBody('forbidden'), { status: 403 }),
      jsonResponse(errorBody('not_found'), { status: 404 }),
    ]);
    const chat = buildPoolse(fetchFn);

    await expect(chat.messages.one('m-1').get()).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    });
    await expect(chat.messages.get('m-1')).rejects.toBeInstanceOf(ApiError);
  });

  it('edits → GET /v1/messages/:id/edits', async () => {
    const list = {
      data: [
        {
          version: 1,
          body: 'first',
          written_at: '2026-01-01T00:00:00Z',
          replaced_at: '2026-01-01T00:01:00Z',
          editor_id: 'u-1',
        },
      ],
      current_version: 2,
      edited_at: '2026-01-01T00:01:00Z',
    };
    const fetchFn = scriptedFetch([jsonResponse(list)]);
    const chat = buildPoolse(fetchFn);

    const got = await chat.messages.edits('m-1');

    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/messages/m-1/edits');
    expect(got.current_version).toBe(2);
    expect(got.data[0]?.body).toBe('first');
  });

  it('update with remove_link_previews: list or true', async () => {
    const fetchFn = scriptedFetch([jsonResponse(msg()), jsonResponse(msg())]);
    const chat = buildPoolse(fetchFn);

    await chat.messages.update('m-1', { remove_link_previews: ['https://example.com/a'] });
    await chat.messages.one('m-1').update({ body: 'x', remove_link_previews: true });

    expect(fetchFn.calls[0]?.method).toBe('PATCH');
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/messages/m-1');
    expect(await bodyJson(fetchFn.calls[0]!)).toEqual({
      remove_link_previews: ['https://example.com/a'],
    });
    expect(await bodyJson(fetchFn.calls[1]!)).toEqual({ body: 'x', remove_link_previews: true });
  });

  it('update on a deleted message → 409 message_deleted', async () => {
    const fetchFn = scriptedFetch([jsonResponse(errorBody('message_deleted'), { status: 409 })]);
    const chat = buildPoolse(fetchFn);

    await expect(chat.messages.update('m-1', { body: 'x' })).rejects.toMatchObject({
      status: 409,
      code: 'message_deleted',
    });
  });

  it('send quoting a deleted message → 422 quoted_message_deleted', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse(errorBody('quoted_message_deleted'), { status: 422 }),
    ]);
    const chat = buildPoolse(fetchFn);

    const err = await chat.conversations
      .one('c-1')
      .messages.send({ body: 'hi', quoted_message_id: 'm-0' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('quoted_message_deleted');
  });
});

describe('include_deleted', () => {
  it('history passes include_deleted=true only when asked', async () => {
    const fetchFn = scriptedFetch([jsonResponse({ data: [] }), jsonResponse({ data: [] })]);
    const chat = buildPoolse(fetchFn);

    await chat.conversations.one('c-1').messages.list({ limit: 10, include_deleted: true });
    await chat.conversations.one('c-1').messages.list({ limit: 10 });

    expect(new URL(fetchFn.calls[0]!.url).searchParams.get('include_deleted')).toBe('true');
    expect(new URL(fetchFn.calls[1]!.url).searchParams.has('include_deleted')).toBe(false);
  });

  it('replies pass include_deleted=true', async () => {
    const fetchFn = scriptedFetch([jsonResponse({ data: [] })]);
    const chat = buildPoolse(fetchFn);

    await chat.messages.one('m-1').replies({ after: 3, include_deleted: true });

    const url = new URL(fetchFn.calls[0]!.url);
    expect(url.pathname).toBe('/v1/messages/m-1/replies');
    expect(url.searchParams.get('after')).toBe('3');
    expect(url.searchParams.get('include_deleted')).toBe('true');
  });
});

describe('message-state helpers', () => {
  it('toTombstone strips content, keeps identity and thread fields', () => {
    const t = toTombstone(
      msg({ reply_count: 2, thread_participants: [{ user_id: 'u-2', external_id: 'two' }] }),
      '2026-01-02T00:00:00Z',
    );
    expect(t).toMatchObject({
      id: 'm-1',
      sequence: 1,
      sender_id: 'u-1',
      body: null,
      mentions: [],
      reactions: {},
      attachments: [],
      link_previews: [],
      quoted_message: null,
      reply_count: 2,
      deleted_at: '2026-01-02T00:00:00Z',
    });
  });

  it('mergeMessage takes link previews from message:updated', () => {
    const preview = { url: 'https://example.com/a', type: 'website' as const, title: 'A' };
    const next = mergeMessage(
      msg({ reply_count: 3 }),
      msg({ link_previews: [preview], reply_count: 3 }),
    );
    expect(next.link_previews).toEqual([preview]);
  });

  it('mergeMessage keeps fields an older payload leaves out', () => {
    const prev = msg({
      reply_count: 4,
      last_reply_at: '2026-01-01T00:05:00Z',
      link_previews: [{ url: 'https://example.com/a', type: 'website' }],
    });
    const legacy = msg({ body: 'edited', reply_count: 0 });
    delete (legacy as Partial<Message>).link_previews;

    const next = mergeMessage(prev, legacy);

    expect(next.body).toBe('edited');
    expect(next.reply_count).toBe(4);
    expect(next.link_previews).toHaveLength(1);
  });

  it('mergeMessage trusts a real summary of 0', () => {
    const next = mergeMessage(
      msg({ reply_count: 1 }),
      msg({ reply_count: 0, last_reply_at: null, thread_participants: [] }),
    );
    expect(next.reply_count).toBe(0);
  });

  it('applyThreadUpdate sets the summary', () => {
    const next = applyThreadUpdate(msg(), {
      message_id: 'm-1',
      conversation_id: 'c-1',
      reply_count: 5,
      last_reply_at: '2026-01-03T00:00:00Z',
      thread_participants: [{ user_id: 'u-3', external_id: 'three' }],
    });
    expect(next).toMatchObject({
      reply_count: 5,
      last_reply_at: '2026-01-03T00:00:00Z',
      thread_participants: [{ user_id: 'u-3', external_id: 'three' }],
    });
  });

  it('markQuoteDeleted only touches quotes of that message', () => {
    const quoting = msg({
      id: 'm-2',
      quoted_message_id: 'm-1',
      quoted_message: {
        id: 'm-1',
        sender_id: 'u-1',
        sender_external_id: 'one',
        body: 'hello',
        deleted_at: null,
        inserted_at: '2026-01-01T00:00:00Z',
      },
    });
    const other = msg({ id: 'm-3' });

    expect(markQuoteDeleted(quoting, 'm-1', '2026-01-02T00:00:00Z').quoted_message).toMatchObject({
      body: null,
      deleted_at: '2026-01-02T00:00:00Z',
    });
    expect(markQuoteDeleted(other, 'm-1', null)).toBe(other);
  });
});

describe('ConversationChannel.onThreadUpdated', () => {
  it('delivers thread:updated', () => {
    const chat = new Poolse({
      apiUrl: 'https://chat.example',
      getToken: () => 'tok',
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
    });
    const conv = chat.realtime.conversation('c-1');
    const seen = vi.fn();
    conv.onThreadUpdated(seen);

    const evt = {
      message_id: 'm-1',
      conversation_id: 'c-1',
      reply_count: 1,
      last_reply_at: '2026-01-01T00:00:00Z',
      thread_participants: [{ user_id: 'u-2', external_id: 'two' }],
    };
    (conv as unknown as { channel: { trigger(e: string, p: unknown): void } }).channel.trigger(
      'thread:updated',
      evt,
    );

    expect(seen).toHaveBeenCalledWith(evt);
    chat.destroy();
  });
});
