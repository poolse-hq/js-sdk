import type { Attachment } from '@poolse/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import {
  QUICK_REACTIONS,
  emojiOnlyCount,
  formatBytes,
  hasMarkdown,
  isImageContentType,
  partitionAttachments,
  userColor,
} from '../src/chat-format.js';
import { formatMessageTime, formatTimeOfDay, gutterTime, relativeTime } from '../src/chat-time.js';
import { formatDayLabel } from '../src/grouping.js';
import { mentionedUserIdsIn } from '../src/mention-text.js';
import { presenceBadgeKind, presenceText } from '../src/presence-text.js';

const att = (id: string, content_type: string, clip: object | null = null) =>
  ({ id, content_type, clip }) as unknown as Attachment;

describe('chat format helpers', () => {
  it('images by type in any case; clips apart; the rest are files', () => {
    expect(isImageContentType('Image/PNG')).toBe(true);
    expect(isImageContentType('application/pdf')).toBe(false);
    expect(isImageContentType(null)).toBe(false);
    const clip = att('c', 'video/mp4', { recording_id: 'r', start_ms: 0, end_ms: 1 });
    const { images, clips, files } = partitionAttachments([
      att('i', 'IMAGE/JPEG'),
      clip,
      att('f', 'application/pdf'),
    ]);
    expect(images.map((a) => a.id)).toEqual(['i']);
    expect(clips.map((a) => a.id)).toEqual(['c']);
    expect(files.map((a) => a.id)).toEqual(['f']);
    expect(partitionAttachments(undefined).files).toEqual([]);
  });

  it('one formatBytes: a decimal under 10, whole numbers above', () => {
    expect(formatBytes(820)).toBe('820 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(48_213)).toBe('47 KB');
    expect(formatBytes(3_400_000)).toBe('3.2 MB');
    expect(formatBytes(-1)).toBe('');
  });

  it('stable tints, bubble text shapes, one quick-reaction set', () => {
    expect(userColor('dana')).toBe(userColor('dana'));
    expect(userColor('dana')).toMatch(/^#[0-9a-f]{6}$/);
    expect(hasMarkdown('plain words')).toBe(false);
    expect(hasMarkdown('**bold**')).toBe(true);
    expect(emojiOnlyCount('👍👍')).toBe(2);
    expect(emojiOnlyCount('hi 👍')).toBe(0);
    expect(QUICK_REACTIONS).toHaveLength(6);
  });
});

describe('chat times', () => {
  const NOW = new Date(2026, 10, 26, 15, 0).getTime();
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString();

  it('"yesterday" is the calendar day before, then weekdays, then dates', () => {
    expect(relativeTime(new Date(NOW - 30_000).toISOString(), NOW)).toBe('just now');
    expect(relativeTime(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5m ago');
    expect(relativeTime(at(2026, 10, 25, 9), NOW)).toBe('yesterday');
    // 26 h ago but two calendar days back: not "yesterday".
    const twoDaysBack = new Date(2026, 10, 24, 23, 0);
    expect(relativeTime(twoDaysBack.toISOString(), new Date(2026, 10, 26, 1, 0))).toBe(
      twoDaysBack.toLocaleDateString(undefined, { weekday: 'short' }),
    );
    expect(relativeTime(at(2026, 9, 1), NOW)).toBe(
      new Date(2026, 9, 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    );
    expect(relativeTime(at(2026, 10, 26, 14), NOW, 'short')).toBe('1h');
    expect(relativeTime('nope', NOW)).toBe('');
  });

  it('time of day in the chosen format', () => {
    const d = new Date(2026, 0, 1, 15, 4);
    expect(formatTimeOfDay(d, '24h')).toMatch(/15.04/);
    expect(formatTimeOfDay(d, '12h')).toMatch(/3.04/);
    expect(formatTimeOfDay(d, (x) => `h${x.getHours()}`)).toBe('h15');
    expect(formatMessageTime(null)).toBe('');
    expect(gutterTime('3:04 PM')).toBe('3:04PM');
  });
});

describe('formatDayLabel', () => {
  const tz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = tz;
  });
  it('is not a day off after the spring daylight-saving change', () => {
    process.env.TZ = 'Europe/Berlin';
    // Clocks went forward on 29 March 2026: its midnight is 23 h before the 30th's.
    const now = new Date('2026-03-30T10:00:00+02:00');
    expect(formatDayLabel('2026-03-29T10:00:00+02:00', now)).toBe('Yesterday');
    expect(formatDayLabel('2026-03-30T08:00:00+02:00', now)).toBe('Today');
  });
});

describe('presence', () => {
  it('a call shows over do-not-disturb; DND is said on online and away', () => {
    expect(presenceBadgeKind('in_call', true)).toBe('in_call');
    expect(presenceBadgeKind('online', true)).toBe('dnd');
    expect(presenceBadgeKind('offline', true)).toBeNull();
    expect(presenceText({ state: 'away', last_seen_at: null, do_not_disturb: true })).toBe(
      'Away · Do not disturb',
    );
    expect(presenceText({ state: 'in_call', last_seen_at: null, do_not_disturb: true })).toBe(
      'In a call',
    );
    expect(presenceText({ state: 'offline', last_seen_at: null })).toBe('Offline');
    expect(presenceText(null)).toBeNull();
  });
});

describe('mentionedUserIdsIn', () => {
  const members = [
    { userId: 'u-ann', label: 'Ann' },
    { userId: 'u-anna', label: 'Anna' },
    { userId: 'u-x1', label: 'Sam' },
    { userId: 'u-x2', label: 'Sam' },
    { userId: 'u-none', label: '' },
  ];
  it('picked names, plus members written out by name (a restored draft)', () => {
    expect(mentionedUserIdsIn('hi @Anna!', [], members)).toEqual(['u-anna']);
    expect(mentionedUserIdsIn('@Ann and @Anna', [], members)).toEqual(['u-ann', 'u-anna']);
    // Two people called Sam: only a pick says which.
    expect(mentionedUserIdsIn('@Sam?', [], members)).toEqual([]);
    expect(mentionedUserIdsIn('@Sam?', [{ userId: 'u-x2', label: 'Sam' }], members)).toEqual([
      'u-x2',
    ]);
    expect(mentionedUserIdsIn('no one', [{ userId: 'u-ann', label: 'Ann' }], members)).toEqual([]);
    expect(mentionedUserIdsIn('@', [], members)).toEqual([]);
  });
});
