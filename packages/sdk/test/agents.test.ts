import { describe, expect, it, vi } from 'vitest';

import {
  agentMetaOf,
  approvalErrorMessage,
  approvalFromWire,
  approvalIdOf,
  citationLabel,
  citationsOf,
  messageAgent,
  toolLabel,
} from '../src/agents.js';
import { Poolse } from '../src/index.js';
import { bodyJson, buildPoolse, jsonResponse, scriptedFetch } from './_helpers.js';

// docs/AGENTS.md §3
const approvalRow = (id: string, status = 'pending') => ({
  id,
  agent_id: 'ag-1',
  conversation_id: 'c-1',
  requester_user_id: 'u-1',
  call_id: null,
  tool: 'github.create_issue',
  arguments: { repo: 'acme/web', title: 'Fix login', labels: ['bug', 'p1'] },
  status,
  reason: null,
  decided_by_user_id: null,
  decided_at: null,
  expires_at: '2026-11-21T10:30:00Z',
  inserted_at: `2026-11-21T10:00:0${id.slice(-1)}Z`,
});

const agentMsg = {
  sender_is_agent: true,
  deleted_at: null,
  agent_meta: {
    kind: 'asked',
    approval_id: 'ap-1',
    citations: [
      {
        n: 1,
        type: 'message',
        id: 'm-9',
        conversation_id: 'c-2',
        title: 'Sales',
        snippet: '  We agreed\n on 10% ',
        at: '2026-11-20T09:00:00Z',
        message_id: 'm-9',
      },
      {
        n: 2,
        type: 'transcript',
        id: 't-1',
        conversation_id: 'c-2',
        title: 'Sales',
        snippet: '',
        transcript_id: 't-1',
        call_id: 'call-1',
        start_ms: 65_000,
        speaker: 'Ana',
      },
      { n: 3, type: 'file', id: 'f-1', file_name: 'contract.pdf', attachment_id: 'f-1' },
      { n: 4, type: 'web', id: 'x' },
      { n: 5, type: 'memory' },
    ],
  },
};

describe('agent messages', () => {
  it('reads sender_is_agent and agent_meta', () => {
    expect(messageAgent(agentMsg)).toEqual({ id: null, name: null, kind: null });
    expect(messageAgent({ sender_is_agent: false })).toBeNull();
    expect(agentMetaOf(agentMsg)).toMatchObject({ kind: 'asked', approvalId: 'ap-1' });
    expect(approvalIdOf(agentMsg)).toBe('ap-1');
    expect(approvalIdOf({ agent_meta: null })).toBeNull();
    expect(agentMetaOf({ ...agentMsg, deleted_at: 'x' })).toBeNull();
  });

  it('reads numbered citations and drops broken ones', () => {
    const list = citationsOf(agentMsg);
    expect(list.map((c) => [c.n, c.type])).toEqual([
      [1, 'message'],
      [2, 'transcript'],
      [3, 'file'],
    ]);
    expect(list[0]).toMatchObject({
      snippet: 'We agreed on 10%',
      title: 'Sales',
      messageId: 'm-9',
    });
    expect(list[1]).toMatchObject({ callId: 'call-1', startMs: 65_000, speaker: 'Ana' });
    expect(citationLabel(list[1]!)).toBe('Sales');
    expect(citationLabel(list[2]!)).toBe('contract.pdf');
  });
});

describe('approvals', () => {
  it('maps an Approval row', () => {
    const a = approvalFromWire(approvalRow('ap-1'))!;
    expect(a).toMatchObject({
      id: 'ap-1',
      agentId: 'ag-1',
      tool: 'github.create_issue',
      summary: 'Create issue (github)',
      status: 'pending',
      expiresAt: '2026-11-21T10:30:00Z',
    });
    expect(a.details).toEqual([
      { label: 'Repo', value: 'acme/web' },
      { label: 'Title', value: 'Fix login' },
      { label: 'Labels', value: 'bug, p1' },
    ]);
    expect(toolLabel('send_email')).toBe('Send email');
    expect(approvalErrorMessage({ code: 'not_pending', status: 409 })).toMatch(/already answered/);
    expect(approvalErrorMessage({ status: 410 })).toMatch(/expired/);
  });

  it('lists, ensures and answers', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [approvalRow('ap-1'), approvalRow('ap-2')] }),
      jsonResponse({ data: { ...approvalRow('ap-1'), status: 'declined', reason: 'Not now' } }),
      jsonResponse({ data: [approvalRow('ap-1', 'declined'), approvalRow('ap-3', 'done')] }),
    ]);
    const chat = buildPoolse(fetchFn);
    await chat.approvals.list();
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/me/approvals?status=pending');
    expect(chat.approvals.pending().map((a) => a.id)).toEqual(['ap-2', 'ap-1']);

    const denied = await chat.approvals.deny('ap-1', { reason: '  Not now ' });
    expect(fetchFn.calls[1]?.url).toBe('https://chat.test/v1/me/approvals/ap-1/deny');
    expect(await bodyJson(fetchFn.calls[1]!)).toEqual({ reason: 'Not now' });
    expect(denied.status).toBe('declined');
    expect(chat.approvals.pending().map((a) => a.id)).toEqual(['ap-2']);

    expect((await chat.approvals.ensure('ap-3'))?.status).toBe('done');
    expect(fetchFn.calls[2]?.url).toBe('https://chat.test/v1/me/approvals?status=all');
    // Known now: no request.
    expect((await chat.approvals.ensure('ap-1'))?.status).toBe('declined');
    expect(fetchFn.calls).toHaveLength(3);
  });

  it('follows agent:approval and names agents from the directory', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/v1/me/agents')) {
        return jsonResponse({
          data: [
            {
              id: 'ag-1',
              user_id: 'u-9',
              external_id: 'scout',
              is_agent: true,
              name: 'Scout',
              template: 'assistant',
              status: 'active',
              assistant: true,
            },
          ],
        });
      }
      return new Promise<Response>(() => {});
    }) as unknown as typeof globalThis.fetch;
    const chat = new Poolse({
      apiUrl: 'https://chat.example',
      getToken: () => 'tok',
      fetch: fetchFn,
    });
    chat.me._hydrate({ id: 'u-1' } as never);
    const off = chat.approvals.subscribe(() => undefined);
    const user = chat.realtime.user('u-1') as unknown as {
      channel: { trigger(e: string, p: unknown): void };
    };
    user.channel.trigger('agent:approval', { event: 'requested', approval: approvalRow('ap-9') });
    expect(chat.approvals.peek('ap-9')?.status).toBe('pending');
    expect(chat.approvals.peek('ap-9')?.agent).toBeNull();

    const agents = await chat.agents.list();
    expect(agents[0]).toMatchObject({
      id: 'ag-1',
      name: 'Scout',
      externalId: 'scout',
      assistant: true,
    });
    expect(chat.approvals.peek('ap-9')?.agent?.name).toBe('Scout');
    expect(chat.users.agentOf('scout')).toEqual({ id: 'ag-1', name: 'Scout', kind: 'assistant' });

    user.channel.trigger('agent:approval', {
      event: 'decided',
      approval: approvalRow('ap-9', 'done'),
    });
    expect(chat.approvals.peek('ap-9')?.status).toBe('done');
    // An older pending copy never undoes it.
    chat.approvals._apply(approvalFromWire(approvalRow('ap-9'))!);
    expect(chat.approvals.peek('ap-9')?.status).toBe('done');
    off();
    chat.destroy();
  });
});

describe('scopes, memory, follow-ups', () => {
  it('reads and narrows a scope', async () => {
    const scope = {
      agent_id: 'ag-1',
      conversation_id: 'c-1',
      ceiling: { tools: null, read_history: true, may_post_unasked: true },
      conversation: {
        mode: 'watch',
        tools: ['search'],
        read_history: false,
        updated_by_user_id: 'u-1',
        updated_at: 'x',
      },
      effective: { mode: 'watch', watch: true, tools: ['search'], read_history: false },
    };
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [{ id: 'ag-1', external_id: 'scout', name: 'Scout', scope }] }),
      jsonResponse({ data: scope }),
      jsonResponse({ data: { ...scope, conversation: null } }),
    ]);
    const chat = buildPoolse(fetchFn);
    const [a] = await chat.agents.inConversation('c-1');
    expect(a?.scope?.effective).toEqual({
      mode: 'watch',
      watch: true,
      tools: ['search'],
      readHistory: false,
    });
    expect(chat.users.agentOf('scout')?.name).toBe('Scout');
    await chat.agents.setScope('c-1', 'ag-1', { mode: 'watch', readHistory: false });
    expect(fetchFn.calls[1]?.method).toBe('PUT');
    expect(fetchFn.calls[1]?.url).toBe('https://chat.test/v1/conversations/c-1/agents/ag-1/scope');
    expect(await bodyJson(fetchFn.calls[1]!)).toEqual({ mode: 'watch', read_history: false });
    expect((await chat.agents.resetScope('c-1', 'ag-1')).conversation).toBeNull();
    expect(fetchFn.calls[2]?.method).toBe('DELETE');
  });

  it('memory and follow-ups', async () => {
    const fact = {
      id: 'f-1',
      kind: 'deadline',
      text: 'Launch on 1 Dec',
      due_on: '2026-12-01',
      conversation_id: 'c-1',
      source: { type: 'message', id: 'm-1', snippet: 'launch' },
    };
    const fu = { id: 'fu-1', text: 'Send the contract', due_on: '2026-11-24', status: 'open' };
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [fact] }),
      jsonResponse({ data: fact }, { status: 201 }),
      jsonResponse({ data: { ...fact, text: 'Launch on 2 Dec' } }),
      new Response(null, { status: 204 }),
      jsonResponse({ data: [fu] }),
      jsonResponse({ data: { ...fu, status: 'done' } }),
    ]);
    const chat = buildPoolse(fetchFn);
    const facts = await chat.agents.memory({ conversationId: 'c-1', q: ' launch ' });
    expect(fetchFn.calls[0]?.url).toBe(
      'https://chat.test/v1/me/memory?conversation_id=c-1&q=launch',
    );
    expect(facts[0]).toMatchObject({
      kind: 'deadline',
      dueOn: '2026-12-01',
      source: { type: 'message' },
    });
    await chat.agents.addMemory({
      kind: 'deadline',
      text: 'Launch on 1 Dec',
      conversationId: 'c-1',
    });
    expect(await bodyJson(fetchFn.calls[1]!)).toEqual({
      kind: 'deadline',
      text: 'Launch on 1 Dec',
      conversation_id: 'c-1',
    });
    expect((await chat.agents.updateMemory('f-1', { text: 'Launch on 2 Dec' })).text).toBe(
      'Launch on 2 Dec',
    );
    await chat.agents.deleteMemory('f-1');
    expect(fetchFn.calls[3]?.method).toBe('DELETE');
    expect((await chat.agents.followups({ status: 'open' }))[0]?.text).toBe('Send the contract');
    expect(fetchFn.calls[4]?.url).toBe('https://chat.test/v1/me/followups?status=open');
    expect((await chat.agents.followupDone('fu-1')).status).toBe('done');
    expect(fetchFn.calls[5]?.url).toBe('https://chat.test/v1/me/followups/fu-1/done');
  });
});

describe('agent registry', () => {
  it('remembers agents from members and messages', () => {
    const chat = buildPoolse(scriptedFetch([]));
    const fn = vi.fn();
    chat.users.subscribe('scout', fn);
    expect(chat.users.isAgent('scout')).toBe(false);
    chat.users.noteAgents([
      { sender_external_id: 'scout', sender_is_agent: true },
      { sender_external_id: 'ana', sender_is_agent: false },
      { external_id: 'cal', is_agent: true },
    ]);
    expect(chat.users.isAgent('scout')).toBe(true);
    expect(chat.users.isAgent('cal')).toBe(true);
    expect(chat.users.isAgent('ana')).toBe(false);
    expect(fn).toHaveBeenCalledOnce();
    chat.users.noteAgents([{ sender_external_id: 'scout', sender_is_agent: true }]);
    expect(fn).toHaveBeenCalledOnce();
  });
});
