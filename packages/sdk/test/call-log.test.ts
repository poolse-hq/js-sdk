import { describe, expect, it } from 'vitest';

import {
  callLogDisplayFor,
  describeCallLog,
  formatCallDuration,
  formatCallLogPreview,
  isCallLogMessage,
  isMessageVisibleTo,
  parseCallLog,
  parseCallLogBody,
} from '../src/index.js';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const callBody = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    kind: 'call',
    call_id: 'c1',
    media: 'audio',
    duration_ms: 192_000,
    joined_user_ids: [ME, OTHER],
    ...over,
  });
const missedBody = (userId = ME) =>
  JSON.stringify({ kind: 'call_missed', call_id: 'c1', user_id: userId });

describe('parseCallLog', () => {
  it('parses an answered call from a system message', () => {
    expect(parseCallLog({ type: 'system', body: callBody() })).toEqual({
      kind: 'call',
      callId: 'c1',
      media: 'audio',
      durationMs: 192_000,
      joinedUserIds: [ME, OTHER],
    });
  });

  it('accepts custom messages with the same body', () => {
    expect(parseCallLog({ type: 'custom', body: callBody({ media: 'video' }) })?.kind).toBe('call');
  });

  it('ignores text messages even with a call-log body', () => {
    expect(parseCallLog({ type: 'text', body: callBody() })).toBeNull();
  });

  it('ignores deleted messages', () => {
    expect(
      parseCallLog({ type: 'system', body: callBody(), deleted_at: '2026-01-01T00:00:00Z' }),
    ).toBeNull();
  });

  it('treats null / non-numeric / negative duration as unanswered', () => {
    for (const d of [null, 'x', -5, undefined]) {
      const log = parseCallLog({ type: 'system', body: callBody({ duration_ms: d }) });
      expect(log?.kind === 'call' && log.durationMs).toBeNull();
    }
  });

  it('defaults unknown media to audio and tolerates a missing joined list', () => {
    const log = parseCallLog({
      type: 'system',
      body: callBody({ media: 'hologram', joined_user_ids: 'nope' }),
    });
    expect(log).toMatchObject({ media: 'audio', joinedUserIds: [] });
  });

  it('parses call_missed markers', () => {
    expect(parseCallLog({ type: 'system', body: missedBody() })).toEqual({
      kind: 'call_missed',
      callId: 'c1',
      userId: ME,
      media: null,
    });
  });

  it('returns null for non-JSON, unknown kinds and malformed payloads', () => {
    const bodies = [
      null,
      '',
      'Alice joined the conversation',
      '{not json',
      '[1,2]',
      '{"kind":"member_added","call_id":"c1"}',
      '{"kind":"call"}',
      '{"kind":"call_missed","call_id":"c1"}',
      '"kind"',
    ];
    for (const body of bodies) {
      expect(parseCallLog({ type: 'system', body })).toBeNull();
      expect(isCallLogMessage({ type: 'system', body })).toBe(false);
    }
  });
});

describe('formatCallDuration', () => {
  it('formats m:ss and h:mm:ss', () => {
    expect(formatCallDuration(0)).toBe('0:00');
    expect(formatCallDuration(5_000)).toBe('0:05');
    expect(formatCallDuration(192_000)).toBe('3:12');
    expect(formatCallDuration(3_723_000)).toBe('1:02:03');
    expect(formatCallDuration(-1)).toBe('0:00');
  });
});

describe('describeCallLog', () => {
  it('answered voice + video calls show the duration', () => {
    expect(describeCallLog(parseCallLogBody(callBody())!, ME)).toEqual({
      media: 'audio',
      title: 'Voice call',
      detail: '3:12',
      missed: false,
      summary: 'Voice call · 3:12',
    });
    expect(describeCallLog(parseCallLogBody(callBody({ media: 'video' }))!, null)?.title).toBe(
      'Video call',
    );
  });

  it('unanswered calls read "No answer"', () => {
    expect(describeCallLog(parseCallLogBody(callBody({ duration_ms: null }))!, ME)?.detail).toBe(
      'No answer',
    );
  });

  it('missed marker is visible only to its target', () => {
    const log = parseCallLogBody(missedBody(ME))!;
    expect(describeCallLog(log, ME)).toMatchObject({ title: 'Missed call', missed: true });
    expect(describeCallLog(log, OTHER)).toBeNull();
    expect(describeCallLog(log, null)).toBeNull();
  });
});

describe('visibility + previews', () => {
  it('callLogDisplayFor distinguishes non-call / hidden / visible', () => {
    expect(callLogDisplayFor({ type: 'system', body: 'hi' }, ME)).toBeUndefined();
    expect(callLogDisplayFor({ type: 'system', body: missedBody(OTHER) }, ME)).toBeNull();
    expect(callLogDisplayFor({ type: 'system', body: callBody() }, ME)?.title).toBe('Voice call');
  });

  it('isMessageVisibleTo hides only foreign missed markers', () => {
    expect(isMessageVisibleTo({ type: 'text', body: 'hi' }, ME)).toBe(true);
    expect(isMessageVisibleTo({ type: 'system', body: 'x' }, ME)).toBe(true);
    expect(isMessageVisibleTo({ type: 'system', body: callBody() }, ME)).toBe(true);
    expect(isMessageVisibleTo({ type: 'system', body: missedBody(ME) }, ME)).toBe(true);
    expect(isMessageVisibleTo({ type: 'system', body: missedBody(OTHER) }, ME)).toBe(false);
  });

  it('formatCallLogPreview', () => {
    expect(formatCallLogPreview('hello', ME)).toBeNull();
    expect(formatCallLogPreview(null, ME)).toBeNull();
    expect(formatCallLogPreview(callBody(), ME)).toBe('Voice call · 3:12');
    expect(formatCallLogPreview(missedBody(ME), ME)).toBe('Missed call');
    expect(formatCallLogPreview(missedBody(OTHER), ME)).toBe('Call');
  });
});
