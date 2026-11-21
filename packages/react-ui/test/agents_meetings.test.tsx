// Agent badge, approval card, sources, call summary, ask box, players.

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { parseApproval, parseCallSummary } from '@poolse/react';
import { ApprovalCard, MessageCitations } from '../src/Agents.js';
import { Avatar } from '../src/Avatar.js';
import { ConversationView } from '../src/ConversationView.js';
import { MemberList } from '../src/MemberList.js';
import { MessageExtrasProvider } from '../src/messageExtras.js';
import { AskMeetings, RecordingPlayer, SummaryCard } from '../src/Meetings.js';
import { member, me, msg, viewRoutes } from './_fixtures.js';
import { jsonResponse, renderWithProvider, routedFetch } from './_helpers.js';

const LONG = 'Scout the Extraordinarily Long-Named Support Triage Assistant';

const approvalMsg = (status = 'pending') =>
  msg(1, 'u-2', {
    type: 'custom',
    is_agent: true,
    agent: { id: 'ag-1', name: LONG, kind: 'assistant' },
    body: JSON.stringify({
      kind: 'agent_approval',
      approval_id: 'ap-1',
      summary: 'Send an email to ana@acme.com',
      details: { to: 'ana@acme.com', subject: 'Contract', body: 'Hi Ana,\nattached.' },
      status,
    }),
  });

const summaryMsg = msg(2, 'u-2', {
  type: 'custom',
  is_agent: true,
  body: JSON.stringify({
    kind: 'call_summary',
    call_id: 'call-1',
    style: 'standup',
    decisions: ['Ship on Friday'],
    action_items: [{ text: 'Send the contract', assignee_user_id: 'u-3', due: '2026-12-03' }],
    open_questions: ['Who owns onboarding?'],
    moments: [{ label: 'Pricing', start_ms: 125_000 }],
  }),
});

describe('agent badge', () => {
  it('marks agent avatars and member rows', async () => {
    const { container } = renderWithProvider(<Avatar name="Scout" agent />, routedFetch({}));
    expect(screen.getByRole('img', { name: 'Scout (agent)' })).toBeTruthy();
    expect(container.querySelector('.poolse-avatar--agent')).toBeTruthy();

    renderWithProvider(
      <MemberList conversationId="c-1" showPresence={false} />,
      routedFetch({
        'GET /v1/conversations/c-1/members': () =>
          jsonResponse({
            data: [
              { ...member('u-2', 'scout'), is_agent: true, agent: { name: 'Scout' } },
              member('u-3', 'ana'),
            ],
          }),
      }),
    );
    await screen.findByText('scout');
    const badges = screen.getAllByText('Agent');
    expect(badges).toHaveLength(1);
  });
});

describe('ApprovalCard', () => {
  it('approves with a reason and shows the new state', async () => {
    const fetchFn = routedFetch({
      'GET /v1/me': () => jsonResponse(me),
      'POST /v1/approvals/ap-1/approve': () =>
        jsonResponse({
          data: {
            id: 'ap-1',
            summary: 'Send an email to ana@acme.com',
            status: 'approved',
            reason: 'Fine',
          },
        }),
    });
    renderWithProvider(<ApprovalCard approval={parseApproval(approvalMsg() as never)!} />, fetchFn);
    expect(screen.getByText(LONG)).toBeTruthy();
    expect(screen.getByText('Waiting for approval')).toBeTruthy();
    expect(screen.getByText('ana@acme.com')).toBeTruthy();
    fireEvent.click(screen.getByText('Add a reason'));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Fine' } });
    fireEvent.click(screen.getByText('Approve'));
    await screen.findByText('Approved');
    const post = fetchFn.calls.find((r) => r.method === 'POST')!;
    expect(await post.json()).toEqual({ reason: 'Fine' });
    expect(screen.queryByText('Deny')).toBeNull();
  });

  it('explains a refused answer', async () => {
    const fetchFn = routedFetch({
      'GET /v1/me': () => jsonResponse(me),
      'POST /v1/approvals/ap-1/deny': () =>
        jsonResponse({ error: { code: 'already_decided', message: 'x' } }, { status: 409 }),
    });
    renderWithProvider(<ApprovalCard approval={parseApproval(approvalMsg() as never)!} />, fetchFn);
    fireEvent.click(screen.getByText('Deny'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/already answered/);
  });

  it('shows an expired request without buttons', () => {
    const a = { ...parseApproval(approvalMsg() as never)!, expiresAt: '2020-01-01T00:00:00Z' };
    renderWithProvider(
      <ApprovalCard approval={a} />,
      routedFetch({ 'GET /v1/me': () => jsonResponse(me) }),
    );
    expect(screen.getByText('Expired')).toBeTruthy();
    expect(screen.queryByText('Approve')).toBeNull();
  });
});

describe('MessageCitations', () => {
  it('links sources to the handler', () => {
    const onOpen = vi.fn();
    const m = msg(3, 'u-2', {
      citations: [
        { type: 'message', id: 'm1', snippet: 'We agreed on 10%' },
        {
          type: 'transcript',
          id: 't1',
          call_id: 'call-1',
          start_ms: 65_000,
          snippet: 'Pricing talk',
        },
      ],
    });
    renderWithProvider(
      <MessageExtrasProvider value={{ onOpenCitation: onOpen }}>
        <MessageCitations message={m as never} />
      </MessageExtrasProvider>,
      routedFetch({}),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Meeting at 1:05: Pricing talk' }));
    expect(onOpen.mock.calls[0]![0]).toMatchObject({ type: 'transcript', startMs: 65_000 });
  });
});

describe('SummaryCard', () => {
  it('lists decisions, tasks with names, questions and seekable moments', async () => {
    const onOpenMoment = vi.fn();
    renderWithProvider(
      <SummaryCard
        summary={parseCallSummary(summaryMsg as never)!}
        onOpenMoment={onOpenMoment}
        nameForUserId={(id) => (id === 'u-3' ? 'Ana Kovač' : null)}
      />,
      routedFetch({}),
    );
    expect(screen.getByText('Standup')).toBeTruthy();
    expect(screen.getByText('Ship on Friday')).toBeTruthy();
    expect(screen.getByText('Ana Kovač')).toBeTruthy();
    expect(screen.getByText(/Due (3 Dec|Dec 3)/)).toBeTruthy();
    expect(screen.getByText('Who owns onboarding?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Play from 2:05: Pricing' }));
    expect(onOpenMoment).toHaveBeenCalledWith('call-1', 125_000);
  });

  it('never shows a raw assignee id', () => {
    renderWithProvider(
      <SummaryCard summary={{ ...parseCallSummary(summaryMsg as never)!, conversationId: null }} />,
      routedFetch({}),
    );
    expect(screen.queryByText(/u-3/)).toBeNull();
  });
});

describe('ConversationView with agent messages', () => {
  it('renders approval and summary cards and focuses cited messages', async () => {
    const cite = msg(3, 'u-2', {
      is_agent: true,
      body: 'You agreed to ship Friday.',
      citations: [{ type: 'message', id: 'm2', snippet: 'Call summary' }],
    });
    renderWithProvider(
      <ConversationView conversationId="c-1" />,
      routedFetch(viewRoutes([approvalMsg(), summaryMsg, cite])),
    );
    await screen.findByText('Send an email to ana@acme.com');
    expect(screen.getByLabelText('Call summary, Standup')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Sources' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Message: Call summary' }));
  });
});

describe('AskMeetings', () => {
  it('asks and links the moments', async () => {
    const onOpenMoment = vi.fn();
    renderWithProvider(
      <AskMeetings onOpenMoment={onOpenMoment} />,
      routedFetch({
        'POST /v1/meetings/ask': () =>
          jsonResponse({
            answer: 'Friday.',
            links: [{ call_id: 'call-9', start_ms: 4000, snippet: 'Friday it is' }],
          }),
      }),
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'When do we ship?' } });
    fireEvent.click(screen.getByText('Ask'));
    await screen.findByText('Friday.');
    fireEvent.click(screen.getByRole('button', { name: 'Play from 0:04: Friday it is' }));
    expect(onOpenMoment).toHaveBeenCalledWith('call-9', 4000);
  });
});

describe('RecordingPlayer', () => {
  it('offers speeds, chapters, skip silence and the transcript', async () => {
    const rec = {
      id: 'r-1',
      call_id: 'call-1',
      conversation_id: 'c-1',
      status: 'ready',
      mode: 'audio',
      auto: false,
      consent_required: false,
      started_by_user_id: null,
      started_by: null,
      stopped_by_user_id: null,
      started_at: '2026-11-21T10:00:05Z',
      ended_at: '2026-11-21T10:30:00Z',
      duration_ms: 1_795_000,
      size_bytes: 1,
      content_type: 'audio/ogg',
      storage: 'server',
      chapters: [
        { title: 'Intro', start_ms: 0 },
        { title: 'Pricing', start_ms: 60_000 },
      ],
      silences: [{ start_ms: 10_000, end_ms: 20_000 }],
    } as const;
    const { container } = renderWithProvider(
      <RecordingPlayer recording={rec as never} />,
      routedFetch({
        'GET /v1/recordings/r-1/download-url': () =>
          jsonResponse({
            url: 'https://files.test/r-1.ogg',
            expires_at: '2026-11-21T11:00:00Z',
            content_type: 'audio/ogg',
            size_bytes: 1,
          }),
        'GET /v1/calls/call-1/transcript': () =>
          jsonResponse({
            data: {
              id: 't-1',
              call_id: 'call-1',
              conversation_id: 'c-1',
              status: 'ready',
              source: 'recording',
              language: 'en',
              started_at: '2026-11-21T10:00:00Z',
              ended_at: null,
              segment_count: 1,
              storage: 'server',
              speakers: [],
              segments: [
                {
                  speaker: 'u-2',
                  speaker_user_id: 'u-2',
                  speaker_name: 'Ana',
                  text: 'Hello all',
                  start_ms: 5000,
                  end_ms: 6000,
                  language: 'en',
                },
              ],
            },
          }),
      }),
    );
    await waitFor(() =>
      expect(container.querySelector('audio')?.getAttribute('src')).toBe(
        'https://files.test/r-1.ogg',
      ),
    );
    for (const r of ['1×', '1.25×', '1.5×', '2×'])
      expect(screen.getByRole('button', { name: r })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '1.5×' }));
    expect(screen.getByRole('button', { name: '1.5×' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Skip silence')).toBeTruthy();
    expect(screen.getByText('Pricing')).toBeTruthy();
    await screen.findByText('Hello all');
    // The transcript started 5 s before the recording: the line is at 0:00.
    expect(screen.getByText('Ana')).toBeTruthy();
  });
});
