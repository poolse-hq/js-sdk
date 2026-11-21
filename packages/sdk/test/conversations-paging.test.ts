import { describe, expect, it } from 'vitest';
import { buildPoolse, jsonResponse, scriptedFetch } from './_helpers.js';

const conv = (id: string) => ({
  id,
  tenant_id: 't-1',
  type: 'group' as const,
  name: id,
  avatar_url: null,
  created_by_user_id: 'u-1',
  member_limit: null,
  custom_data: {},
  settings: {},
  last_message_at: null,
  last_message_preview: null,
  last_sequence: 0,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

describe('conversations.list paging', () => {
  it('passes cursor and limit, returns next_cursor', async () => {
    const fetchFn = scriptedFetch([jsonResponse({ data: [conv('c-2')], next_cursor: 'cur-3' })]);
    const chat = buildPoolse(fetchFn);

    const page = await chat.conversations.list({ cursor: 'cur-2', limit: 1 });

    const url = new URL(fetchFn.calls[0]!.url);
    expect(url.pathname).toBe('/v1/conversations');
    expect(url.searchParams.get('cursor')).toBe('cur-2');
    expect(url.searchParams.get('limit')).toBe('1');
    expect(page.next_cursor).toBe('cur-3');
  });

  it('still accepts a bare AbortSignal', async () => {
    const fetchFn = scriptedFetch([jsonResponse({ data: [], next_cursor: null })]);
    const chat = buildPoolse(fetchFn);

    await chat.conversations.list(new AbortController().signal);

    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/conversations');
  });

  it('surfaces 422 for a bad cursor', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse(
        { error: { code: 'validation_failed', message: 'Invalid cursor.', doc_url: '' } },
        { status: 422 },
      ),
    ]);
    const chat = buildPoolse(fetchFn);

    await expect(chat.conversations.list({ cursor: 'nope' })).rejects.toMatchObject({
      status: 422,
      code: 'validation_failed',
    });
  });

  it('listAll walks every page until next_cursor is null', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [conv('c-1'), conv('c-2')], next_cursor: 'p2' }),
      jsonResponse({ data: [conv('c-3')], next_cursor: null }),
    ]);
    const chat = buildPoolse(fetchFn);

    const ids: string[] = [];
    for await (const c of chat.conversations.listAll({ limit: 2 })) ids.push(c.id);

    expect(ids).toEqual(['c-1', 'c-2', 'c-3']);
    expect(new URL(fetchFn.calls[0]!.url).searchParams.has('cursor')).toBe(false);
    expect(new URL(fetchFn.calls[0]!.url).searchParams.get('limit')).toBe('2');
    expect(new URL(fetchFn.calls[1]!.url).searchParams.get('cursor')).toBe('p2');
  });

  it('listAll stops after one page on a server without next_cursor', async () => {
    const fetchFn = scriptedFetch([jsonResponse({ data: [conv('c-1')] })]);
    const chat = buildPoolse(fetchFn);

    const ids: string[] = [];
    for await (const c of chat.conversations.listAll()) ids.push(c.id);

    expect(ids).toEqual(['c-1']);
    expect(fetchFn.calls).toHaveLength(1);
  });

  it('listAll can stop early without fetching more', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [conv('c-1'), conv('c-2')], next_cursor: 'p2' }),
    ]);
    const chat = buildPoolse(fetchFn);

    for await (const c of chat.conversations.listAll()) {
      if (c.id === 'c-1') break;
    }

    expect(fetchFn.calls).toHaveLength(1);
  });
});
