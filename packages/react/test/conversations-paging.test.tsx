import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePoolse } from '../src/provider.js';
import { useConversations } from '../src/use-conversations.js';
import { jsonResponse, renderHookWithProvider } from './_helpers.js';

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
  unread_count: 0,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const me = {
  id: 'u-me',
  tenant_id: 't-1',
  external_id: 'me',
  display_name: 'Me',
  custom_data: {},
  is_blocked: false,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

/** `GET /v1/conversations` answered per cursor. */
function pagedFetch(pages: Record<string, () => Response>) {
  const calls: Request[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(
      typeof input === 'string' || input instanceof URL ? input : input.url,
      init,
    );
    calls.push(req);
    const url = new URL(req.url);
    if (url.pathname === '/v1/me') return jsonResponse(me);
    if (url.pathname === '/v1/conversations') {
      const page = pages[url.searchParams.get('cursor') ?? 'first'];
      if (page) return page();
    }
    throw new Error(`unexpected ${req.method} ${url.pathname}${url.search}`);
  });
  return Object.assign(fn as unknown as typeof globalThis.fetch, { calls });
}

const listCalls = (fetchFn: { calls: Request[] }) =>
  fetchFn.calls.filter((r) => new URL(r.url).pathname === '/v1/conversations');

type StatusDriver = { setStatus(s: string): void };

describe('useConversations paging', () => {
  it('loads further pages with loadMore until next_cursor is null', async () => {
    const fetchFn = pagedFetch({
      first: () => jsonResponse({ data: [conv('c-1'), conv('c-2')], next_cursor: 'p2' }),
      p2: () => jsonResponse({ data: [conv('c-2'), conv('c-3')], next_cursor: null }),
    });
    const { result } = renderHookWithProvider(() => useConversations(), fetchFn);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.conversations.map((c) => c.id)).toEqual(['c-1', 'c-2', 'c-3']);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.loadingMore).toBe(false);
    expect(new URL(listCalls(fetchFn)[1]!.url).searchParams.get('cursor')).toBe('p2');

    // Nothing more to load: no request.
    await act(async () => {
      await result.current.loadMore();
    });
    expect(listCalls(fetchFn)).toHaveLength(2);
  });

  it('an unpaged server reports hasMore false', async () => {
    const fetchFn = pagedFetch({ first: () => jsonResponse({ data: [conv('c-1')] }) });
    const { result } = renderHookWithProvider(() => useConversations(), fetchFn);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMore).toBe(false);
    await act(async () => {
      await result.current.loadMore();
    });
    expect(listCalls(fetchFn)).toHaveLength(1);
  });

  it('concurrent loadMore calls share one request', async () => {
    const fetchFn = pagedFetch({
      first: () => jsonResponse({ data: [conv('c-1')], next_cursor: 'p2' }),
      p2: () => jsonResponse({ data: [conv('c-2')], next_cursor: null }),
    });
    const { result } = renderHookWithProvider(() => useConversations(), fetchFn);
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await Promise.all([result.current.loadMore(), result.current.loadMore()]);
    });

    expect(listCalls(fetchFn)).toHaveLength(2);
    expect(result.current.conversations.map((c) => c.id)).toEqual(['c-1', 'c-2']);
  });

  it('a failed loadMore rejects and can be retried', async () => {
    let fail = true;
    const fetchFn = pagedFetch({
      first: () => jsonResponse({ data: [conv('c-1')], next_cursor: 'p2' }),
      p2: () =>
        fail
          ? jsonResponse(
              { error: { code: 'validation_failed', message: 'x', doc_url: '' } },
              { status: 422 },
            )
          : jsonResponse({ data: [conv('c-2')], next_cursor: null }),
    });
    const { result } = renderHookWithProvider(() => useConversations(), fetchFn);
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.loadMore()).rejects.toMatchObject({ status: 422 });
    });
    expect(result.current.hasMore).toBe(true);

    fail = false;
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.conversations.map((c) => c.id)).toEqual(['c-1', 'c-2']);
  });

  it('a reconnect refreshes page one and keeps later pages', async () => {
    let firstPage = [conv('c-1'), conv('c-2')];
    const fetchFn = pagedFetch({
      first: () => jsonResponse({ data: firstPage, next_cursor: 'p2' }),
      p2: () => jsonResponse({ data: [conv('c-3')], next_cursor: 'p3' }),
    });
    const { result } = renderHookWithProvider(() => {
      const chat = usePoolse();
      return { chat, list: useConversations() };
    }, fetchFn);
    await waitFor(() => expect(result.current.list.loading).toBe(false));
    await waitFor(() => expect(result.current.chat.realtime.peekUser()).not.toBeNull());
    await act(async () => {
      await result.current.list.loadMore();
    });

    // c-3 became active and moved to page one.
    firstPage = [conv('c-3'), conv('c-1')];
    const realtime = result.current.chat.realtime as unknown as StatusDriver;
    act(() => realtime.setStatus('connected'));
    act(() => realtime.setStatus('reconnecting'));
    act(() => realtime.setStatus('connected'));

    await waitFor(() =>
      expect(result.current.list.conversations.map((c) => c.id)).toEqual(['c-3', 'c-1', 'c-2']),
    );
    // The cursor of the next unloaded page survives.
    expect(result.current.list.hasMore).toBe(true);
  });
});
