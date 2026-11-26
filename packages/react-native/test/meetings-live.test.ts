import { describe, expect, it } from 'vitest';
import {
  arrowHeadPath,
  avatarOverflow,
  captionLines,
  formatCountdown,
  meetingTimeText,
  overrunText,
  pointsToPath,
  qualityBars,
  rsvpSummary,
} from '../src/internal/meetingsLive.js';

const seg = (speaker: string, text: string, start: number, final = true) =>
  ({
    speaker,
    speaker_user_id: null,
    speaker_name: speaker === 's1' ? 'Ana' : 'Ben',
    text,
    start_ms: start,
    end_ms: start + 1000,
    language: 'en',
    final,
  }) as never;

describe('live meeting helpers', () => {
  it('formats countdowns', () => {
    expect(formatCountdown(45)).toBe('0:45');
    expect(formatCountdown(750)).toBe('12:30');
    expect(formatCountdown(3725)).toBe('1:02:05');
    expect(formatCountdown(-3)).toBe('0:00');
    expect(formatCountdown(null)).toBe('0:00');
  });

  it('keeps room for "+N" when avatars overflow', () => {
    expect(avatarOverflow([1, 2, 3], 3)).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(avatarOverflow([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2], more: 3 });
  });

  it('joins one speaker’s run into a caption line and keeps the last two', () => {
    const lines = captionLines([
      seg('s1', 'Hello', 0),
      seg('s1', 'everyone', 1000),
      seg('s2', 'Hi Ana', 2000),
      seg('s1', 'so the plan', 3000, false),
    ]);
    expect(lines.map((l) => `${l.speaker}: ${l.text}${l.interim ? '…' : ''}`)).toEqual([
      'Ben: Hi Ana',
      'Ana: so the plan…',
    ]);
    const long = captionLines([seg('s1', 'x'.repeat(400), 0)], 1, 50)[0]!;
    expect(long.text.length).toBeLessThanOrEqual(50);
    expect(long.text.startsWith('…')).toBe(true);
  });

  it('nudges only past a whole minute', () => {
    expect(overrunText('Budget review', 59_000)).toBeNull();
    expect(overrunText('Budget review', 3 * 60_000 + 5)).toBe('Budget review is 3 min over');
  });

  it('names the end day when a meeting runs past midnight', () => {
    const start = new Date(2026, 10, 24, 23, 0);
    const end = new Date(2026, 10, 25, 1, 0);
    const text = meetingTimeText(
      { startsAt: start.toISOString(), endsAt: end.toISOString() },
      'en-GB',
    )!;
    expect(text).toContain(' – ');
    expect(text.split(' – ')[1]).toContain('25');
    const same = meetingTimeText(
      { startsAt: start.toISOString(), endsAt: new Date(2026, 10, 24, 23, 30).toISOString() },
      'en-GB',
    )!;
    expect(same).not.toContain(' – ');
    expect(same).toContain('–');
  });

  it('summarises RSVPs', () => {
    expect(rsvpSummary({ rsvps: { accepted: ['a', 'b'], tentative: [], declined: ['c'] } })).toBe(
      '2 accepted · 1 declined',
    );
    expect(rsvpSummary({ rsvps: { accepted: [], tentative: [], declined: [] } })).toBeNull();
  });

  it('maps both platforms’ quality to bars', () => {
    expect(qualityBars('excellent')).toBe(3);
    expect(qualityBars('good')).toBe(2);
    expect(qualityBars('poor')).toBe(1);
    expect(qualityBars('lost')).toBe(0);
    expect(qualityBars(undefined)).toBe(0);
  });

  it('builds SVG paths', () => {
    expect(pointsToPath([0, 0, 0.5, 1], 100, 10)).toBe('M0.0 0.0 L50.0 10.0');
    expect(pointsToPath([1, 1])).toBe('M1.0 1.0 l0.1 0');
    expect(pointsToPath([])).toBe('');
    expect(arrowHeadPath({ x: 0, y: 0, w: 100, h: 0, width: 2 })).toMatch(/L100\.0 0\.0/);
  });
});
