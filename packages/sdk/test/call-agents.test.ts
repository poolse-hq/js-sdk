import { describe, expect, it } from 'vitest';

import {
  briefFromWire,
  callAgentFromWire,
  callAgentOfParticipant,
  callAgentStateLabel,
  callAgentStateOf,
  callAgentsFromWire,
  createNotificationActions,
  escalationErrorMessage,
  escalationFromWire,
  isAgentMetadata,
  parseEscalationOptions,
  whisperFromWire,
  whisperHintFromWire,
} from '../src/index.js';
import { callMeetingFromWire } from '../src/meetings-live.js';
import { bodyJson, buildPoolse, jsonResponse, noContent, scriptedFetch } from './_helpers.js';

const agentRow = {
  session_id: 's1',
  call_id: 'call-1',
  conversation_id: 'conv-1',
  agent_id: 'a1',
  user_id: 'u-agent',
  name: 'Scout',
  label: 'Scout',
  mode: 'notetaker',
  status: 'live',
  on_behalf_of: null,
  invited_by_user_id: 'u1',
  auto: false,
  speaking: false,
  joined_at: '2026-11-22T10:00:00Z',
};

describe('agents in calls — mapping', () => {
  it('reads a CallAgent and its state', () => {
    const a = callAgentFromWire(agentRow)!;
    expect(a).toMatchObject({
      agentId: 'a1',
      userId: 'u-agent',
      label: 'Scout',
      mode: 'notetaker',
    });
    expect(callAgentStateLabel(callAgentStateOf(a))).toBe('Taking notes');
    expect(callAgentStateOf({ ...a, mode: 'assistant' })).toBe('listening');
    expect(callAgentStateOf({ ...a, mode: 'assistant', speaking: true })).toBe('speaking');
    expect(callAgentStateOf({ ...a, status: 'joining' })).toBe('joining');

    const d = callAgentFromWire({
      ...agentRow,
      mode: 'delegate',
      label: 'Jasir’s agent',
      on_behalf_of: { user_id: 'u1', display_name: 'Jasir' },
    })!;
    expect(d.label).toBe('Jasir’s agent');
    expect(d.onBehalfOfName).toBe('Jasir');
    expect(callAgentFromWire({ name: 'no id' })).toBeNull();
  });

  it('keeps only live agents in a list, and in the call snapshot', () => {
    const list = callAgentsFromWire([agentRow, { ...agentRow, agent_id: 'a2', status: 'left' }]);
    expect(list.map((a) => a.agentId)).toEqual(['a1']);
    const meeting = callMeetingFromWire({ meeting: { agents: [agentRow] } })!;
    expect(meeting.agents[0]?.label).toBe('Scout');
    expect(callMeetingFromWire({ meeting: {} })!.agents).toEqual([]);
  });

  it('tells an agent participant from its token metadata, not the room assistant', () => {
    const meta = { agent: true, agent_id: 'a1', mode: 'assistant', label: 'Jasir’s agent' };
    expect(isAgentMetadata(JSON.stringify(meta))).toBe(true);
    expect(isAgentMetadata({ role: 'speaker' })).toBe(false);
    expect(isAgentMetadata('not json')).toBe(false);

    const a = callAgentOfParticipant({
      userId: 'u-agent',
      name: 'Scout',
      metadata: meta,
      speaking: true,
    })!;
    expect(a).toMatchObject({
      agentId: 'a1',
      label: 'Jasir’s agent',
      mode: 'assistant',
      speaking: true,
    });
    expect(callAgentOfParticipant({ userId: 'u1', metadata: {} })).toBeNull();
    // Known from the call's list even without metadata (native rosters).
    const known = callAgentsFromWire([agentRow]);
    expect(callAgentOfParticipant({ userId: 'u-agent' }, known)?.name).toBe('Scout');
  });

  it('reads whisper state and hints (flat event payload)', () => {
    const w = whisperFromWire(
      {
        whisper: { call_id: 'call-1', on: true, agent: { id: 'a1', name: 'Scout' }, hint_count: 2 },
      },
      'call-1',
    )!;
    expect(w).toMatchObject({ on: true, agent: { id: 'a1', name: 'Scout' }, hintCount: 2 });
    const h = whisperHintFromWire({
      cv: 1,
      call_id: 'call-1',
      id: 'h1',
      kind: 'promise',
      text: 'You said you’d send the contract by Tuesday.',
      sources: [{ type: 'summary', id: 'sum1', title: 'Weekly sync' }, { nope: 1 }],
      at: '2026-11-22T10:05:00Z',
    })!;
    expect(h.kind).toBe('promise');
    expect(h.sources).toEqual([
      { type: 'summary', id: 'sum1', title: 'Weekly sync', callId: null, conversationId: null },
    ]);
    expect(whisperHintFromWire({ id: 'x', text: 'no call' })).toBeNull();
  });

  it('reads escalations, options and briefs', () => {
    const e = escalationFromWire({
      escalation: {
        id: 'e1',
        call_id: 'call-1',
        agent_id: 'a1',
        question: 'They ask for 10% off — accept?',
        options: ['approve', 'decline', 'answer'],
        status: 'pending',
        expires_at: '2026-11-22T10:10:00Z',
      },
    })!;
    expect(e.options).toEqual(['approve', 'decline', 'answer']);
    expect(parseEscalationOptions('answer')).toEqual(['answer']);
    expect(parseEscalationOptions('')).toEqual(['approve', 'decline', 'answer']);
    expect(escalationErrorMessage({ code: 'expired', status: 410 })).toMatch(/expired/);

    const b = briefFromWire({
      brief: {
        id: 'b1',
        text: 'Push for Friday',
        rules: ['no price changes'],
        status: 'done',
        report: { said: ['Friday works'], agreed: [], open: ['Price'] },
      },
    })!;
    expect(b.report?.open).toEqual(['Price']);
    expect(b.escalationTimeoutSeconds).toBe(120);
  });
});

describe('agents in calls — REST', () => {
  it('invites, changes mode and removes an agent', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ agent: agentRow }, { status: 201 }),
      jsonResponse({ agent: { ...agentRow, mode: 'assistant' } }),
      noContent(),
      jsonResponse({ agents: [agentRow] }),
    ]);
    const chat = buildPoolse(fetchFn);
    const a = await chat.callAgents.invite('call-1', 'a1');
    expect(a.mode).toBe('notetaker');
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/calls/call-1/agents');
    expect(await bodyJson(fetchFn.calls[0]!)).toEqual({ agent_id: 'a1', mode: 'notetaker' });

    expect((await chat.callAgents.setMode('call-1', 'a1', 'assistant')).mode).toBe('assistant');
    expect(fetchFn.calls[1]?.method).toBe('PATCH');
    await chat.callAgents.remove('call-1', 'a1');
    expect(fetchFn.calls[2]?.method).toBe('DELETE');
    expect(fetchFn.calls[2]?.url).toBe('https://chat.test/v1/calls/call-1/agents/a1');
    expect((await chat.callAgents.list('call-1')).length).toBe(1);
  });

  it('turns whisper on and reads the history', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({
        whisper: { call_id: 'call-1', on: true, agent: { id: 'a1', name: 'Scout' } },
      }),
      jsonResponse({
        whisper: { call_id: 'call-1', on: true },
        hints: [
          { id: 'h1', call_id: 'call-1', kind: 'fact', text: 'Q3 revenue was 1.2M', at: '1' },
        ],
      }),
    ]);
    const chat = buildPoolse(fetchFn);
    const w = await chat.callAgents.whisper.set('call-1', true);
    expect(w.on).toBe(true);
    expect(fetchFn.calls[0]?.method).toBe('POST');
    expect(await bodyJson(fetchFn.calls[0]!)).toEqual({ on: true });
    const got = await chat.callAgents.whisper.get('call-1');
    expect(got.hints[0]?.text).toBe('Q3 revenue was 1.2M');
  });

  it('replies to an escalation with a decision or an answer', async () => {
    const pending = { id: 'e1', question: 'Accept?', status: 'pending' };
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [pending] }),
      jsonResponse({ escalation: { ...pending, status: 'answered', answer: 'Only 5%' } }),
    ]);
    const chat = buildPoolse(fetchFn);
    await chat.escalations.list();
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/me/agent-escalations?status=pending');
    expect(chat.escalations.pending().map((e) => e.id)).toEqual(['e1']);
    const e = await chat.escalations.reply('e1', { answer: '  Only 5%  ' });
    expect(fetchFn.calls[1]?.url).toBe('https://chat.test/v1/agent-escalations/e1/reply');
    expect(await bodyJson(fetchFn.calls[1]!)).toEqual({ answer: 'Only 5%' });
    expect(e.status).toBe('answered');
    expect(chat.escalations.pending()).toEqual([]);
    await expect(chat.escalations.reply('e1', { answer: '  ' })).rejects.toThrow();
  });

  it('answers from a notification with the push token, no session', async () => {
    const fetchFn = scriptedFetch([jsonResponse({ escalation: { id: 'e1', status: 'approved' } })]);
    const actions = createNotificationActions({ apiUrl: 'https://chat.test', fetch: fetchFn });
    const e = await actions.escalation({ escalationId: 'e1', token: 'tok', decision: 'approve' });
    expect(e?.status).toBe('approved');
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/agent-escalations/e1/reply');
    expect(await bodyJson(fetchFn.calls[0]!)).toEqual({ decision: 'approve', token: 'tok' });
    expect(fetchFn.calls[0]?.headers.get('authorization')).toBeNull();
  });

  it('writes a brief with clamped fields', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ brief: { id: 'b1', text: 'Push for Friday' } }, { status: 201 }),
    ]);
    const chat = buildPoolse(fetchFn);
    await chat.callAgents.briefs.create({
      callId: 'call-1',
      text: ' Push for Friday ',
      rules: [' no price changes ', ''],
      escalationTimeoutSeconds: 5,
    });
    expect(await bodyJson(fetchFn.calls[0]!)).toEqual({
      call_id: 'call-1',
      text: 'Push for Friday',
      rules: ['no price changes'],
      escalation_timeout_seconds: 30,
    });
  });
});
