// Several clients side by side, a warm cache that outlives a provider,
// the outbox in the message list, unread totals and the catch-up queue.

import { act, render, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Poolse } from '@poolse/sdk';
import { PoolseProvider, usePoolse } from '../src/provider.js';
import { useConversations } from '../src/use-conversations.js';
import { useMessages } from '../src/use-messages.js';
import { orderUnread, useUnreadQueue, useUnreadTotals } from '../src/use-unread.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Handler = (method: string, path: string, body: unknown) => Response | Promise<Response>;

function routed(handler: Handler) {
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

const conv = (id: string, unread: number, mentions = 0, at = '2026-11-21T10:00:00Z') => ({
  id,
  tenant_id: 't-1',
  type: 'group' as const,
  name: id,
  avatar_url: null,
  created_by_user_id: 'u-1',
  member_limit: null,
  custom_data: {},
  settings: {},
  last_message_at: at,
  last_message_preview: null,
  last_sequence: 10,
  unread_count: unread,
  mention_unread_count: mentions,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const msg = (id: string, sequence: number, conversationId = 'c-1') => ({
  id,
  tenant_id: 't-1',
  conversation_id: conversationId,
  sender_id: 'u-2',
  sender_external_id: 'two',
  type: 'text' as const,
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

const me = { id: 'u-me', tenant_id: 't-1', external_id: 'me', custom_data: {} };

const client = (fetchFn: typeof globalThis.fetch, apiUrl = 'https://a.test') =>
  new Poolse({ apiUrl, getToken: () => 'jwt', fetch: fetchFn, maxRetries: 0 });

const wrap =
  (chat: Poolse) =>
  ({ children }: { children: ReactNode }) => (
    <PoolseProvider client={chat} trackActivity={false}>
      {children}
    </PoolseProvider>
  );

describe('PoolseProvider with a client', () => {
  it('providers side by side each see their own client and conversation list', async () => {
    const a = client(routed(() => json({ data: [conv('a-1', 1)], next_cursor: null })));
    const b = client(
      routed(() => json({ data: [conv('b-1', 2)], next_cursor: null })),
      'https://b.test',
    );
    const seen: Record<string, string[]> = {};
    function List({ name }: { name: string }) {
      const chat = usePoolse();
      const { conversations } = useConversations();
      seen[name] = [chat.apiUrl, ...conversations.map((c) => c.id)];
      return null;
    }
    render(
      <>
        <PoolseProvider client={a} trackActivity={false}>
          <List name="a" />
        </PoolseProvider>
        <PoolseProvider client={b} trackActivity={false}>
          <List name="b" />
        </PoolseProvider>
      </>,
    );
    await waitFor(() => expect(seen['a']).toEqual(['https://a.test', 'a-1']));
    expect(seen['b']).toEqual(['https://b.test', 'b-1']);
    await Promise.all([a.destroy(), b.destroy()]);
  });

  it('leaves a client it was given running on unmount, and its list warm', async () => {
    const fetchFn = routed(() => json({ data: [conv('c-1', 1)], next_cursor: null }));
    const chat = client(fetchFn);
    const first = renderHook(() => useConversations(), { wrapper: wrap(chat) });
    await waitFor(() => expect(first.result.current.conversations).toHaveLength(1));
    first.unmount();
    expect(chat.destroyed).toBe(false);

    // Mounted again: the rows are there on the first render.
    const again = renderHook(() => useConversations(), { wrapper: wrap(chat) });
    expect(again.result.current.loading).toBe(false);
    expect(again.result.current.conversations.map((c) => c.id)).toEqual(['c-1']);
    again.unmount();
    await chat.destroy();
  });

  it('destroys a client it built from config', async () => {
    let built: Poolse | null = null;
    function Grab() {
      built = usePoolse();
      return null;
    }
    const { unmount } = render(
      <PoolseProvider
        config={{ apiUrl: 'https://a.test', getToken: () => 'jwt', fetch: routed(() => json({})) }}
        trackActivity={false}
      >
        <Grab />
      </PoolseProvider>,
    );
    unmount();
    // Right after the unmount (a StrictMode remount would cancel it).
    await new Promise((r) => setTimeout(r, 0));
    expect(built!.destroyed).toBe(true);
  });

  it('background prop pauses and resumes the client', () => {
    const chat = client(routed(() => json({})));
    const spy = vi.spyOn(chat, 'setBackground');
    const { rerender } = render(
      <PoolseProvider client={chat} background trackActivity={false}>
        <span />
      </PoolseProvider>,
    );
    expect(chat.isBackground()).toBe(true);
    rerender(
      <PoolseProvider client={chat} background={false} trackActivity={false}>
        <span />
      </PoolseProvider>,
    );
    expect(spy).toHaveBeenLastCalledWith(false);
    expect(chat.isBackground()).toBe(false);
    void chat.destroy();
  });
});

describe('useMessages warm cache and outbox', () => {
  it('shows cached messages at once when a conversation is opened again', async () => {
    let release: (() => void) | null = null;
    let calls = 0;
    const fetchFn = routed(async (_m, path) => {
      if (!path.endsWith('/messages')) return json(me);
      calls += 1;
      if (calls === 1) return json({ data: [msg('m-2', 2), msg('m-1', 1)] });
      // The second load hangs: the cache must carry the first render.
      await new Promise<void>((r) => (release = r));
      return json({ data: [msg('m-3', 3), msg('m-2', 2), msg('m-1', 1)] });
    });
    const chat = client(fetchFn);
    const first = renderHook(() => useMessages('c-1'), { wrapper: wrap(chat) });
    await waitFor(() => expect(first.result.current.messages).toHaveLength(2));
    first.unmount();

    const again = renderHook(() => useMessages('c-1'), { wrapper: wrap(chat) });
    expect(again.result.current.loading).toBe(false);
    expect(again.result.current.fromCache).toBe(true);
    expect(again.result.current.messages.map((m) => m.id)).toEqual(['m-1', 'm-2']);
    await waitFor(() => expect(release).not.toBeNull());
    await act(async () => release!());
    await waitFor(() => expect(again.result.current.messages).toHaveLength(3));
    expect(again.result.current.fromCache).toBe(false);
    expect(chat.timings.peek('cachedMessages')).toBeDefined();
    again.unmount();
    await chat.destroy();
  });

  it('keeps an offline send as queued and delivers it on retry', async () => {
    let online = false;
    const fetchFn = routed((method, _path, body) => {
      if (method === 'GET') return json({ data: [] });
      if (!online) throw new TypeError('Failed to fetch');
      return json({ ...msg((body as { id: string }).id, 5), body: 'hello' });
    });
    const chat = client(fetchFn);
    const { result } = renderHook(() => useMessages('c-1'), { wrapper: wrap(chat) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.send({ body: 'hello' }).catch((e: Error) => {
        expect(e.name).toBe('MessageQueuedError');
      });
    });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]!.local_status).toBe('queued');
    const id = result.current.messages[0]!.id;

    online = true;
    await act(async () => {
      await result.current.retry(id);
    });
    await waitFor(() => expect(result.current.messages[0]!.local_status).toBeUndefined());
    expect(result.current.messages[0]!.id).toBe(id);
    expect(result.current.messages[0]!.sequence).toBe(5);
    await chat.destroy();
  });

  it('keeps a refused send as failed until discarded', async () => {
    const fetchFn = routed((method) =>
      method === 'GET'
        ? json({ data: [] })
        : json({ error: { code: 'forbidden', message: 'not a member' } }, 403),
    );
    const chat = client(fetchFn);
    const { result } = renderHook(() => useMessages('c-1'), { wrapper: wrap(chat) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.send({ body: 'hi' }).catch(() => {});
    });
    expect(result.current.messages[0]).toMatchObject({ local_status: 'failed' });
    expect(result.current.messages[0]!.local_error).toContain('not a member');
    act(() => result.current.discard(result.current.messages[0]!.id));
    expect(result.current.messages).toEqual([]);
    await chat.destroy();
  });
});

describe('unread', () => {
  it('useUnreadTotals reads a client outside any provider', async () => {
    const chat = client(
      routed((_m, path) =>
        path === '/v1/me/unread'
          ? json({ unread_total: 4, mention_total: 1, conversations_with_unread: 2 })
          : json(me),
      ),
    );
    const { result } = renderHook(() => useUnreadTotals(chat));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ unread: 4, mentions: 1, conversations: 2 });
    await chat.destroy();
  });

  it('orderUnread puts recent activity first, mentions first when asked', () => {
    const rows = [
      conv('old-mention', 1, 1, '2026-11-20T10:00:00Z'),
      conv('new', 3, 0, '2026-11-21T10:00:00Z'),
      conv('read', 0, 0, '2026-11-21T11:00:00Z'),
    ];
    expect(orderUnread(rows).map((c) => c.id)).toEqual(['new', 'old-mention']);
    expect(orderUnread(rows, { mentionsFirst: true }).map((c) => c.id)).toEqual([
      'old-mention',
      'new',
    ]);
  });

  it('useUnreadQueue walks the unread conversations, marking each read', async () => {
    const fetchFn = routed((method, path) => {
      if (path === '/v1/conversations')
        return json({
          data: [
            conv('c-1', 2, 0, '2026-11-21T10:00:00Z'),
            conv('c-2', 1, 0, '2026-11-21T09:00:00Z'),
          ],
          next_cursor: null,
        });
      if (path === '/v1/me') return json(me);
      if (path.endsWith('/messages')) return json({ data: [msg('m-9', 9, path.split('/')[3])] });
      if (method === 'POST' && path.endsWith('/read')) return new Response(null, { status: 204 });
      return json({});
    });
    const chat = client(fetchFn);
    const { result } = renderHook(() => useUnreadQueue(), { wrapper: wrap(chat) });
    await waitFor(() => expect(result.current.current?.id).toBe('c-1'));
    expect(result.current.remaining).toBe(1);

    act(() => {
      result.current.next();
    });
    expect(result.current.current?.id).toBe('c-2');
    await waitFor(() =>
      expect(
        fetchFn.calls.some((c) => c.method === 'POST' && c.path === '/v1/conversations/c-1/read'),
      ).toBe(true),
    );
    act(() => {
      result.current.next();
    });
    expect(result.current.current).toBeNull();
    expect(result.current.queue).toEqual([]);
    await chat.destroy();
  });
});
