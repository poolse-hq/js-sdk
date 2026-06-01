import { describe, expect, it } from 'vitest';
import { computeGroupPosition, formatDayLabel, sameDay, sameGroup } from '../src/grouping.js';
import type { Message } from '@poolse/sdk';

function msg(
  partial: Partial<Message> & { id: string; sender_id: string; inserted_at: string },
): Message {
  return {
    tenant_id: 't',
    conversation_id: 'c',
    type: 'text',
    body: '',
    reply_to_id: null,
    thread_root_id: null,
    mentions: [],
    reactions: {},
    edited_at: null,
    deleted_at: null,
    sequence: 0,
    updated_at: partial.inserted_at,
    ...partial,
  } as Message;
}

const FIVE_MIN = 5 * 60 * 1000;

describe('computeGroupPosition', () => {
  const a1 = msg({ id: '1', sender_id: 'alice', inserted_at: '2026-06-01T10:00:00Z' });
  const a2 = msg({ id: '2', sender_id: 'alice', inserted_at: '2026-06-01T10:02:00Z' });
  const a3 = msg({ id: '3', sender_id: 'alice', inserted_at: '2026-06-01T10:04:00Z' });
  const b1 = msg({ id: '4', sender_id: 'bob', inserted_at: '2026-06-01T10:05:00Z' });

  it('standalone — no neighbors', () => {
    expect(computeGroupPosition(a1, null, null, FIVE_MIN)).toBe('standalone');
  });

  it('first — next continues, prev does not', () => {
    expect(computeGroupPosition(a1, null, a2, FIVE_MIN)).toBe('first');
  });

  it('middle — both prev and next continue', () => {
    expect(computeGroupPosition(a2, a1, a3, FIVE_MIN)).toBe('middle');
  });

  it('last — prev continues, next does not', () => {
    expect(computeGroupPosition(a3, a2, b1, FIVE_MIN)).toBe('last');
  });

  it('switch sender breaks the group', () => {
    expect(computeGroupPosition(b1, a3, null, FIVE_MIN)).toBe('standalone');
  });

  it('>5min gap breaks the group', () => {
    const a1 = msg({ id: '1', sender_id: 'alice', inserted_at: '2026-06-01T10:00:00Z' });
    const aLater = msg({ id: '2', sender_id: 'alice', inserted_at: '2026-06-01T10:10:00Z' });
    expect(computeGroupPosition(aLater, a1, null, FIVE_MIN)).toBe('standalone');
  });

  it('day boundary breaks the group even if within 5 min', () => {
    // Construct two timestamps that straddle a LOCAL midnight,
    // not UTC midnight, so the assertion holds regardless of the
    // test runner's timezone. midnight = local 00:00; 2 min before
    // and after sits on different calendar days locally.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const beforeMidnight = new Date(today.getTime() - 2 * 60_000).toISOString();
    const afterMidnight = new Date(today.getTime() + 2 * 60_000).toISOString();
    const a1 = msg({ id: '1', sender_id: 'alice', inserted_at: beforeMidnight });
    const a2 = msg({ id: '2', sender_id: 'alice', inserted_at: afterMidnight });
    expect(sameGroup(a1, a2, FIVE_MIN)).toBe(false);
  });
});

describe('sameDay', () => {
  it('returns true for two times on the same local day', () => {
    // Build both stamps from the same local-day start so we don't
    // depend on test runner timezone.
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const morning = new Date(d.getTime() + 1 * 3600_000).toISOString();
    const evening = new Date(d.getTime() + 23 * 3600_000).toISOString();
    expect(sameDay(morning, evening)).toBe(true);
  });
  it('returns false when local day differs', () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const beforeMidnight = new Date(d.getTime() - 1000).toISOString();
    const afterMidnight = new Date(d.getTime() + 1000).toISOString();
    expect(sameDay(beforeMidnight, afterMidnight)).toBe(false);
  });
});

describe('formatDayLabel', () => {
  // Pin "now" so the test isn't time-of-day dependent.
  const now = new Date('2026-06-15T12:00:00Z');

  it('"Today" when same day as now', () => {
    expect(formatDayLabel('2026-06-15T01:00:00Z', now)).toBe('Today');
  });

  it('"Yesterday" when one day before now', () => {
    expect(formatDayLabel('2026-06-14T20:00:00Z', now)).toBe('Yesterday');
  });

  it('weekday name (e.g. "Monday") within the past week', () => {
    const label = formatDayLabel('2026-06-10T12:00:00Z', now);
    // Locale-dependent — just assert it doesn't include the year.
    expect(label).not.toMatch(/\d{4}/);
    expect([
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ]).toContain(label);
  });

  it('day + month (no year) for same-year, older-than-week', () => {
    const label = formatDayLabel('2026-03-15T12:00:00Z', now);
    // Includes some kind of month abbreviation but no 4-digit year.
    expect(label).not.toMatch(/\d{4}/);
  });

  it('full date with year for different year', () => {
    const label = formatDayLabel('2025-06-15T12:00:00Z', now);
    expect(label).toMatch(/2025/);
  });
});
