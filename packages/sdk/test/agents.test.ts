import { describe, expect, it, vi } from 'vitest';

import {
  approvalErrorMessage,
  citationsOf,
  formatApprovalPreview,
  parseApproval,
} from '../src/agents.js';
import { Poolse } from '../src/index.js';
import { bodyJson, buildPoolse, jsonResponse, scriptedFetch } from './_helpers.js';

const approvalBody = JSON.stringify({
  kind: 'agent_approval',
  approval_id: 'ap-1',
  agent: { id: 'ag-1', name: 'Scout', kind: 'assistant' },
  summary: 'Send an email to ana@acme.com',
  details: { to: 'ana@acme.com', subject: 'Contract', attachments: ['a.pdf', 'b.pdf'] },
  status: 'pending',
});

const msg = (over: Record<string, unknown> = {}) => ({
  id: 'm-1',
  conversation_id: 'c-1',
  type: 'custom' as const,
  body: approvalBody,
  inserted_at: '2026-11-21T10:00:00Z',
  deleted_at: null,
  ...over,
});

describe('approval messages', () => {
  it('parses the agent_approval kind', () => {
    const a = parseApproval(msg());
    expect(a).toMatchObject({
      id: 'ap-1',
      agent: { id: 'ag-1', name: 'Scout', kind: 'assistant' },
      summary: 'Send an email to ana@acme.com',
      status: 'pending',
      conversationId: 'c-1',
      messageId: 'm-1',
    });
    expect(a?.details).toEqual([
      { label: 'To', value: 'ana@acme.com' },
      { label: 'Subject', value: 'Contract' },
      { label: 'Attachments', value: 'a.pdf, b.pdf' },
    ]);
  });

  it('ignores other bodies, deleted messages and unknown statuses', () => {
    expect(parseApproval(msg({ body: 'hello' }))).toBeNull();
    expect(parseApproval(msg({ deleted_at: '2026-11-21T11:00:00Z' }))).toBeNull();
    expect(parseApproval(msg({ body: '{"kind":"recording"}' }))).toBeNull();
    const odd = parseApproval(
      msg({ body: JSON.stringify({ kind: 'agent_approval', approval_id: 'x', status: 'weird' }) }),
    );
    expect(odd?.status).toBe('pending');
    expect(odd?.summary).toBe('An action needs your approval');
  });

  it('takes the agent from the sender when the body leaves it out', () => {
    const a = parseApproval(
      msg({
        body: JSON.stringify({ kind: 'agent_approval', approval_id: 'x', summary: 'Book' }),
        is_agent: true,
        agent: { id: 'ag-2', name: 'Cal', kind: null },
      }),
    );
    expect(a?.agent?.name).toBe('Cal');
  });

  it('previews and words errors', () => {
    expect(formatApprovalPreview(approvalBody)).toBe('Approval: Send an email to ana@acme.com');
    expect(formatApprovalPreview('hi')).toBeNull();
    expect(approvalErrorMessage({ code: 'already_decided' })).toMatch(/already answered/);
  });
});

describe('citations', () => {
  it('keeps known types and drops broken rows', () => {
    const list = citationsOf({
      citations: [
        { type: 'message', id: 'm-9', conversation_id: 'c-2', snippet: '  We agreed\n on 10% ' },
        { type: 'transcript', id: 't-1', call_id: 'call-1', start_ms: 65_000, snippet: 'Pricing' },
        { type: 'file', id: 'f-1' },
        { type: 'web', id: 'x' },
        { type: 'message' },
      ],
    });
    expect(list).toEqual([
      {
        type: 'message',
        id: 'm-9',
        conversationId: 'c-2',
        callId: null,
        startMs: null,
        snippet: 'We agreed on 10%',
      },
      {
        type: 'transcript',
        id: 't-1',
        conversationId: null,
        callId: 'call-1',
        startMs: 65_000,
        snippet: 'Pricing',
      },
      { type: 'file', id: 'f-1', conversationId: null, callId: null, startMs: null, snippet: '' },
    ]);
    expect(citationsOf({ citations: undefined })).toEqual([]);
  });
});

describe('approvals resource', () => {
  const row = {
    id: 'ap-1',
    agent: { id: 'ag-1', name: 'Scout', kind: 'assistant' },
    summary: 'Create an issue',
    status: 'pending',
    inserted_at: '2026-11-21T10:00:00Z',
  };

  it('lists pending approvals and answers them', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [row] }),
      jsonResponse({ data: { ...row, status: 'denied', reason: 'Not now' } }),
    ]);
    const chat = buildPoolse(fetchFn);
    const listed = await chat.approvals.list();
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/approvals?status=pending');
    expect(listed[0]?.summary).toBe('Create an issue');
    expect(chat.approvals.pending().map((a) => a.id)).toEqual(['ap-1']);

    const denied = await chat.approvals.deny('ap-1', { reason: '  Not now ' });
    expect(fetchFn.calls[1]?.method).toBe('POST');
    expect(fetchFn.calls[1]?.url).toBe('https://chat.test/v1/approvals/ap-1/deny');
    expect(await bodyJson(fetchFn.calls[1]!)).toEqual({ reason: 'Not now' });
    expect(denied.status).toBe('denied');
    expect(chat.approvals.peek('ap-1')?.status).toBe('denied');
    expect(chat.approvals.pending()).toEqual([]);
  });

  it('keeps an answer when an older pending copy arrives', async () => {
    const fetchFn = scriptedFetch([jsonResponse({})]);
    const chat = buildPoolse(fetchFn);
    chat.me._hydrate({ id: 'u-1' } as never);
    const seen = vi.fn();
    const off = chat.approvals.subscribe(seen);
    // No body from the server: the local answer stands in.
    await chat.approvals.approve('ap-7');
    expect(chat.approvals.peek('ap-7')?.status).toBe('approved');
    chat.approvals._apply(parseApproval(msg({ body: approvalBody.replace('ap-1', 'ap-7') }))!);
    expect(chat.approvals.peek('ap-7')?.status).toBe('approved');
    expect(seen).toHaveBeenCalled();
    off();
    chat.destroy();
  });

  it('follows approval events on the user channel', () => {
    const chat = new Poolse({
      apiUrl: 'https://chat.example',
      getToken: () => 'tok',
      fetch: vi.fn(() => new Promise(() => {})) as unknown as typeof globalThis.fetch,
    });
    chat.me._hydrate({ id: 'u-1' } as never);
    const off = chat.approvals.subscribe(() => undefined);
    const user = chat.realtime.user('u-1') as unknown as {
      channel: { trigger(e: string, p: unknown): void };
    };
    user.channel.trigger('approval:created', { ...row, id: 'ap-9' });
    expect(chat.approvals.peek('ap-9')?.status).toBe('pending');
    user.channel.trigger('app:event', {
      type: 'approval:updated',
      data: { ...row, id: 'ap-9', status: 'expired' },
    });
    expect(chat.approvals.peek('ap-9')?.status).toBe('expired');
    off();
    chat.destroy();
  });
});

describe('agent registry', () => {
  it('remembers agents from members and messages', () => {
    const chat = buildPoolse(scriptedFetch([]));
    const fn = vi.fn();
    chat.users.subscribe('scout', fn);
    expect(chat.users.isAgent('scout')).toBe(false);
    chat.users.noteAgents([
      { sender_external_id: 'scout', is_agent: true, agent: { id: 'a', name: 'Scout' } },
      { sender_external_id: 'ana', is_agent: false },
    ]);
    expect(chat.users.agentOf('scout')).toEqual({ id: 'a', name: 'Scout', kind: null });
    expect(chat.users.isAgent('ana')).toBe(false);
    expect(fn).toHaveBeenCalledOnce();
    // The same again: nobody is told twice; a bare flag keeps the details.
    chat.users.noteAgents([{ external_id: 'scout', is_agent: true }]);
    expect(fn).toHaveBeenCalledOnce();
    expect(chat.users.agentOf('scout')?.name).toBe('Scout');
    chat.users.invalidate('scout');
    expect(chat.users.isAgent('scout')).toBe(true);
  });
});
