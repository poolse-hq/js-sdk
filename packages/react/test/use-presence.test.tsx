import { act, renderHook } from '@testing-library/react';
import { Poolse } from '@poolse/sdk';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PoolseProvider } from '../src/provider.js';
import { usePresence } from '../src/use-presence.js';

describe('usePresence', () => {
  it('keeps a user online while another of their tabs is open', () => {
    const chat = new Poolse({
      apiUrl: 'https://chat.test',
      getToken: () => 'jwt',
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PoolseProvider client={chat}>{children}</PoolseProvider>
    );
    const { result } = renderHook(() => usePresence('c-1'), { wrapper });
    const channel = (
      chat.realtime.conversation('c-1') as unknown as {
        channel: { trigger(e: string, p: unknown): void };
      }
    ).channel;
    const meta = (ref: string) => ({ phx_ref: ref, online_at: 1, external_id: 'ana' });
    act(() => channel.trigger('presence_state', { u1: { metas: [meta('a'), meta('b')] } }));
    expect([...result.current.online]).toEqual(['ana']);
    act(() =>
      channel.trigger('presence_diff', { joins: {}, leaves: { u1: { metas: [meta('a')] } } }),
    );
    expect([...result.current.online]).toEqual(['ana']);
    act(() =>
      channel.trigger('presence_diff', { joins: {}, leaves: { u1: { metas: [meta('b')] } } }),
    );
    expect([...result.current.online]).toEqual([]);
    void chat.destroy();
  });
});
