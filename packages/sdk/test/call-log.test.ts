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
      version: 1,
      callKind: 'call',
      callerUserId: null,
      participants: [],
      endReason: null,
      startedAt: null,
      endedAt: null,
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
      direction: null,
      callBack: false,
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

const THIRD = '33333333-3333-4333-8333-333333333333';

const v2 = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    kind: 'call',
    v: 2,
    call_id: 'c2',
    media: 'audio',
    caller_user_id: OTHER,
    started_at: 1_000,
    ended_at: 200_000,
    end_reason: 'finished',
    duration_ms: 192_000,
    joined_user_ids: [OTHER, ME],
    participants: [{ user_id: ME, status: 'joined' }],
    ...over,
  });

const describeV2 = (over: Record<string, unknown>, viewer: string | null) =>
  describeCallLog(parseCallLogBody(v2(over))!, viewer);

describe('v2 call records — one per call, worded per viewer', () => {
  it('parses caller, participants, reason and times', () => {
    expect(parseCallLogBody(v2())).toMatchObject({
      version: 2,
      callerUserId: OTHER,
      participants: [{ userId: ME, status: 'joined' }],
      endReason: 'finished',
      startedAt: 1_000,
      endedAt: 200_000,
    });
  });

  it('drops malformed participants instead of failing the record', () => {
    const log = parseCallLogBody(
      v2({
        participants: [{ user_id: ME, status: 'joined' }, { user_id: 7 }, { status: 'x' }, null],
      }),
    );
    expect(log?.kind === 'call' && log.participants).toEqual([{ userId: ME, status: 'joined' }]);
  });

  it('the caller sees an outgoing call, with its duration once answered', () => {
    expect(describeV2({}, OTHER)).toMatchObject({
      title: 'Outgoing voice call',
      detail: '3:12',
      direction: 'outgoing',
      callBack: false,
    });
  });

  it('an unanswered caller sees why, and is offered a call back', () => {
    const unanswered = { duration_ms: null, participants: [{ user_id: ME, status: 'missed' }] };
    expect(describeV2({ ...unanswered, end_reason: 'no_answer' }, OTHER)).toMatchObject({
      detail: 'No answer',
      callBack: true,
    });
    expect(describeV2({ ...unanswered, end_reason: 'cancelled' }, OTHER)?.detail).toBe('Cancelled');
    expect(
      describeV2(
        {
          ...unanswered,
          end_reason: 'declined_all',
          participants: [{ user_id: ME, status: 'declined' }],
        },
        OTHER,
      )?.detail,
    ).toBe('Declined');
    expect(
      describeV2(
        {
          ...unanswered,
          end_reason: 'declined_all',
          participants: [{ user_id: ME, status: 'busy' }],
        },
        OTHER,
      )?.detail,
    ).toBe('Busy');
  });

  it('someone who answered sees an incoming call with its duration', () => {
    expect(describeV2({}, ME)).toMatchObject({
      title: 'Incoming voice call',
      detail: '3:12',
      direction: 'incoming',
      missed: false,
    });
  });

  it('someone who missed it sees a missed call in the error tone', () => {
    const d = describeV2(
      { media: 'video', duration_ms: null, participants: [{ user_id: ME, status: 'missed' }] },
      ME,
    );
    expect(d).toMatchObject({ title: 'Missed video call', missed: true, callBack: true });
    expect(d?.summary).toBe('Missed video call');
  });

  it('a decline and a busy refusal read as such', () => {
    expect(describeV2({ participants: [{ user_id: ME, status: 'declined' }] }, ME)).toMatchObject({
      detail: 'You declined',
      missed: false,
      callBack: true,
    });
    expect(describeV2({ participants: [{ user_id: ME, status: 'busy' }] }, ME)).toMatchObject({
      title: 'Missed voice call',
      detail: 'You were on another call',
      missed: true,
    });
  });

  it('group calls say so', () => {
    const group = {
      participants: [
        { user_id: ME, status: 'missed' },
        { user_id: THIRD, status: 'joined' },
      ],
    };
    expect(describeV2(group, ME)?.title).toBe('Missed group voice call');
    expect(describeV2(group, THIRD)?.title).toBe('Group voice call');
  });

  it('a member the call never involved gets the neutral wording', () => {
    expect(describeV2({}, THIRD)).toMatchObject({ title: 'Voice call', direction: null });
    expect(describeV2({}, null)?.title).toBe('Voice call');
  });

  it('previews word the record for the viewer', () => {
    const missed = v2({ duration_ms: null, participants: [{ user_id: ME, status: 'missed' }] });
    expect(formatCallLogPreview(missed, ME)).toBe('Missed voice call');
    expect(formatCallLogPreview(missed, OTHER)).toBe('Outgoing voice call · No answer');
  });
});

describe('rooms in the history', () => {
  it('reads as a room with its length and how many joined, for everyone', () => {
    const room = v2({
      call_kind: 'room',
      media: 'video',
      joined_user_ids: [ME, OTHER, THIRD],
      participants: [],
    });
    for (const viewer of [ME, OTHER, null]) {
      expect(describeCallLog(parseCallLogBody(room)!, viewer)).toMatchObject({
        title: 'Video room',
        detail: '3:12 · 3 joined',
        missed: false,
        callBack: false,
      });
    }
  });
});
