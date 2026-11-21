// useApprovals / useApproval / useAgent / useAskMeetings.

import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePoolse } from '../src/provider.js';
import { useApproval, useApprovals } from '../src/use-approvals.js';
import { useAskMeetings } from '../src/use-meetings.js';
import { useUser } from '../src/use-user.js';
import { parseApproval } from '@poolse/sdk';
import { jsonResponse, renderHookWithProvider } from './_helpers.js';

/** A fetch that answers by method + path, so request order doesn't matter. */
function routedFetch(routes: Record<string, (req: Request) => Response | Promise<Response>>) {
  const calls: Request[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(
      typeof input === 'string' || input instanceof URL ? input : input.url,
      init,
    );
    calls.push(req);
    const path = new URL(req.url).pathname;
    const route = routes[`${req.method} ${path}`];
    if (!route) return jsonResponse({ error: { code: 'not_found', message: '' } }, { status: 404 });
    return route(req);
  });
  return Object.assign(fn as unknown as typeof globalThis.fetch, { calls });
}

const me = { id: 'u-1', tenant_id: 't', external_id: 'me', display_name: null, custom_data: {} };
const row = (id: string, status = 'pending') => ({
  id,
  agent: { id: 'ag-1', name: 'Scout', kind: 'assistant' },
  summary: `Do ${id}`,
  status,
  inserted_at: `2026-11-21T10:00:0${id.slice(-1)}Z`,
});

describe('useApprovals', () => {
  it('lists pending approvals and drops answered ones', async () => {
    const fetchFn = routedFetch({
      'GET /v1/me': () => jsonResponse(me),
      'GET /v1/approvals': () => jsonResponse({ data: [row('ap-1'), row('ap-2')] }),
      'POST /v1/approvals/ap-1/approve': () => jsonResponse({ data: row('ap-1', 'approved') }),
    });
    const { result } = renderHookWithProvider(() => useApprovals({ pollMs: 0 }), fetchFn);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.approvals.map((a) => a.id)).toEqual(['ap-2', 'ap-1']);
    await act(async () => {
      await result.current.approve('ap-1');
    });
    expect(result.current.approvals.map((a) => a.id)).toEqual(['ap-2']);
  });
});

describe('useApproval', () => {
  it('follows an answer and reports a failure', async () => {
    const fetchFn = routedFetch({
      'GET /v1/me': () => jsonResponse(me),
      'POST /v1/approvals/ap-5/deny': () =>
        jsonResponse({ error: { code: 'already_decided', message: 'x' } }, { status: 409 }),
      'POST /v1/approvals/ap-5/approve': () => jsonResponse({ data: row('ap-5', 'approved') }),
    });
    const msg = {
      id: 'm-1',
      conversation_id: 'c-1',
      type: 'custom' as const,
      body: JSON.stringify({ kind: 'agent_approval', ...row('ap-5'), approval_id: 'ap-5' }),
    };
    // Parsed on every render, as a card would.
    const { result } = renderHookWithProvider(() => useApproval(parseApproval(msg)), fetchFn);
    expect(result.current.approval?.status).toBe('pending');
    await act(async () => {
      await result.current.deny('No').catch(() => undefined);
    });
    expect(result.current.error).toBeTruthy();
    await act(async () => {
      await result.current.approve();
    });
    expect(result.current.approval?.status).toBe('approved');
    expect(result.current.pending).toBeNull();
  });
});

describe('useUser agent', () => {
  it('carries the agent once the server marked the user', async () => {
    const fetchFn = routedFetch({});
    const { result } = renderHookWithProvider(
      () => ({ user: useUser('scout'), chat: usePoolse() }),
      fetchFn,
    );
    expect(result.current.user.agent).toBeNull();
    act(() => {
      result.current.chat.users.noteAgents([
        { sender_external_id: 'scout', is_agent: true, agent: { name: 'Scout' } },
      ]);
    });
    await waitFor(() => expect(result.current.user.agent?.name).toBe('Scout'));
  });
});

describe('useAskMeetings', () => {
  it('asks, keeps the answer and clears it on reset', async () => {
    const fetchFn = routedFetch({
      'POST /v1/meetings/ask': () =>
        jsonResponse({
          answer: 'Friday.',
          links: [{ call_id: 'call-1', start_ms: 5000, snippet: 'Friday' }],
        }),
    });
    const { result } = renderHookWithProvider(() => useAskMeetings({ callId: 'call-1' }), fetchFn);
    await act(async () => {
      await result.current.ask('   ');
    });
    expect(fetchFn.calls).toHaveLength(0);
    await act(async () => {
      await result.current.ask('When do we ship?');
    });
    expect(result.current.answer?.links[0]?.startMs).toBe(5000);
    expect(result.current.question).toBe('When do we ship?');
    act(() => result.current.reset());
    expect(result.current.answer).toBeNull();
  });
});
