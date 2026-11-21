import { describe, expect, it } from 'vitest';

import {
  activeSegmentIndex,
  chapterIndexAt,
  chaptersOf,
  clipOf,
  formatCallSummaryPreview,
  formatClock,
  parseCallSummary,
  silencesOf,
  skipSilenceTarget,
  transcriptOffsetMs,
} from '../src/meetings.js';
import { bodyJson, buildPoolse, jsonResponse, scriptedFetch } from './_helpers.js';

const summaryBody = JSON.stringify({
  kind: 'call_summary',
  call_id: 'call-1',
  style: 'client_call',
  decisions: ['Ship on Friday', { text: 'Keep the price' }, ''],
  action_items: [
    { text: 'Send the contract', assignee_user_id: 'u-2', due: '2026-12-03' },
    { text: 'Book the follow-up' },
    { assignee_user_id: 'u-3' },
  ],
  open_questions: ['Who owns onboarding?'],
  moments: [
    { label: 'Pricing', start_ms: 125_000 },
    { label: 'Intro', start_ms: 0 },
    { label: 'Broken' },
  ],
});

describe('call summaries', () => {
  it('parses the call_summary kind', () => {
    const s = parseCallSummary({
      id: 'm-1',
      conversation_id: 'c-1',
      type: 'custom',
      body: summaryBody,
    });
    expect(s).toMatchObject({
      callId: 'call-1',
      conversationId: 'c-1',
      messageId: 'm-1',
      style: 'client_call',
      decisions: ['Ship on Friday', 'Keep the price'],
      openQuestions: ['Who owns onboarding?'],
      moments: [
        { label: 'Intro', startMs: 0 },
        { label: 'Pricing', startMs: 125_000 },
      ],
    });
    expect(s?.actionItems).toEqual([
      { text: 'Send the contract', assigneeUserId: 'u-2', due: '2026-12-03' },
      { text: 'Book the follow-up', assigneeUserId: null, due: null },
    ]);
    expect(formatCallSummaryPreview(summaryBody)).toBe('Call summary · Client call');
    expect(parseCallSummary({ type: 'text', body: 'hi' })).toBeNull();
    expect(parseCallSummary({ type: 'custom', body: '{"kind":"call_summary"}' })).toBeNull();
  });
});

describe('meetings.ask', () => {
  it('posts the question and maps the links', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({
        answer: 'You agreed to 10% off.',
        links: [{ call_id: 'call-1', start_ms: 61_000, snippet: '10% off' }, { start_ms: 1 }],
      }),
    ]);
    const chat = buildPoolse(fetchFn);
    const res = await chat.meetings.ask({ question: '  What about Acme? ', callId: 'call-1' });
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/meetings/ask');
    expect(await bodyJson(fetchFn.calls[0]!)).toEqual({
      question: 'What about Acme?',
      call_id: 'call-1',
    });
    expect(res).toEqual({
      answer: 'You agreed to 10% off.',
      links: [{ callId: 'call-1', startMs: 61_000, snippet: '10% off' }],
    });
  });
});

describe('clips and playback', () => {
  it('reads clips, chapters and silences', () => {
    expect(clipOf({ clip: { recording_id: 'r-1', start_ms: 1000, end_ms: 5000 } })).toEqual({
      recordingId: 'r-1',
      startMs: 1000,
      endMs: 5000,
    });
    expect(clipOf({ clip: { recording_id: 'r-1', start_ms: 5000, end_ms: 1000 } })).toBeNull();
    expect(clipOf({})).toBeNull();

    const chapters = chaptersOf({
      chapters: [
        { title: 'Pricing', start_ms: 60_000 },
        { title: 'Intro', start_ms: 0 },
      ],
    });
    expect(chapters.map((c) => c.title)).toEqual(['Intro', 'Pricing']);
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
    expect(skipSilenceTarget(silences, 30_100)).toBeNull(); // too short to skip
    expect(skipSilenceTarget(silences, 5_000)).toBeNull();
  });

  it('finds the line under the playhead', () => {
    const segs = [{ start_ms: 0 }, { start_ms: 2000 }, { start_ms: 5000 }];
    expect(activeSegmentIndex(segs, -1)).toBe(-1);
    expect(activeSegmentIndex(segs, 0)).toBe(0);
    expect(activeSegmentIndex(segs, 4999)).toBe(1);
    expect(activeSegmentIndex(segs, 99_999)).toBe(2);
    expect(transcriptOffsetMs('2026-11-21T10:00:05Z', '2026-11-21T10:00:00Z')).toBe(5000);
    expect(transcriptOffsetMs(null, '2026-11-21T10:00:00Z')).toBe(0);
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(3_725_000)).toBe('1:02:05');
  });
});
