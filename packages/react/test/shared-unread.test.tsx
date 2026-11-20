// The conversation list is shared by every hook under one provider:
// reading a conversation anywhere clears its badge everywhere.

import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PoolseProvider, usePoolse } from '../src/provider.js';
import { useAppEvent } from '../src/use-app-event.js';
import { useConversations } from '../src/use-conversations.js';
import { useMessages } from '../src/use-messages.js';
import { jsonResponse, noContent, renderHookWithProvider } from './_helpers.js';

const conv = (id: string, unread: number, mentions = 0) => ({
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
  last_sequence: 10,
  unread_count: unread,
  mention_unread_count: mentions,
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

const msg = (id: string, sequence: number) => ({
  id,
  tenant_id: 't-1',
  conversation_id: 'c-1',
  sender_id: 'u-2',
  sender_external_id: 'two',
  type: 'text',
  body: `m${sequence}`,
  reply_to_id: null,
  thread_root_id: null,
  mentions: [],
  reactions: {},
  edited_at: null,
  deleted_at: null,
  sequence,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

/** Answers by method + path, so hooks may fetch in any order. */
function routedFetch(routes: Record<string, (req: Request) => Response>) {
  const calls: Request[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(
      typeof input === 'string' || input instanceof URL ? input : input.url,
      init,
    );
    calls.push(req);
    const url = new URL(req.url);
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) throw new Error(`unexpected ${req.method} ${url.pathname}`);
    return route(req);
  });
  return Object.assign(fn as unknown as typeof globalThis.fetch, { calls });
}

type Triggerable = { channel: { trigger(event: string, payload: unknown): void } };

describe('shared conversation list', () => {
  it('exposes unreadCounts and mentionUnreadCounts', async () => {
    const fetchFn = routedFetch({
      'GET /v1/me': () => jsonResponse(me),
      'GET /v1/conversations': () =>
        jsonResponse({ data: [conv('c-1', 3, 1), conv('c-2', 0), conv('c-3', 2)] }),
    });
    const { result } = renderHookWithProvider(() => useConversations(), fetchFn);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.unreadCounts).toEqual({ 'c-1': 3, 'c-3': 2 });
    expect(result.current.mentionUnreadCounts).toEqual({ 'c-1': 1 });
  });

  it('two hooks share one list and one fetch', async () => {
    const fetchFn = routedFetch({
      'GET /v1/me': () => jsonResponse(me),
      'GET /v1/conversations': () => jsonResponse({ data: [conv('c-1', 3, 1)] }),
    });
    const { result } = renderHookWithProvider(
      () => ({ sidebar: useConversations(), header: useConversations() }),
      fetchFn,
    );

    await waitFor(() => expect(result.current.header.loading).toBe(false));
    expect(fetchFn.calls.filter((r) => r.url.endsWith('/v1/conversations'))).toHaveLength(1);

    act(() => result.current.sidebar.markConversationRead('c-1'));

    expect(result.current.header.unreadCounts).toEqual({});
    expect(result.current.header.mentionUnreadCounts).toEqual({});
  });

  it('markReadUpTo in a conversation view zeroes the list badge', async () => {
    const fetchFn = routedFetch({
      'GET /v1/me': () => jsonResponse(me),
      'GET /v1/conversations': () => jsonResponse({ data: [conv('c-1', 2, 1), conv('c-2', 4)] }),
      'GET /v1/conversations/c-1/messages': () => jsonResponse({ data: [msg('m2', 2)] }),
      'POST /v1/conversations/c-1/read': () => noContent(),
    });
    const { result } = renderHookWithProvider(
      () => ({ list: useConversations(), view: useMessages('c-1') }),
      fetchFn,
    );
    await waitFor(() => expect(result.current.list.loading).toBe(false));
    await waitFor(() => expect(result.current.view.loading).toBe(false));
    expect(result.current.list.unreadCounts['c-1']).toBe(2);

    await act(async () => {
      await result.current.view.markReadUpTo('m2');
    });

    expect(result.current.list.unreadCounts).toEqual({ 'c-2': 4 });
    expect(result.current.list.mentionUnreadCounts).toEqual({});
  });

  it('a failed markReadUpTo leaves the badge', async () => {
    const fetchFn = routedFetch({
      'GET /v1/me': () => jsonResponse(me),
      'GET /v1/conversations': () => jsonResponse({ data: [conv('c-1', 2)] }),
      'GET /v1/conversations/c-1/messages': () => jsonResponse({ data: [msg('m2', 2)] }),
      'POST /v1/conversations/c-1/read': () =>
        jsonResponse({ error: { code: 'forbidden', message: 'no', doc_url: '' } }, { status: 403 }),
    });
    const { result } = renderHookWithProvider(
      () => ({ list: useConversations(), view: useMessages('c-1') }),
      fetchFn,
    );
    await waitFor(() => expect(result.current.list.loading).toBe(false));

    await act(async () => {
      await result.current.view.markReadUpTo('m2').catch(() => {});
    });

    expect(result.current.list.unreadCounts).toEqual({ 'c-1': 2 });
  });

  it('applies conversation:read from the user channel', async () => {
    const fetchFn = routedFetch({
      'GET /v1/me': () => jsonResponse(me),
      'GET /v1/conversations': () => jsonResponse({ data: [conv('c-1', 5, 2)] }),
    });
    const { result } = renderHookWithProvider(
      () => ({ chat: usePoolse(), list: useConversations() }),
      fetchFn,
    );
    await waitFor(() => expect(result.current.list.loading).toBe(false));
    await waitFor(() => expect(result.current.chat.realtime.peekUser()).not.toBeNull());
    const user = result.current.chat.realtime.peekUser() as unknown as Triggerable;

    act(() =>
      user.channel.trigger('conversation:read', {
        conversation_id: 'c-1',
        last_read_message_id: 'm-9',
        last_read_sequence: 9,
        unread_count: 1,
        mention_unread_count: 0,
      }),
    );

    expect(result.current.list.unreadCounts).toEqual({ 'c-1': 1 });
    expect(result.current.list.mentionUnreadCounts).toEqual({});
  });

  it('takes mention_unread_count from conversation:updated', async () => {
    const fetchFn = routedFetch({
      'GET /v1/me': () => jsonResponse(me),
      'GET /v1/conversations': () => jsonResponse({ data: [conv('c-1', 0)] }),
    });
    const { result } = renderHookWithProvider(
      () => ({ chat: usePoolse(), list: useConversations() }),
      fetchFn,
    );
    await waitFor(() => expect(result.current.chat.realtime.peekUser()).not.toBeNull());
    await waitFor(() => expect(result.current.list.loading).toBe(false));
    const user = result.current.chat.realtime.peekUser() as unknown as Triggerable;

    act(() =>
      user.channel.trigger('conversation:updated', {
        conversation: conv('c-1', 1, 1),
        by_user_id: 'u-2',
      }),
    );

    expect(result.current.list.unreadCounts).toEqual({ 'c-1': 1 });
    expect(result.current.list.mentionUnreadCounts).toEqual({ 'c-1': 1 });
  });

  it('keeps the rows for the next mount and refreshes quietly', async () => {
    let unread = 3;
    const fetchFn = routedFetch({
      'GET /v1/me': () => jsonResponse(me),
      'GET /v1/conversations': () => jsonResponse({ data: [conv('c-1', unread)] }),
    });
    const seen: Array<ReturnType<typeof useConversations>> = [];
    function Probe() {
      seen.push(useConversations());
      return null;
    }
    function Screen({ show }: { show: boolean }) {
      return show ? <Probe /> : null;
    }
    const { rerender } = render(
      <PoolseProvider
        config={{ apiUrl: 'https://chat.test', getToken: () => 'jwt', fetch: fetchFn }}
      >
        <Screen show />
      </PoolseProvider>,
    );
    await waitFor(() => expect(seen.at(-1)?.loading).toBe(false));

    const remount = (show: boolean) =>
      rerender(
        <PoolseProvider
          config={{ apiUrl: 'https://chat.test', getToken: () => 'jwt', fetch: fetchFn }}
        >
          <Screen show={show} />
        </PoolseProvider>,
      );
    remount(false);
    unread = 0;
    seen.length = 0;
    remount(true);

    // The old rows straight away, without a loading flash…
    expect(seen[0]?.loading).toBe(false);
    expect(seen[0]?.unreadCounts).toEqual({ 'c-1': 3 });
    // …then the fresh ones.
    await waitFor(() => expect(seen.at(-1)?.unreadCounts).toEqual({}));
  });
});

describe('useAppEvent', () => {
  it('delivers app:event to the latest handler', async () => {
    const fetchFn = routedFetch({ 'GET /v1/me': () => jsonResponse(me) });
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHookWithProvider(
      ({ fn }: { fn: (e: unknown) => void }) => {
        const chat = usePoolse();
        useAppEvent(fn);
        return chat;
      },
      fetchFn,
      { initialProps: { fn: first } },
    );
    await act(async () => {
      await result.current.me.show();
    });
    rerender({ fn: second });
    const user = result.current.realtime.peekUser() as unknown as Triggerable;

    act(() => user.channel.trigger('app:event', { type: 'workspace:updated', data: {} }));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ type: 'workspace:updated', data: {} });
  });
});
