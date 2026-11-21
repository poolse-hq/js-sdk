import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PoolseProvider, usePoolse } from '../src/provider.js';
import { usePresenceMany, useUserPresence } from '../src/use-user-presence.js';
import { useConversationPresence, usePresence } from '../src/use-presence.js';
import { jsonResponse, renderHookWithProvider } from './_helpers.js';

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

const presence = (ext: string, state = 'online') => ({
  user_id: `u-${ext}`,
  external_id: ext,
  state,
  last_seen_at: '2026-11-21T09:00:00Z',
  dnd_until: null,
  do_not_disturb: false,
});

/** Answers /v1/me and /v1/presence (by external id) from `states`. */
function presenceFetch(states: Record<string, string>) {
  const calls: Request[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(
      typeof input === 'string' || input instanceof URL ? input : input.url,
      init,
    );
    calls.push(req);
    const url = new URL(req.url);
    if (url.pathname === '/v1/me') return jsonResponse(me);
    if (url.pathname === '/v1/presence') {
      const ids = (url.searchParams.get('external_ids') ?? '').split(',').filter(Boolean);
      return jsonResponse({
        data: ids.filter((id) => states[id]).map((id) => presence(id, states[id])),
      });
    }
    throw new Error(`unexpected ${req.method} ${url.pathname}`);
  });
  return Object.assign(fn as unknown as typeof globalThis.fetch, { calls });
}

const presenceCalls = (f: { calls: Request[] }) =>
  f.calls.filter((r) => new URL(r.url).pathname === '/v1/presence');

type Triggerable = { channel: { trigger(event: string, payload: unknown): void } };

describe('useUserPresence / usePresenceMany', () => {
  it('batches every hook into one lookup and fills each', async () => {
    const fetchFn = presenceFetch({ ana: 'online', ben: 'away', cy: 'in_call' });
    const { result } = renderHookWithProvider(
      () => ({
        ana: useUserPresence('ana'),
        many: usePresenceMany(['ben', 'cy', 'nobody']),
      }),
      fetchFn,
    );

    await waitFor(() => expect(result.current.ana?.state).toBe('online'));
    await waitFor(() => expect(Object.keys(result.current.many)).toHaveLength(2));
    expect(result.current.many['ben']?.state).toBe('away');
    expect(result.current.many['cy']?.state).toBe('in_call');
    expect(result.current.many['nobody']).toBeUndefined();

    const calls = presenceCalls(fetchFn);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).searchParams.get('external_ids')!.split(',').sort()).toEqual([
      'ana',
      'ben',
      'cy',
      'nobody',
    ]);
  });

  it('follows presence:changed on the user channel', async () => {
    const fetchFn = presenceFetch({ ana: 'online' });
    const { result } = renderHookWithProvider(() => {
      const chat = usePoolse();
      return { chat, ana: useUserPresence('ana') };
    }, fetchFn);
    await waitFor(() => expect(result.current.ana?.state).toBe('online'));
    await waitFor(() => expect(result.current.chat.realtime.peekUser()).not.toBeNull());

    act(() =>
      (result.current.chat.realtime.peekUser() as unknown as Triggerable).channel.trigger(
        'presence:changed',
        {
          user_id: 'u-ana',
          external_id: 'ana',
          state: 'offline',
          last_seen_at: '2026-11-21T10:00:00Z',
        },
      ),
    );

    expect(result.current.ana?.state).toBe('offline');
    expect(result.current.ana?.do_not_disturb).toBe(false);
  });

  it('a fresh array with the same ids does not look up again', async () => {
    const fetchFn = presenceFetch({ ana: 'online', ben: 'online' });
    const { result, rerender } = renderHookWithProvider(
      () => usePresenceMany(['ben', 'ana']),
      fetchFn,
    );
    await waitFor(() => expect(Object.keys(result.current)).toHaveLength(2));

    rerender();
    rerender();
    await new Promise((r) => setTimeout(r, 10));

    expect(presenceCalls(fetchFn)).toHaveLength(1);
  });

  it('null / empty ids are a no-op', async () => {
    const fetchFn = presenceFetch({});
    const { result } = renderHookWithProvider(
      () => ({ one: useUserPresence(null), many: usePresenceMany([]) }),
      fetchFn,
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(result.current.one).toBeNull();
    expect(result.current.many).toEqual({});
    expect(presenceCalls(fetchFn)).toHaveLength(0);
  });

  it('a later mount reads the shared store without a new lookup', async () => {
    const fetchFn = presenceFetch({ ana: 'away' });
    const { result } = renderHookWithProvider(() => {
      const chat = usePoolse();
      return { chat, ana: useUserPresence('ana') };
    }, fetchFn);
    await waitFor(() => expect(result.current.ana?.state).toBe('away'));

    expect(result.current.chat.presence.peek('ana')?.state).toBe('away');
    expect(presenceCalls(fetchFn)).toHaveLength(1);
  });

  it('useConversationPresence is usePresence', () => {
    expect(useConversationPresence).toBe(usePresence);
  });
});

describe('PoolseProvider trackActivity', () => {
  const fetchFn = vi.fn() as unknown as typeof globalThis.fetch;
  const Probe = ({ onChat }: { onChat: (c: ReturnType<typeof usePoolse>) => void }) => {
    onChat(usePoolse());
    return null;
  };

  it('reports idle when the window blurs, by default', () => {
    let chat: ReturnType<typeof usePoolse> | null = null;
    const view = render(
      <PoolseProvider config={{ apiUrl: 'https://chat.test', getToken: () => 't', fetch: fetchFn }}>
        <Probe onChat={(c) => (chat = c)} />
      </PoolseProvider>,
    );

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(chat!.presence.getActivity()).toBe('idle');
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(chat!.presence.getActivity()).toBe('active');
    view.unmount();
  });

  it('trackActivity={false} leaves it to the app', () => {
    let chat: ReturnType<typeof usePoolse> | null = null;
    const view = render(
      <PoolseProvider
        config={{ apiUrl: 'https://chat.test', getToken: () => 't', fetch: fetchFn }}
        trackActivity={false}
      >
        <Probe onChat={(c) => (chat = c)} />
      </PoolseProvider>,
    );

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(chat!.presence.getActivity()).toBe('active');
    view.unmount();
  });
});
