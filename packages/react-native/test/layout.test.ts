import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatMessageTime,
  mentionsViewer,
  renderSlot,
  type MessageSlotContext,
} from '../src/layout.js';

const msg = (extra: object = {}) =>
  ({
    id: 'm1',
    sender_id: 'u-2',
    mentions: [],
    inserted_at: '2026-01-01T15:04:00Z',
    ...extra,
  }) as never;

describe('formatClock / formatMessageTime', () => {
  const d = new Date(2026, 0, 1, 15, 4);

  it('formats 24h and 12h', () => {
    expect(formatClock(d, '24h')).toMatch(/15.04/);
    expect(formatClock(d, '12h')).toMatch(/3.04/);
  });

  it('uses a formatter as-is', () => {
    expect(formatClock(d, (x) => `h${x.getHours()}`)).toBe('h15');
  });

  it('is empty for a missing or bad timestamp', () => {
    expect(formatMessageTime(null)).toBe('');
    expect(formatMessageTime('nope')).toBe('');
  });
});

describe('mentionsViewer', () => {
  it('is true only for someone else’s message that mentions me', () => {
    expect(mentionsViewer(msg({ mentions: ['u-me'] }), 'u-me')).toBe(true);
    expect(mentionsViewer(msg({ mentions: ['u-3'] }), 'u-me')).toBe(false);
    expect(mentionsViewer(msg({ sender_id: 'u-me', mentions: ['u-me'] }), 'u-me')).toBe(false);
    expect(mentionsViewer(msg({ mentions: ['u-me'] }), null)).toBe(false);
  });
});

describe('renderSlot', () => {
  const ctx = {
    message: msg(),
    isSelf: false,
    sender: { userId: 'u-2', externalId: 'two', displayName: 'Two', avatarUrl: null },
    layout: 'list',
    isRunStart: true,
  } as MessageSlotContext;

  it('returns the default without a slot', () => {
    expect(renderSlot(undefined, ctx, 'default')).toBe('default');
  });

  it('hands the slot its context and the default', () => {
    const seen: unknown[] = [];
    const out = renderSlot(
      (p) => {
        seen.push(p.layout, p.isRunStart, p.sender.displayName, p.children);
        return 'custom';
      },
      ctx,
      'default',
    );
    expect(out).toBe('custom');
    expect(seen).toEqual(['list', true, 'Two', 'default']);
  });
});
