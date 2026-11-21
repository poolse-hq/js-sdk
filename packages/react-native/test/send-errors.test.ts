import { describe, expect, it } from 'vitest';

import { isQuoteGone, sendErrorNotice } from '../src/internal/errors.js';

describe('send errors', () => {
  it('maps a deleted quote target', () => {
    const err = { status: 422, code: 'quoted_message_deleted' };
    expect(sendErrorNotice(err)).toBe('The message you replied to was deleted.');
    expect(isQuoteGone(err)).toBe(true);
  });
  it('other quote problems drop the quote too', () => {
    expect(isQuoteGone({ code: 'quoted_message_not_found' })).toBe(true);
    expect(isQuoteGone({ code: 'rate_limited' })).toBe(false);
    expect(isQuoteGone(null)).toBe(false);
  });
  it('falls back by status, then generically', () => {
    expect(sendErrorNotice({ status: 429 })).toMatch(/too fast/);
    expect(sendErrorNotice(new Error('offline'))).toBe("Couldn't send the message. Try again.");
    expect(sendErrorNotice(undefined)).toBe("Couldn't send the message. Try again.");
  });
});
