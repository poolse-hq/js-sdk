import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenCache } from '../src/token-cache.js';

// Helper: build a JWT with the given exp (in seconds since epoch).
// Header / signature are constant — `parseJwtExp` ignores them.
function jwt(exp: number | null, payload: Record<string, unknown> = {}): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(exp === null ? payload : { ...payload, exp }));
  return `${header}.${body}.sig`;
}

function base64url(s: string): string {
  return Buffer.from(s, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('TokenCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serves the same JWT from cache until close to exp', async () => {
    const fetcher = vi.fn(async () => jwt(nowSec() + 3600)); // 1h JWT
    const cache = new TokenCache(fetcher);

    const a = await cache.getToken();
    const b = await cache.getToken();

    expect(a).toBe(b);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refetches when within 30s of exp', async () => {
    let counter = 0;
    const fetcher = vi.fn(async () => {
      counter += 1;
      return jwt(nowSec() + 3600);
    });
    const cache = new TokenCache(fetcher);

    await cache.getToken();
    expect(counter).toBe(1);

    // Jump to 29s before exp — should trigger refresh.
    vi.advanceTimersByTime((3600 - 29) * 1000);
    await cache.getToken();
    expect(counter).toBe(2);
  });

  it('coalesces concurrent calls into a single fetcher invocation', async () => {
    let resolveFetch!: (token: string) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<string>((res) => {
          resolveFetch = res;
        }),
    );
    const cache = new TokenCache(fetcher);

    const a = cache.getToken();
    const b = cache.getToken();
    const c = cache.getToken();

    resolveFetch(jwt(nowSec() + 3600));

    const results = await Promise.all([a, b, c]);
    expect(new Set(results).size).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('caches opaque (non-JWT) tokens for a short fallback window', async () => {
    let counter = 0;
    const fetcher = vi.fn(async () => {
      counter += 1;
      return `opaque-${counter}`;
    });
    const cache = new TokenCache(fetcher);

    expect(await cache.getToken()).toBe('opaque-1');
    expect(await cache.getToken()).toBe('opaque-1'); // cached
    expect(counter).toBe(1);

    vi.advanceTimersByTime(61_000); // > FALLBACK_TTL_MS
    expect(await cache.getToken()).toBe('opaque-2');
    expect(counter).toBe(2);
  });

  it('never caches null', async () => {
    const fetcher = vi.fn(async () => null);
    const cache = new TokenCache(fetcher);

    await cache.getToken();
    await cache.getToken();
    await cache.getToken();

    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('invalidate() forces the next call to re-fetch', async () => {
    let counter = 0;
    const fetcher = vi.fn(async () => {
      counter += 1;
      return jwt(nowSec() + 3600);
    });
    const cache = new TokenCache(fetcher);

    await cache.getToken();
    expect(counter).toBe(1);

    cache.invalidate();
    await cache.getToken();
    expect(counter).toBe(2);
  });

  it('does not cache an already-expired JWT (fresh exp recovery)', async () => {
    // First call returns a JWT with exp in the past — cache shouldn't
    // trust the exp but holds for the fallback TTL to absorb bursts.
    let returnExpired = true;
    const fetcher = vi.fn(async () => (returnExpired ? jwt(nowSec() - 60) : jwt(nowSec() + 3600)));
    const cache = new TokenCache(fetcher);

    await cache.getToken();
    returnExpired = false;

    // Within fallback TTL: still cached.
    await cache.getToken();
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Past fallback TTL: re-fetches.
    vi.advanceTimersByTime(61_000);
    await cache.getToken();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
