import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePoolse } from '../src/provider.js';
import { useMessages } from '../src/use-messages.js';
import { jsonResponse, renderHookWithProvider, scriptedFetch } from './_helpers.js';

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
  quoted_message_id: null,
  mentions: [],
  reactions: {},
  edited_at: null,
  deleted_at: null,
  sequence,
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

// Drives the realtime status the way a socket reopening would.
type StatusDriver = { setStatus(s: string): void };

describe('useMessages', () => {
  it('catches up from REST when the socket reconnects', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse(me),
      // Wire order is newest-first.
      jsonResponse({ data: [msg('m2', 2), msg('m1', 1)] }),
      // After the reconnect: m3 arrived while the socket was down.
      jsonResponse({ data: [msg('m3', 3), msg('m2', 2)] }),
    ]);
    const { result } = renderHookWithProvider(() => {
      const chat = usePoolse();
      return { chat, msgs: useMessages('c-1') };
    }, fetchFn);

    await waitFor(() => expect(result.current.msgs.loading).toBe(false));
    expect(result.current.msgs.messages.map((m) => m.id)).toEqual(['m1', 'm2']);

    const realtime = result.current.chat.realtime as unknown as StatusDriver;
    // The first connect is not a reconnect: no extra fetch.
    act(() => realtime.setStatus('connected'));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchFn.calls).toHaveLength(2);

    act(() => realtime.setStatus('reconnecting'));
    act(() => realtime.setStatus('connected'));

    await waitFor(() =>
      expect(result.current.msgs.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']),
    );
    expect(fetchFn.calls[2]?.url).toContain('/v1/conversations/c-1/messages');
  });

  describe('loadUntil', () => {
    const page = (from: number, to: number) => {
      const out = [];
      for (let seq = to; seq >= from; seq--) out.push(msg(`m${seq}`, seq));
      return out;
    };

    it('pages back until the message is loaded', async () => {
      const fetchFn = scriptedFetch([
        jsonResponse(me),
        jsonResponse({ data: page(101, 150) }),
        jsonResponse({ data: page(51, 100) }),
        jsonResponse({ data: page(1, 50) }),
      ]);
      const { result } = renderHookWithProvider(() => useMessages('c-1'), fetchFn);
      await waitFor(() => expect(result.current.loading).toBe(false));

      let found = false;
      await act(async () => {
        found = await result.current.loadUntil('m20');
      });

      expect(found).toBe(true);
      expect(result.current.messages[0]?.id).toBe('m1');
      expect(result.current.messages).toHaveLength(150);
      expect(fetchFn.calls[2]?.url).toContain('before=101');
      expect(fetchFn.calls[3]?.url).toContain('before=51');
    });

    it('loadMore beside loadUntil keeps each message once', async () => {
      const fetchFn = scriptedFetch([
        jsonResponse(me),
        jsonResponse({ data: page(51, 100) }),
        jsonResponse({ data: page(1, 50) }),
        jsonResponse({ data: page(1, 50) }),
      ]);
      const { result } = renderHookWithProvider(() => useMessages('c-1'), fetchFn);
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await Promise.all([result.current.loadMore(), result.current.loadUntil('m10')]);
      });

      const ids = result.current.messages.map((m) => m.id);
      expect(ids).toHaveLength(100);
      expect(new Set(ids).size).toBe(100);
    });

    it('resolves true without fetching when already loaded', async () => {
      const fetchFn = scriptedFetch([jsonResponse(me), jsonResponse({ data: page(1, 3) })]);
      const { result } = renderHookWithProvider(() => useMessages('c-1'), fetchFn);
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(result.current.loadUntil('m2')).resolves.toBe(true);
      expect(fetchFn.calls).toHaveLength(2);
    });

    it('resolves false when history runs out', async () => {
      const fetchFn = scriptedFetch([
        jsonResponse(me),
        jsonResponse({ data: page(51, 100) }),
        jsonResponse({ data: page(1, 50).slice(0, 10) }),
      ]);
      const { result } = renderHookWithProvider(() => useMessages('c-1'), fetchFn);
      await waitFor(() => expect(result.current.loading).toBe(false));

      let found = true;
      await act(async () => {
        found = await result.current.loadUntil('nope');
      });

      expect(found).toBe(false);
      expect(result.current.hasMore).toBe(false);
    });
  });
});

describe('useMessages races', () => {
  // A fetch whose answers the test hands out by hand, per request.
  function manualFetch() {
    const waiting: Array<{
      method: string;
      path: string;
      body: unknown;
      answer: (r: Response) => void;
    }> = [];
    const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (url.pathname === '/v1/me') return jsonResponse(me);
      return new Promise<Response>((answer) =>
        waiting.push({
          method: init?.method ?? 'GET',
          path: url.pathname,
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
          answer,
        }),
      );
    }) as unknown as typeof globalThis.fetch;
    const take = async (method: string, path: string) => {
      let hit: (typeof waiting)[number] | undefined;
      await waitFor(() => {
        hit = waiting.find((w) => w.method === method && w.path === path);
        expect(hit).toBeDefined();
      });
      waiting.splice(waiting.indexOf(hit!), 1);
      return hit!;
    };
    return { fn, take };
  }
  type Trigger = { channel: { trigger(e: string, p: unknown): void } };

  it('keeps a message:new that arrived before the first page', async () => {
    const f = manualFetch();
    const { result } = renderHookWithProvider(() => {
      const chat = usePoolse();
      return { chat, msgs: useMessages('c-1') };
    }, f.fn);
    const list = await f.take('GET', '/v1/conversations/c-1/messages');
    const conv = result.current.chat.realtime.conversation('c-1') as unknown as Trigger;
    act(() => conv.channel.trigger('message:new', msg('m5', 5)));
    // The page was built before m5 was stored.
    await act(async () => list.answer(jsonResponse({ data: [msg('m2', 2), msg('m1', 1)] })));
    await waitFor(() => expect(result.current.msgs.loading).toBe(false));
    expect(result.current.msgs.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm5']);
  });

  it('a send that lands after a conversation switch stays out of the new one', async () => {
    const f = manualFetch();
    const { result, rerender } = renderHookWithProvider(
      ({ id }: { id: string }) => useMessages(id),
      f.fn,
      { initialProps: { id: 'c-1' } },
    );
    await act(async () =>
      (await f.take('GET', '/v1/conversations/c-1/messages')).answer(jsonResponse({ data: [] })),
    );
    let sending!: Promise<unknown>;
    act(() => {
      sending = result.current.send({ body: 'for c-1' });
    });
    const post = await f.take('POST', '/v1/conversations/c-1/messages');
    rerender({ id: 'c-2' });
    await act(async () =>
      (await f.take('GET', '/v1/conversations/c-2/messages')).answer(
        jsonResponse({ data: [{ ...msg('b1', 1), conversation_id: 'c-2' }] }),
      ),
    );
    const sent = { ...msg((post.body as { id: string }).id, 9), body: 'for c-1' };
    await act(async () => {
      post.answer(jsonResponse(sent, { status: 201 }));
      await sending;
    });
    expect(result.current.messages.map((m) => m.id)).toEqual(['b1']);
  });
});
