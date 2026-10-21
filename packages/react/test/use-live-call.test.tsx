import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLiveCall } from '../src/use-live-call.js';
import { jsonResponse, renderHookWithProvider, scriptedFetch } from './_helpers.js';

const member = (id: string) => ({ user_id: id, external_id: `ext-${id}`, display_name: null });

const liveCall = {
  id: 'call-1',
  conversation_id: 'c-1',
  conversation_name: 'Boiler',
  media: 'audio',
  state: 'live',
  started_by: member('u1'),
  started_at: '2026-10-21T10:00:00Z',
  ended_at: null,
  participants: [member('u1'), member('u2')],
  ring_states: { u2: 'answered', u3: 'ringing' },
};

describe('useLiveCall', () => {
  it('reads the live call on mount, with who is in the room', async () => {
    const fetchFn = scriptedFetch([jsonResponse({ cv: 1, call: liveCall })]);
    const { result } = renderHookWithProvider(() => useLiveCall('c-1'), fetchFn);

    await waitFor(() => expect(result.current.call?.id).toBe('call-1'));
    expect(result.current.participantIds).toEqual(['u1', 'u2']);
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/conversations/c-1/call');
  });

  it('no live call is null, not an error', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse(
        { error: { code: 'no_live_call', message: 'No live call on this conversation.' } },
        { status: 404 },
      ),
    ]);
    const { result } = renderHookWithProvider(() => useLiveCall('c-1'), fetchFn);

    await waitFor(() => expect(fetchFn.calls).toHaveLength(1));
    expect(result.current.call).toBeNull();
    expect(result.current.participantIds).toEqual([]);
  });

  it('a null conversation never asks', async () => {
    const fetchFn = scriptedFetch([]);
    const { result } = renderHookWithProvider(() => useLiveCall(null), fetchFn);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchFn.calls).toHaveLength(0);
    expect(result.current.call).toBeNull();
  });
});
