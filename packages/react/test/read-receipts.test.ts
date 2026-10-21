import { describe, expect, it } from 'vitest';
import { EDIT_WINDOW_MS, canEditOwnMessage, receiptsOf } from '../src/use-read-receipts.js';

const base = {
  isSelf: true,
  deleted: false,
  insertedAt: '2026-10-21T10:00:00Z',
  now: Date.parse('2026-10-21T10:05:00Z'),
};

describe('canEditOwnMessage', () => {
  it('with receipts visible: editable until someone reads it', () => {
    expect(canEditOwnMessage({ ...base, receiptsVisible: true, readState: 'sent' })).toBe(true);
    expect(canEditOwnMessage({ ...base, receiptsVisible: true, readState: 'read' })).toBe(false);
  });

  it('with receipts hidden: a 15-minute window from sending', () => {
    expect(canEditOwnMessage({ ...base, receiptsVisible: false, readState: undefined })).toBe(true);
    const late = Date.parse(base.insertedAt) + EDIT_WINDOW_MS + 1;
    expect(
      canEditOwnMessage({ ...base, now: late, receiptsVisible: false, readState: undefined }),
    ).toBe(false);
  });

  it('never for someone else’s or a deleted message', () => {
    expect(
      canEditOwnMessage({ ...base, isSelf: false, receiptsVisible: true, readState: 'sent' }),
    ).toBe(false);
    expect(
      canEditOwnMessage({ ...base, deleted: true, receiptsVisible: true, readState: 'sent' }),
    ).toBe(false);
  });
});

describe('receiptsOf', () => {
  it('an older server without the field means receipts on', () => {
    expect(receiptsOf(null)).toEqual({ visible: true, mode: 'on', shared: true, canChange: false });
  });
});
