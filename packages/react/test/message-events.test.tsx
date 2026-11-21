// Server events folded into useMessages / useThread: link previews via
// message:updated, thread:updated summaries, message:deleted tombstones.

import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePoolse } from '../src/provider.js';
import { useMessages } from '../src/use-messages.js';
import { useThread } from '../src/use-thread.js';
import { jsonResponse, renderHookWithProvider } from './_helpers.js';

const msg = (id: string, sequence: number, over: Record<string, unknown> = {}) => ({
  id,
  tenant_id: 't-1',
  conversation_id: 'c-1',
  sender_id: 'u-2',
  sender_external_id: 'two',
  type: 'text',
  body: `m${sequence} https://example.com/${id}`,
  reply_to_id: null,
  thread_root_id: null,
  quoted_message_id: null,
  mentions: ['u-me'],
  reactions: { '👍': ['u-me'] },
  attachments: [],
  link_previews: [],
  reply_count: 0,
  last_reply_at: null,
  thread_participants: [],
  edited_at: null,
  deleted_at: null,
  sequence,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
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

function routedFetch(routes: Record<string, (req: Request) => Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(
      typeof input === 'string' || input instanceof URL ? input : input.url,
      init,
    );
    const url = new URL(req.url);
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) throw new Error(`unexpected ${req.method} ${url.pathname}`);
    return route(req);
  });
  return fn as unknown as typeof globalThis.fetch;
}

type Triggerable = { channel: { trigger(event: string, payload: unknown): void } };

const preview = {
  url: 'https://example.com/m1',
  type: 'website',
  title: 'Example',
  description: null,
  site_name: 'Example',
  image_url: 'https://example.com/i.png',
  favicon_url: null,
};

describe('useMessages: server events', () => {
  const render = () => {
    const fetchFn = routedFetch({
      'GET /v1/me': () => jsonResponse(me),
      'GET /v1/conversations/c-1/messages': () =>
        jsonResponse({
          data: [
            msg('m3', 3, {
              quoted_message_id: 'm1',
              quoted_message: {
                id: 'm1',
                sender_id: 'u-2',
                sender_external_id: 'two',
                body: 'm1',
                deleted_at: null,
                inserted_at: '2026-01-01T00:00:00Z',
              },
            }),
            msg('m2', 2),
            msg('m1', 1, { reply_count: 2 }),
          ],
        }),
    });
    return renderHookWithProvider(() => {
      const chat = usePoolse();
      return { chat, view: useMessages('c-1') };
    }, fetchFn);
  };
  const emit = (
    result: { current: { chat: ReturnType<typeof usePoolse> } },
    event: string,
    payload: unknown,
  ) =>
    act(() =>
      (result.current.chat.realtime.conversation('c-1') as unknown as Triggerable).channel.trigger(
        event,
        payload,
      ),
    );
  const byId = (result: { current: { view: ReturnType<typeof useMessages> } }, id: string) =>
    result.current.view.messages.find((m) => m.id === id)!;

  it('message:updated brings link previews, keeping the thread summary', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.view.loading).toBe(false));

    // An older payload without summary fields must not reset reply_count.
    const update = msg('m1', 1, { link_previews: [preview], reply_count: 0 });
    delete (update as Record<string, unknown>)['last_reply_at'];
    delete (update as Record<string, unknown>)['thread_participants'];
    emit(result, 'message:updated', update);

    expect(byId(result, 'm1').link_previews).toEqual([preview]);
    expect(byId(result, 'm1').reply_count).toBe(2);
  });

  it('thread:updated sets the root summary', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.view.loading).toBe(false));

    emit(result, 'message:new', msg('r1', 4, { thread_root_id: 'm2', reply_to_id: 'm2' }));
    expect(byId(result, 'm2').reply_count).toBe(1);
    expect(result.current.view.messages.some((m) => m.id === 'r1')).toBe(false);

    emit(result, 'thread:updated', {
      message_id: 'm2',
      conversation_id: 'c-1',
      reply_count: 1,
      last_reply_at: '2026-01-02T00:00:00Z',
      thread_participants: [{ user_id: 'u-3', external_id: 'three' }],
    });

    expect(byId(result, 'm2')).toMatchObject({
      reply_count: 1,
      last_reply_at: '2026-01-02T00:00:00Z',
      thread_participants: [{ user_id: 'u-3', external_id: 'three' }],
    });
  });

  it('message:deleted leaves a tombstone and marks quotes of it deleted', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.view.loading).toBe(false));

    emit(result, 'message:deleted', {
      id: 'm1',
      conversation_id: 'c-1',
      thread_root_id: null,
      deleted_at: '2026-01-03T00:00:00Z',
    });

    expect(byId(result, 'm1')).toMatchObject({
      body: null,
      deleted_at: '2026-01-03T00:00:00Z',
      mentions: [],
      reactions: {},
      link_previews: [],
      reply_count: 2,
    });
    expect(byId(result, 'm3').quoted_message).toMatchObject({
      body: null,
      deleted_at: '2026-01-03T00:00:00Z',
    });
  });

  it('a deleted reply (thread_root_id) lowers its root count', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.view.loading).toBe(false));

    emit(result, 'message:deleted', {
      id: 'r-unseen',
      conversation_id: 'c-1',
      thread_root_id: 'm1',
      deleted_at: '2026-01-03T00:00:00Z',
    });

    expect(byId(result, 'm1').reply_count).toBe(1);
  });
});

describe('useThread: server events', () => {
  it('merges previews into replies and tombstones deleted ones', async () => {
    const fetchFn = routedFetch({
      'GET /v1/messages/root/replies': () =>
        jsonResponse({
          data: [
            msg('r1', 2, { thread_root_id: 'root', reply_to_id: 'root' }),
            msg('r2', 3, { thread_root_id: 'root', reply_to_id: 'root' }),
          ],
        }),
    });
    const { result } = renderHookWithProvider(() => {
      const chat = usePoolse();
      return { chat, thread: useThread('c-1', 'root') };
    }, fetchFn);
    await waitFor(() => expect(result.current.thread.loading).toBe(false));
    const trigger = (event: string, payload: unknown) =>
      act(() =>
        (
          result.current.chat.realtime.conversation('c-1') as unknown as Triggerable
        ).channel.trigger(event, payload),
      );

    trigger(
      'message:updated',
      msg('r1', 2, { thread_root_id: 'root', reply_to_id: 'root', link_previews: [preview] }),
    );
    trigger('message:deleted', {
      id: 'r2',
      conversation_id: 'c-1',
      thread_root_id: 'root',
      deleted_at: '2026-01-03T00:00:00Z',
    });

    const [r1, r2] = result.current.thread.replies;
    expect(r1!.link_previews).toEqual([preview]);
    expect(r2).toMatchObject({ body: null, deleted_at: '2026-01-03T00:00:00Z', reactions: {} });
  });
});
