// useApprovals / useApproval / useAgent / useConversationAgents / useCallSummary / useAskMeetings.

import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { parseCallSummary } from '@poolse/sdk';
import { usePoolse } from '../src/provider.js';
import { useConversationAgents, useFollowups } from '../src/use-agents.js';
import { useApproval, useApprovals } from '../src/use-approvals.js';
import { useAskMeetings, useCallSummary } from '../src/use-meetings.js';
import { useUser } from '../src/use-user.js';
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
  agent_id: 'ag-1',
  conversation_id: 'c-1',
  tool: 'send_email',
  arguments: { to: 'ana@acme.com' },
  status,
  inserted_at: `2026-11-21T10:00:0${id.slice(-1)}Z`,
});
const directory = () =>
  jsonResponse({ data: [{ id: 'ag-1', external_id: 'scout', name: 'Scout', status: 'active' }] });

describe('useApprovals', () => {
  it('lists pending approvals, names the agent and drops answered ones', async () => {
    const fetchFn = routedFetch({
      'GET /v1/me': () => jsonResponse(me),
      'GET /v1/me/agents': directory,
      'GET /v1/me/approvals': () => jsonResponse({ data: [row('ap-1'), row('ap-2')] }),
      'POST /v1/me/approvals/ap-1/approve': () => jsonResponse({ data: row('ap-1', 'running') }),
    });
    const { result } = renderHookWithProvider(() => useApprovals({ pollMs: 0 }), fetchFn);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.approvals.map((a) => a.id)).toEqual(['ap-2', 'ap-1']);
    await waitFor(() => expect(result.current.approvals[0]?.agent?.name).toBe('Scout'));
    await act(async () => {
      await result.current.approve('ap-1');
    });
    expect(result.current.approvals.map((a) => a.id)).toEqual(['ap-2']);
  });
});

describe('useApproval', () => {
  it('loads the approval a message points at, follows answers and failures', async () => {
    const fetchFn = routedFetch({
      'GET /v1/me': () => jsonResponse(me),
      'GET /v1/me/approvals': () => jsonResponse({ data: [row('ap-5')] }),
      'POST /v1/me/approvals/ap-5/deny': () =>
        jsonResponse({ error: { code: 'not_pending', message: 'x' } }, { status: 409 }),
      'POST /v1/me/approvals/ap-5/approve': () => jsonResponse({ data: row('ap-5', 'running') }),
    });
    const { result } = renderHookWithProvider(() => useApproval('ap-5'), fetchFn);
    await waitFor(() => expect(result.current.approval?.status).toBe('pending'));
    expect(result.current.loading).toBe(false);
    await act(async () => {
      await result.current.deny('No').catch(() => undefined);
    });
    expect(result.current.error).toBeTruthy();
    await act(async () => {
      await result.current.approve();
    });
    expect(result.current.approval?.status).toBe('running');
    expect(result.current.pending).toBeNull();
  });

  it('is null for an approval that is not yours', async () => {
    const fetchFn = routedFetch({
      'GET /v1/me': () => jsonResponse(me),
      'GET /v1/me/approvals': () => jsonResponse({ data: [] }),
    });
    const { result } = renderHookWithProvider(() => useApproval('ap-x'), fetchFn);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.approval).toBeNull();
  });
});

describe('useUser agent', () => {
  it('carries the agent once the server marked the user', async () => {
    const { result } = renderHookWithProvider(
      () => ({ user: useUser('scout'), chat: usePoolse() }),
      routedFetch({ 'GET /v1/me/agents': directory }),
    );
    expect(result.current.user.agent).toBeNull();
    act(() => {
      result.current.chat.users.noteAgents([
        { sender_external_id: 'scout', sender_is_agent: true },
      ]);
    });
    await waitFor(() => expect(result.current.user.agent).not.toBeNull());
    await act(async () => {
      await result.current.chat.agents.list();
    });
    await waitFor(() => expect(result.current.user.agent?.name).toBe('Scout'));
  });
});

describe('useConversationAgents / useFollowups', () => {
  it('narrows a scope and closes a follow-up', async () => {
    const scope = (mode: string) => ({
      agent_id: 'ag-1',
      conversation_id: 'c-1',
      ceiling: { tools: null, read_history: true, may_post_unasked: true },
      conversation: null,
      effective: { mode, watch: mode === 'watch', tools: null, read_history: true },
    });
    const fetchFn = routedFetch({
      'GET /v1/conversations/c-1/agents': () =>
        jsonResponse({ data: [{ id: 'ag-1', name: 'Scout', scope: scope('mention') }] }),
      'PUT /v1/conversations/c-1/agents/ag-1/scope': () => jsonResponse({ data: scope('watch') }),
      'GET /v1/me/followups': () =>
        jsonResponse({ data: [{ id: 'fu-1', text: 'Send it', status: 'open' }] }),
      'POST /v1/me/followups/fu-1/done': () =>
        jsonResponse({ data: { id: 'fu-1', text: 'Send it', status: 'done' } }),
    });
    const { result } = renderHookWithProvider(
      () => ({ a: useConversationAgents('c-1'), f: useFollowups({ status: 'open' }) }),
      fetchFn,
    );
    await waitFor(() => expect(result.current.a.agents).toHaveLength(1));
    await act(async () => {
      await result.current.a.setScope('ag-1', { mode: 'watch' });
    });
    expect(result.current.a.agents[0]?.scope?.effective.watch).toBe(true);
    await waitFor(() => expect(result.current.f.followups).toHaveLength(1));
    await act(async () => {
      await result.current.f.done('fu-1');
    });
    expect(result.current.f.followups).toEqual([]);
  });
});

describe('useCallSummary', () => {
  it('fetches the full summary when the message copy is shortened', async () => {
    const body = JSON.stringify({
      kind: 'call_summary',
      v: 1,
      call_id: 'call-1',
      summary_id: 's-1',
      decisions: [{ text: 'Ship' }],
      shortened: true,
    });
    const fetchFn = routedFetch({
      'GET /v1/calls/call-1/summary': () =>
        jsonResponse({
          data: {
            id: 's-1',
            call_id: 'call-1',
            conversation_id: 'c-1',
            status: 'ready',
            decisions: [{ text: 'Ship' }, { text: 'Hire' }],
          },
        }),
    });
    const initial = parseCallSummary({ type: 'system', body, conversation_id: 'c-1' });
    const { result } = renderHookWithProvider(() => useCallSummary('call-1', initial), fetchFn);
    expect(result.current.summary?.decisions).toHaveLength(1);
    await waitFor(() => expect(result.current.summary?.decisions).toHaveLength(2));
  });
});

describe('useAskMeetings', () => {
  it('asks, keeps the answer and clears it on reset', async () => {
    const fetchFn = routedFetch({
      'POST /v1/meetings/ask': () =>
        jsonResponse({
          data: {
            answer: 'Friday.',
            citations: [{ kind: 'said', call_id: 'call-1', start_ms: 5000, text: 'Friday' }],
            calls: [],
          },
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
    expect(result.current.answer?.citations[0]?.startMs).toBe(5000);
    expect(result.current.question).toBe('When do we ship?');
    act(() => result.current.reset());
    expect(result.current.answer).toBeNull();
  });
});
