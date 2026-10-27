import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
});
