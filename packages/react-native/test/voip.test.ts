import { describe, expect, it } from 'vitest';

import { isStalePush } from '../src/voice/useVoipCalls.js';

// This decides whether a pushed call is dismissed right after being
// reported. Getting it wrong is silent and total: an over-eager window
// suppresses live calls with nothing in the app to explain it, which is
// exactly how "the phone never rings" happened once already.
describe('isStalePush', () => {
  const NOW = 1_700_000_000_000;
  const WINDOW = 120_000;

  it('treats a fresh push as live', () => {
    expect(isStalePush(NOW - 1_000, NOW, WINDOW)).toBe(false);
  });

  it('treats a clearly old push as stale', () => {
    expect(isStalePush(NOW - WINDOW - 1, NOW, WINDOW)).toBe(true);
  });

  it('never suppresses a call with no timestamp', () => {
    // An older server, or a payload shape that changed, must not cost
    // the user every incoming call.
    expect(isStalePush(undefined, NOW, WINDOW)).toBe(false);
  });

  it('never suppresses a call whose timestamp is in the future', () => {
    // Clock skew runs both ways; a handset behind the server would
    // otherwise see every push as impossibly old.
    expect(isStalePush(NOW + 60_000, NOW, WINDOW)).toBe(false);
  });

  it('tolerates skew smaller than the window', () => {
    expect(isStalePush(NOW - WINDOW + 1_000, NOW, WINDOW)).toBe(false);
  });

  it('ignores a nonsense timestamp rather than acting on it', () => {
    expect(isStalePush(Number.NaN, NOW, WINDOW)).toBe(false);
    expect(isStalePush(Number.POSITIVE_INFINITY, NOW, WINDOW)).toBe(false);
  });

  it('is exactly-at-the-boundary safe', () => {
    // Equal to the window is not past it — ties go to ringing.
    expect(isStalePush(NOW - WINDOW, NOW, WINDOW)).toBe(false);
  });
});
