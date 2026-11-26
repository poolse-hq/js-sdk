// Agent badge, approval card, sources, call summary, ask box, players.

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { approvalFromWire, parseCallSummary } from '@poolse/react';
import { ApprovalCard, MessageCitations } from '../src/Agents.js';
import { Avatar } from '../src/Avatar.js';
import { ConversationView } from '../src/ConversationView.js';
import { MemberList } from '../src/MemberList.js';
import { MessageExtrasProvider } from '../src/messageExtras.js';
import { AskMeetings, RecordingPlayer, SummaryCard } from '../src/Meetings.js';
import { member, me, msg, names, viewRoutes } from './_fixtures.js';
import { jsonResponse, renderWithProvider, routedFetch } from './_helpers.js';

const LONG = 'Scout the Extraordinarily Long-Named Support Triage Assistant';

const approvalRow = (status = 'pending', extra: object = {}) => ({
  id: 'ap-1',
  agent_id: 'ag-1',
  conversation_id: 'c-1',
  tool: 'mail.send_email',
  arguments: { to: 'ana@acme.com', subject: 'Contract', body: 'Hi Ana,\nattached.' },
  status,
  expires_at: '2099-01-01T00:00:00Z',
  inserted_at: '2026-11-21T10:00:00Z',
  ...extra,
});

const agentMsg = msg(1, 'u-2', {
  sender_is_agent: true,
  body: 'I can send the contract to Ana. OK?',
  agent_meta: { kind: 'asked', approval_id: 'ap-1' },
});

const t = (s: number) => ({ start_ms: s, end_ms: s + 1000, recording_ms: s - 5000 });
const summaryMsg = msg(2, 'u-2', {
  type: 'system',
  sender_is_agent: true,
  body: JSON.stringify({
    kind: 'call_summary',
    v: 1,
    call_id: 'call-1',
    summary_id: 's-1',
    recording_id: 'rec-1',
    style: 'standup',
    decisions: [{ text: 'Ship on Friday', ...t(60_000) }],
    action_items: [
      {
        id: 'a1',
        text: 'Send the contract',
        assignee_user_id: 'u-3',
        due_date: '2026-12-03',
        ...t(90_000),
      },
      {
        id: 'a2',
        text: 'Book a room',
        assignee_user_id: null,
        assignee_name: 'Marko',
        due_text: 'next week',
      },
    ],
    open_questions: [{ text: 'Who owns onboarding?' }],
    moments: [{ title: 'Pricing', speaker_name: 'Ana', ...t(125_000) }],
    sections: [{ title: 'Blocked', items: [{ text: 'Waiting on legal' }] }],
  }),
});

describe('agent badge', () => {
  it('marks agent avatars and member rows', async () => {
    const { container } = renderWithProvider(<Avatar name="Scout" agent />, routedFetch({}));
    expect(screen.getByRole('img', { name: 'Scout (agent)' })).toBeTruthy();
    expect(container.querySelector('.poolse-avatar--agent')).toBeTruthy();

    renderWithProvider(
      <MemberList conversationId="c-1" showPresence={false} labelFor={names} />,
      routedFetch({
        'GET /v1/conversations/c-1/members': () =>
          jsonResponse({
            data: [{ ...member('u-2', 'scout'), is_agent: true }, member('u-3', 'ana')],
          }),
      }),
    );
    await screen.findByText('Scout');
    expect(screen.getAllByText('Agent')).toHaveLength(1);
  });
});

describe('ApprovalCard', () => {
  it('approves with a reason and shows the new state', async () => {
    const fetchFn = routedFetch({
      'GET /v1/me': () => jsonResponse(me),
      'POST /v1/me/approvals/ap-1/approve': () =>
        jsonResponse({ data: approvalRow('running', { reason: 'Fine' }) }),
    });
    renderWithProvider(
      <ApprovalCard approval={approvalFromWire(approvalRow())!} agentName={LONG} />,
      fetchFn,
    );
    expect(screen.getByText(LONG)).toBeTruthy();
    expect(screen.getByText('Send email (mail)')).toBeTruthy();
    expect(screen.getByText('Waiting for approval')).toBeTruthy();
    expect(screen.getByText('ana@acme.com')).toBeTruthy();
    fireEvent.click(screen.getByText('Add a reason'));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Fine' } });
    fireEvent.click(screen.getByText('Approve'));
    await screen.findByText('Running…');
    const post = fetchFn.calls.find((r) => r.method === 'POST')!;
    expect(await post.json()).toEqual({ reason: 'Fine' });
    expect(screen.queryByText('Deny')).toBeNull();
  });

  it('explains a refused answer', async () => {
    const fetchFn = routedFetch({
      'GET /v1/me': () => jsonResponse(me),
      'POST /v1/me/approvals/ap-1/deny': () =>
        jsonResponse({ error: { code: 'not_pending', message: 'x' } }, { status: 409 }),
    });
    renderWithProvider(<ApprovalCard approval={approvalFromWire(approvalRow())!} />, fetchFn);
    fireEvent.click(screen.getByText('Deny'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/already answered/);
  });

  it('shows an expired request without buttons', () => {
    const a = approvalFromWire(approvalRow('pending', { expires_at: '2020-01-01T00:00:00Z' }))!;
    renderWithProvider(
      <ApprovalCard approval={a} />,
      routedFetch({ 'GET /v1/me': () => jsonResponse(me) }),
    );
    expect(screen.getByText('Expired')).toBeTruthy();
    expect(screen.queryByText('Approve')).toBeNull();
  });
});

describe('MessageCitations', () => {
  it('numbers sources and links them to the handler', () => {
    const onOpen = vi.fn();
    const m = msg(3, 'u-2', {
      sender_is_agent: true,
      agent_meta: {
        kind: 'asked',
        citations: [
          { n: 1, type: 'message', id: 'm1', snippet: 'We agreed on 10%' },
          {
            n: 2,
            type: 'transcript',
            id: 't1',
            call_id: 'call-1',
            start_ms: 65_000,
            snippet: 'Pricing talk',
          },
        ],
      },
    });
    renderWithProvider(
      <MessageExtrasProvider value={{ onOpenCitation: onOpen }}>
        <MessageCitations message={m as never} />
      </MessageExtrasProvider>,
      routedFetch({}),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Meeting at 1:05: Pricing talk' }));
    expect(onOpen.mock.calls[0]![0]).toMatchObject({ n: 2, type: 'transcript', startMs: 65_000 });
  });
});

describe('SummaryCard', () => {
  it('lists every part with names and seekable times', () => {
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
    expect(screen.getByText('Marko')).toBeTruthy();
    expect(screen.getByText(/next week/)).toBeTruthy();
    expect(screen.getByText('Blocked')).toBeTruthy();
    expect(screen.getByText('Who owns onboarding?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Play from 2:05: Pricing' }));
    expect(onOpenMoment).toHaveBeenCalledWith({
      callId: 'call-1',
      conversationId: 'c-1',
      startMs: 125_000,
      endMs: 126_000,
      recordingId: 'rec-1',
      recordingMs: 120_000,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Play from 1:00' }));
    expect(onOpenMoment.mock.calls[1]![0]).toMatchObject({ recordingMs: 55_000 });
  });

  it('never shows a raw assignee id', () => {
    const s = parseCallSummary(summaryMsg as never)!;
    renderWithProvider(
      <SummaryCard summary={{ ...s, conversationId: null }} live={false} />,
      routedFetch({}),
    );
    expect(screen.queryByText(/u-3/)).toBeNull();
  });

  it('says why there is no summary', () => {
    const s = parseCallSummary(summaryMsg as never)!;
    renderWithProvider(
      <SummaryCard summary={{ ...s, status: 'skipped', error: 'no_speech' }} live={false} />,
      routedFetch({}),
    );
    expect(screen.getByText(/Nothing was said/)).toBeTruthy();
  });
});

describe('ConversationView with agent messages', () => {
  it('renders the approval under the asking message, the summary card and sources', async () => {
    const cite = msg(3, 'u-2', {
      sender_is_agent: true,
      body: 'You agreed to ship Friday [1].',
      agent_meta: {
        kind: 'asked',
        citations: [{ n: 1, type: 'message', id: 'm2', snippet: 'Call summary' }],
      },
    });
    renderWithProvider(
      <ConversationView conversationId="c-1" />,
      routedFetch(
        viewRoutes([agentMsg, summaryMsg, cite], {
          'GET /v1/me/approvals': () => jsonResponse({ data: [approvalRow()] }),
        }),
      ),
    );
    await screen.findByText('Send email (mail)');
    expect(screen.getByLabelText('Call summary, Standup')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Sources' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Message: Call summary' }));
  });
});

describe('AskMeetings', () => {
  it('asks and links the sources', async () => {
    const onOpenMoment = vi.fn();
    renderWithProvider(
      <AskMeetings onOpenMoment={onOpenMoment} />,
      routedFetch({
        'POST /v1/meetings/ask': () =>
          jsonResponse({
            data: {
              answer: 'Friday.',
              citations: [
                {
                  ref: 1,
                  kind: 'said',
                  call_id: 'call-9',
                  text: 'Friday it is',
                  speaker_name: 'Ana',
                  start_ms: 4000,
                  recording_id: 'rec-9',
                  recording_ms: 1000,
                },
              ],
              calls: [],
            },
          }),
      }),
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'When do we ship?' } });
    fireEvent.click(screen.getByText('Ask'));
    await screen.findByText('Friday.');
    fireEvent.click(screen.getByRole('button', { name: 'Play from 0:04: Ana: Friday it is' }));
    expect(onOpenMoment.mock.calls[0]![0]).toMatchObject({ callId: 'call-9', recordingMs: 1000 });
  });

  it('says so when nothing answers', async () => {
    renderWithProvider(
      <AskMeetings />,
      routedFetch({
        'POST /v1/meetings/ask': () =>
          jsonResponse({ data: { answer: null, citations: [], calls: [] } }),
      }),
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Anything?' } });
    fireEvent.click(screen.getByText('Ask'));
    await screen.findByText('Nothing in your meetings answers that.');
  });
});

describe('RecordingPlayer', () => {
  it('offers speeds, chapters, skip silence and the transcript from playback', async () => {
    const { container } = renderWithProvider(
      <RecordingPlayer recordingId="r-1" />,
      routedFetch({
        'GET /v1/recordings/r-1/playback': () =>
          jsonResponse({
            data: {
              recording: { id: 'r-1', status: 'ready', mode: 'audio' },
              url: 'https://files.test/r-1.ogg',
              expires_at: '2026-11-21T11:00:00Z',
              content_type: 'audio/ogg',
              chapters: [
                { title: 'Intro', start_ms: 0, end_ms: 60_000 },
                { title: 'Pricing', start_ms: 60_000, end_ms: 120_000 },
              ],
              summary_id: 's-1',
              transcript: {
                id: 't-1',
                offset_ms: 5000,
                segments: [
                  {
                    speaker: 'u-2',
                    speaker_name: 'Ana',
                    text: 'Hello all',
                    start_ms: 0,
                    end_ms: 1000,
                  },
                  {
                    speaker: 'u-3',
                    speaker_name: 'Marko',
                    text: 'Hi',
                    start_ms: 9000,
                    end_ms: 9500,
                  },
                ],
              },
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
    // No silences listed: the gaps between lines count.
    expect(screen.getByLabelText('Skip silence')).toBeTruthy();
    expect(screen.getByText('Pricing')).toBeTruthy();
    expect(screen.getByText('Hello all')).toBeTruthy();
    expect(screen.getByText('Marko')).toBeTruthy();
  });
});
