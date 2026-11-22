import { describe, expect, it } from 'vitest';
import {
  applyLocalVote,
  attachmentKind,
  handNoteToAgent,
  initialBlockValues,
  isPollClosed,
  mediaMessageOf,
  missingInputs,
  pollPercentages,
  toggleVote,
  type Block,
  type Poll,
} from '../src/index.js';
import { bodyJson, buildPoolse, jsonResponse, noContent, scriptedFetch } from './_helpers.js';

const poll = (over: Partial<Poll> = {}): Poll => ({
  options: [
    { id: '1', text: 'Pizza', votes: 3, voter_ids: ['a', 'b', 'c'] },
    { id: '2', text: 'Sushi', votes: 1, voter_ids: ['d'] },
  ],
  multiple: false,
  anonymous: false,
  closes_at: null,
  closed_at: null,
  closed: false,
  voters: 4,
  ...over,
});

const call = (f: { calls: Request[] }, i: number) => ({
  method: f.calls[i]!.method,
  url: f.calls[i]!.url.replace('https://chat.test', ''),
});

describe('messaging plus endpoints', () => {
  it('schedules, lists, updates, cancels and sends now', async () => {
    const sm = { id: 's-1', status: 'scheduled' };
    const f = scriptedFetch([
      jsonResponse(sm, { status: 201 }),
      jsonResponse({ data: [sm] }),
      jsonResponse(sm),
      noContent(),
      jsonResponse({ id: 's-1' }, { status: 201 }),
    ]);
    const chat = buildPoolse(f);
    await chat.conversations
      .one('c-1')
      .messages.schedule({ body: 'hi', send_at: '2026-11-23T08:00:00Z' });
    await chat.scheduledMessages.list({ conversation_id: 'c-1', status: 'all' });
    await chat.scheduledMessages.update('s-1', { send_at: '2026-11-24T08:00:00Z' });
    await chat.scheduledMessages.cancel('s-1');
    await chat.scheduledMessages.sendNow('s-1');
    expect(f.calls.map((_, i) => call(f, i))).toEqual([
      { method: 'POST', url: '/v1/conversations/c-1/scheduled-messages' },
      { method: 'GET', url: '/v1/scheduled-messages?conversation_id=c-1&status=all' },
      { method: 'PATCH', url: '/v1/scheduled-messages/s-1' },
      { method: 'DELETE', url: '/v1/scheduled-messages/s-1' },
      { method: 'POST', url: '/v1/scheduled-messages/s-1/send' },
    ]);
    expect(await bodyJson(f.calls[0]!)).toEqual({ body: 'hi', send_at: '2026-11-23T08:00:00Z' });
  });

  it('votes, closes, pins, forwards, follows, translates and acts', async () => {
    const state = { poll: poll(), my_option_ids: ['1'] };
    const f = scriptedFetch([
      jsonResponse(state),
      jsonResponse(state),
      jsonResponse({ id: 'm-1' }),
      jsonResponse({ id: 'm-1' }),
      jsonResponse({ data: [{ id: 'x' }, { id: 'y' }] }, { status: 201 }),
      jsonResponse({ message_id: 'r', following: false, explicit: true }),
      jsonResponse({ message_id: 'm-1', language: 'de', text: 'Hallo', cached: false }),
      jsonResponse({ action_event_id: 'e-1' }, { status: 202 }),
      jsonResponse({ data: [{ id: 'm-1' }] }),
    ]);
    const chat = buildPoolse(f);
    const m = chat.messages.one('m-1');
    expect((await m.vote(['1'])).my_option_ids).toEqual(['1']);
    await m.closePoll();
    await m.pin();
    await m.unpin();
    expect(await m.forward({ conversation_ids: ['c-2', 'c-3'], comment: 'fyi' })).toHaveLength(2);
    expect((await m.setFollow(false)).following).toBe(false);
    expect((await m.translate('de')).text).toBe('Hallo');
    await m.action({ action_id: 'send', values: { reason: 'ok' } });
    expect(await chat.conversations.one('c-1').messages.pins()).toHaveLength(1);
    expect(f.calls.map((_, i) => call(f, i))).toEqual([
      { method: 'PUT', url: '/v1/messages/m-1/poll/votes' },
      { method: 'POST', url: '/v1/messages/m-1/poll/close' },
      { method: 'POST', url: '/v1/messages/m-1/pin' },
      { method: 'DELETE', url: '/v1/messages/m-1/pin' },
      { method: 'POST', url: '/v1/messages/m-1/forward' },
      { method: 'DELETE', url: '/v1/messages/m-1/follow' },
      { method: 'POST', url: '/v1/messages/m-1/translate' },
      { method: 'POST', url: '/v1/messages/m-1/actions' },
      { method: 'GET', url: '/v1/conversations/c-1/pins' },
    ]);
    expect(await bodyJson(f.calls[0]!)).toEqual({ option_ids: ['1'] });
    expect(await bodyJson(f.calls[6]!)).toEqual({ language: 'de' });
  });

  it('catches up and lists files with versions and previews', async () => {
    const f = scriptedFetch([
      jsonResponse({ summary: 'x', highlights: [], message_count: 3, truncated: false }),
      jsonResponse({ data: [], next_cursor: null }),
      jsonResponse({ data: [{ id: 'a-2' }, { id: 'a-1' }] }),
      jsonResponse({ url: 'https://s/x', expires_at: 'z', content_type: 'image/jpeg' }),
      jsonResponse({ url: 'https://s/p', expires_at: 'z', content_type: 'application/pdf' }),
    ]);
    const chat = buildPoolse(f);
    await chat.conversations.one('c-1').messages.catchUp({ language: 'de' });
    await chat.conversations
      .one('c-1')
      .messages.files({ kind: 'document', limit: 20, before: 'cur' });
    expect(await chat.attachments.versions('a-2')).toHaveLength(2);
    await chat.attachments.thumbnailUrl('a-2');
    await chat.attachments.previewUrl('a-2');
    expect(f.calls.map((_, i) => call(f, i))).toEqual([
      { method: 'POST', url: '/v1/conversations/c-1/catch-up' },
      { method: 'GET', url: '/v1/conversations/c-1/attachments?kind=document&limit=20&before=cur' },
      { method: 'GET', url: '/v1/attachments/a-2/versions' },
      { method: 'GET', url: '/v1/attachments/a-2/thumbnail-url' },
      { method: 'GET', url: '/v1/attachments/a-2/preview-url' },
    ]);
  });

  it('uploads voice messages with purpose and duration', async () => {
    const att = { id: 'a-1' };
    const f = scriptedFetch([
      jsonResponse({
        attachment: att,
        upload: { url: 'https://s/put', method: 'put', headers: {} },
      }),
      new Response(null, { status: 200 }),
    ]);
    const chat = buildPoolse(f);
    await chat.attachments.upload({
      body: new Uint8Array([1]),
      contentType: 'audio/webm',
      byteSize: 1,
      purpose: 'voice',
      durationMs: 1234.6,
    });
    expect(await bodyJson(f.calls[0]!)).toEqual({
      content_type: 'audio/webm',
      byte_size: 1,
      purpose: 'voice',
      duration_ms: 1235,
    });
  });

  it('hands a note to an agent as a Markdown file', async () => {
    const f = scriptedFetch([
      jsonResponse({
        attachment: { id: 'a-9' },
        upload: { url: 'https://s/put', method: 'put', headers: {} },
      }),
      new Response(null, { status: 200 }),
      jsonResponse({ id: 'm-9' }, { status: 201 }),
    ]);
    const chat = buildPoolse(f);
    await handNoteToAgent(chat, {
      conversationId: 'c-a',
      agentUserId: 'u-agent',
      task: 'Summarise this',
      title: 'Q3: plan/draft',
      markdown: '# Q3\n\nText\n',
    });
    expect(await bodyJson(f.calls[0]!)).toMatchObject({
      content_type: 'text/markdown',
      original_filename: 'Q3 plan draft.md',
    });
    expect(await bodyJson(f.calls[2]!)).toMatchObject({
      body: 'Summarise this',
      attachment_ids: ['a-9'],
      mentions: ['u-agent'],
    });
  });
});

describe('poll helpers', () => {
  it('knows when a poll is closed', () => {
    expect(isPollClosed(poll())).toBe(false);
    expect(isPollClosed(poll({ closed: true }))).toBe(true);
    expect(
      isPollClosed(poll({ closes_at: '2026-01-01T00:00:00Z' }), Date.parse('2026-02-01')),
    ).toBe(true);
  });
  it('toggles votes for single and multiple choice', () => {
    expect(toggleVote(poll(), [], '1')).toEqual(['1']);
    expect(toggleVote(poll(), ['1'], '2')).toEqual(['2']);
    expect(toggleVote(poll(), ['1'], '1')).toEqual([]);
    expect(toggleVote(poll({ multiple: true }), ['1'], '2')).toEqual(['1', '2']);
    expect(toggleVote(poll({ multiple: true }), ['1', '2'], '1')).toEqual(['2']);
  });
  it('applies a vote locally and computes percentages', () => {
    const p = applyLocalVote(poll(), [], ['2'], 'me');
    expect(p.voters).toBe(5);
    expect(p.options[1]).toMatchObject({ votes: 2, voter_ids: ['d', 'me'] });
    expect(pollPercentages(p)).toEqual({ '1': 60, '2': 40 });
    const back = applyLocalVote(p, ['2'], [], 'me');
    expect(back.voters).toBe(4);
    expect(pollPercentages(poll({ options: [] }))).toEqual({});
  });
});

describe('blocks and attachment helpers', () => {
  const blocks: Block[] = [
    { type: 'input', action_id: 'reason', label: 'Reason', input: 'text', required: true },
    { type: 'input', action_id: 'tags', label: 'Tags', input: 'checkboxes', options: [] },
    {
      type: 'actions',
      elements: [
        {
          type: 'select',
          action_id: 'env',
          options: [{ text: 'Prod', value: 'prod' }],
          initial_value: 'prod',
        },
      ],
    },
  ];
  it('starts forms empty and reports missing required inputs', () => {
    const v = initialBlockValues(blocks);
    expect(v).toEqual({ reason: '', tags: [], env: 'prod' });
    expect(missingInputs(blocks, v).map((b) => b.action_id)).toEqual(['reason']);
    expect(missingInputs(blocks, { ...v, reason: 'x' })).toEqual([]);
  });
  it('guesses kinds and finds the media attachment', () => {
    expect(
      attachmentKind({
        content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    ).toBe('document');
    expect(attachmentKind({ content_type: 'audio/ogg' })).toBe('audio');
    expect(attachmentKind({ content_type: 'x/y', kind: 'video' })).toBe('video');
    const a = { id: 'v', purpose: 'voice' } as never;
    expect(mediaMessageOf({ attachments: [{ id: 'f' } as never, a] })).toBe(a);
    expect(mediaMessageOf({})).toBeNull();
  });
});
