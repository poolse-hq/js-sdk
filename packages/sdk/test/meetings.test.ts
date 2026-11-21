import { describe, expect, it, vi } from 'vitest';

import {
  activeSegmentIndex,
  chapterIndexAt,
  chaptersOf,
  clipOf,
  formatCallSummaryPreview,
  formatClock,
  formatDue,
  meetingsErrorMessage,
  momentOf,
  parseCallSummary,
  silencesFromSegments,
  silencesOf,
  skipSilenceTarget,
  summaryStatusText,
} from '../src/meetings.js';
import { Poolse } from '../src/index.js';
import { bodyJson, buildPoolse, jsonResponse, scriptedFetch } from './_helpers.js';

const t = (s: number) => ({ start_ms: s, end_ms: s + 1000, recording_ms: s - 5000 });

// The body as docs/SUMMARIES.md §1 posts it.
const summaryBody = JSON.stringify({
  kind: 'call_summary',
  v: 1,
  call_id: 'call-1',
  summary_id: 'sum-1',
  recording_id: 'rec-1',
  style: 'client_call',
  language: 'en',
  overview: 'Pricing and the contract.',
  decisions: [{ text: 'Ship on Friday', ...t(60_000) }, { text: '' }],
  action_items: [
    {
      id: 'a1',
      text: 'Send the contract',
      assignee_user_id: 'u-2',
      assignee_name: 'Ana',
      due_date: '2026-12-03',
      due_text: 'by Thursday',
      ...t(90_000),
    },
    {
      id: 'a2',
      text: 'Book the follow-up',
      assignee_user_id: null,
      assignee_name: 'Marko',
      due_date: null,
      due_text: 'next week',
      start_ms: null,
      end_ms: null,
      recording_ms: null,
    },
  ],
  open_questions: [{ text: 'Who owns onboarding?', ...t(100_000) }],
  moments: [
    { title: 'Pricing', speaker_name: 'Ana', ...t(125_000) },
    { title: 'Intro', speaker_name: null, ...t(0) },
  ],
  sections: [
    { title: 'Commitments', items: [{ text: 'Weekly status mail', ...t(30_000) }] },
    { title: 'Empty', items: [] },
  ],
});

describe('call summaries', () => {
  it('parses the v1 call_summary message', () => {
    const s = parseCallSummary({
      id: 'm-1',
      conversation_id: 'c-1',
      type: 'system',
      body: summaryBody,
    })!;
    expect(s).toMatchObject({
      id: 'sum-1',
      callId: 'call-1',
      conversationId: 'c-1',
      messageId: 'm-1',
      recordingId: 'rec-1',
      status: 'ready',
      style: 'client_call',
      language: 'en',
      overview: 'Pricing and the contract.',
      shortened: false,
    });
    expect(s.decisions).toEqual([
      { text: 'Ship on Friday', startMs: 60_000, endMs: 61_000, recordingMs: 55_000 },
    ]);
    expect(s.actionItems[0]).toEqual({
      id: 'a1',
      text: 'Send the contract',
      assigneeUserId: 'u-2',
      assigneeName: 'Ana',
      dueDate: '2026-12-03',
      dueText: 'by Thursday',
      startMs: 90_000,
      endMs: 91_000,
      recordingMs: 85_000,
    });
    expect(s.actionItems[1]).toMatchObject({
      assigneeUserId: null,
      assigneeName: 'Marko',
      startMs: null,
    });
    expect(s.moments.map((m) => [m.title, m.speakerName])).toEqual([
      ['Intro', null],
      ['Pricing', 'Ana'],
    ]);
    expect(s.sections).toEqual([
      {
        title: 'Commitments',
        items: [
          { text: 'Weekly status mail', startMs: 30_000, endMs: 31_000, recordingMs: 25_000 },
        ],
      },
    ]);
    expect(momentOf(s, s.moments[1]!)).toEqual({
      callId: 'call-1',
      conversationId: 'c-1',
      startMs: 125_000,
      endMs: 126_000,
      recordingId: 'rec-1',
      recordingMs: 120_000,
    });
    expect(formatCallSummaryPreview(summaryBody)).toBe('Call summary · Client call');
    expect(formatCallSummaryPreview(summaryBody.slice(0, 80))).toBe('Call summary');
    expect(parseCallSummary({ type: 'text', body: 'hi' })).toBeNull();
    expect(parseCallSummary({ type: 'system', body: '{"kind":"call_summary"}' })).toBeNull();
  });

  it('words due dates and statuses', () => {
    expect(formatDue('2026-12-03', 'by Thursday')).toMatch(/Due (3 Dec|Dec 3)/);
    expect(formatDue(null, 'next week')).toBe('next week');
    expect(formatDue(null, null)).toBeNull();
    expect(summaryStatusText({ status: 'ready', error: null })).toBeNull();
    expect(summaryStatusText({ status: 'skipped', error: 'no_model' })).toMatch(/set up/);
    expect(meetingsErrorMessage({ code: 'no_model' })).toMatch(/AI model/);
  });

  it('gets, regenerates and drafts a follow-up', async () => {
    const row = { ...JSON.parse(summaryBody), id: 'sum-1', status: 'queued' };
    const fetchFn = scriptedFetch([
      jsonResponse({ data: { ...row, status: 'ready' } }),
      jsonResponse({ data: row }, { status: 202 }),
      jsonResponse({
        data: {
          call_id: 'call-1',
          summary_id: 'sum-1',
          channel: 'email',
          subject: 'Next steps',
          body: 'Hi all',
          to: [{ user_id: 'u-2', external_id: 'ana', name: 'Ana' }],
          action_items: row.action_items,
        },
      }),
    ]);
    const chat = buildPoolse(fetchFn);
    expect((await chat.meetings.summary('call-1')).status).toBe('ready');
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/calls/call-1/summary');
    expect((await chat.meetings.regenerateSummary('call-1', { style: 'retro' })).status).toBe(
      'queued',
    );
    expect(await bodyJson(fetchFn.calls[1]!)).toEqual({ style: 'retro' });
    const draft = await chat.meetings.followUp('call-1', {
      channel: 'email',
      instructions: ' Short ',
    });
    expect(fetchFn.calls[2]?.url).toBe('https://chat.test/v1/calls/call-1/summary/follow-up');
    expect(await bodyJson(fetchFn.calls[2]!)).toEqual({ channel: 'email', instructions: 'Short' });
    expect(draft).toMatchObject({ subject: 'Next steps', body: 'Hi all', channel: 'email' });
    expect(draft.to).toEqual([{ userId: 'u-2', externalId: 'ana', name: 'Ana' }]);
    expect(draft.actionItems).toHaveLength(2);
  });

  it('hears summary:ready and clip:ready on the conversation', () => {
    const chat = new Poolse({
      apiUrl: 'https://chat.example',
      getToken: () => 'tok',
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
    });
    const conv = chat.realtime.conversation('c-1');
    const ch = (conv as unknown as { channel: { trigger(e: string, p: unknown): void } }).channel;
    const summary = vi.fn();
    const clip = vi.fn();
    conv.onSummaryReady(summary);
    conv.onClipReady(clip);
    ch.trigger('summary:ready', { call_id: 'call-1', conversation_id: 'c-1', summary: {} });
    ch.trigger('clip:ready', { call_id: 'call-1', conversation_id: 'c-1', clip: {} });
    expect(summary).toHaveBeenCalledOnce();
    expect(clip).toHaveBeenCalledOnce();
    chat.destroy();
  });
});

describe('meetings.ask', () => {
  it('posts the question and maps citations and calls', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({
        data: {
          answer: 'You agreed to 10% off.',
          citations: [
            {
              ref: 1,
              kind: 'said',
              call_id: 'call-1',
              conversation_id: 'c-1',
              text: '10% off for a year',
              speaker_name: 'Ana',
              start_ms: 61_000,
              end_ms: 64_000,
              recording_id: 'rec-1',
              recording_ms: 56_000,
            },
            { kind: 'said' },
          ],
          calls: [
            {
              call_id: 'call-1',
              conversation_id: 'c-1',
              conversation_name: 'Acme',
              started_at: null,
              recording_id: 'rec-1',
            },
          ],
        },
      }),
      jsonResponse({ data: { answer: null, citations: [], calls: [] } }),
    ]);
    const chat = buildPoolse(fetchFn);
    const res = await chat.meetings.ask({ question: '  What about Acme? ', conversationId: 'c-1' });
    expect(await bodyJson(fetchFn.calls[0]!)).toEqual({
      question: 'What about Acme?',
      conversation_id: 'c-1',
    });
    expect(res.answer).toBe('You agreed to 10% off.');
    expect(res.citations).toEqual([
      {
        ref: '1',
        kind: 'said',
        callId: 'call-1',
        conversationId: 'c-1',
        text: '10% off for a year',
        speakerName: 'Ana',
        startMs: 61_000,
        endMs: 64_000,
        recordingId: 'rec-1',
        recordingMs: 56_000,
      },
    ]);
    expect(res.calls[0]?.conversationName).toBe('Acme');
    expect((await chat.meetings.ask({ question: 'x' })).answer).toBeNull();
  });
});

describe('clips', () => {
  const clipRow = {
    id: 'clip-1',
    call_id: 'call-1',
    conversation_id: 'c-1',
    recording_id: 'rec-1',
    status: 'queued',
    title: 'Pricing',
    start_ms: 60_000,
    end_ms: 90_000,
    duration_ms: 30_000,
  };

  it('cuts, fetches and shares a clip', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: clipRow }, { status: 202 }),
      jsonResponse({
        url: 'https://files/clip.mp4',
        expires_at: 'x',
        content_type: 'video/mp4',
        size_bytes: 1,
      }),
      jsonResponse(
        { data: { attachment_id: 'att-9', content_type: 'video/mp4' } },
        { status: 201 },
      ),
    ]);
    const chat = buildPoolse(fetchFn);
    const c = await chat.meetings.createClip('rec-1', {
      startMs: 61_000.4,
      endMs: 91_000,
      base: 'transcript',
      title: ' Pricing ',
    });
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/recordings/rec-1/clips');
    expect(await bodyJson(fetchFn.calls[0]!)).toEqual({
      start_ms: 61_000,
      end_ms: 91_000,
      base: 'transcript',
      title: 'Pricing',
    });
    expect(c).toMatchObject({
      id: 'clip-1',
      status: 'queued',
      startMs: 60_000,
      durationMs: 30_000,
    });
    expect((await chat.meetings.clipDownloadUrl('clip-1')).url).toBe('https://files/clip.mp4');
    expect(await chat.meetings.clipAttachment('clip-1')).toEqual({ attachmentId: 'att-9' });
    expect(fetchFn.calls[2]?.url).toBe('https://chat.test/v1/clips/clip-1/attachment');
  });

  it('reads clip attachments only when marked', () => {
    expect(
      clipOf({ clip: { clip_id: 'clip-1', recording_id: 'r-1', start_ms: 1000, end_ms: 5000 } }),
    ).toEqual({ recordingId: 'r-1', startMs: 1000, endMs: 5000, clipId: 'clip-1' });
    expect(clipOf({ clip: { recording_id: 'r-1', start_ms: 5000, end_ms: 1000 } })).toBeNull();
    expect(clipOf({})).toBeNull();
  });
});

describe('playback', () => {
  it('maps the playback reply', async () => {
    const seg = (text: string, start: number, end: number) => ({
      speaker: 'u-2',
      speaker_user_id: 'u-2',
      speaker_name: 'Ana',
      text,
      start_ms: start,
      end_ms: end,
    });
    const fetchFn = scriptedFetch([
      jsonResponse({
        data: {
          recording: { id: 'rec-1', status: 'ready', mode: 'audio' },
          url: 'https://files/rec.ogg',
          expires_at: '2026-11-21T10:05:00Z',
          content_type: 'audio/ogg',
          chapters: [
            { title: 'Pricing', start_ms: 60_000, end_ms: 120_000 },
            { title: 'Intro', start_ms: 0, end_ms: 60_000 },
          ],
          summary_id: 'sum-1',
          transcript: {
            id: 't-1',
            language: 'en',
            offset_ms: -5000,
            segments: [seg('Later', 9000, 9500), seg('Hello', 1000, 2000)],
          },
        },
      }),
    ]);
    const chat = buildPoolse(fetchFn);
    const p = await chat.meetings.playback('rec-1');
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/recordings/rec-1/playback');
    expect(p.url).toBe('https://files/rec.ogg');
    expect(p.chapters.map((c) => c.title)).toEqual(['Intro', 'Pricing']);
    expect(p.chapters[1]!.endMs).toBe(120_000);
    expect(p.transcript?.offsetMs).toBe(-5000);
    expect(p.transcript?.segments.map((s) => s.text)).toEqual(['Hello', 'Later']);
    expect(silencesFromSegments(p.transcript!.segments)).toEqual([{ startMs: 2000, endMs: 9000 }]);
  });

  it('chapters, silences and the line under the playhead', () => {
    const chapters = chaptersOf({
      chapters: [
        { title: 'B', start_ms: 60_000 },
        { title: 'A', start_ms: 0 },
      ],
    });
    expect(chapterIndexAt(chapters, 59_999)).toBe(0);
    expect(chapterIndexAt(chapters, 60_000)).toBe(1);
    const silences = silencesOf({
      silences: [
        { start_ms: 10_000, end_ms: 12_000 },
        { start_ms: 11_000, end_ms: 15_000 },
        { start_ms: 30_000, end_ms: 30_500 },
      ],
    });
    expect(silences).toEqual([
      { startMs: 10_000, endMs: 15_000 },
      { startMs: 30_000, endMs: 30_500 },
    ]);
    expect(skipSilenceTarget(silences, 11_000)).toBe(14_750);
    expect(skipSilenceTarget(silences, 14_900)).toBeNull();
    expect(skipSilenceTarget(silences, 30_100)).toBeNull();
    const segs = [{ start_ms: 0 }, { start_ms: 2000 }, { start_ms: 5000 }];
    expect(activeSegmentIndex(segs, -1)).toBe(-1);
    expect(activeSegmentIndex(segs, 4999)).toBe(1);
    expect(activeSegmentIndex(segs, 99_999)).toBe(2);
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(3_725_000)).toBe('1:02:05');
  });
});
