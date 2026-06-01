import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { ApiError, AuthError, NetworkError, RateLimitedError } from '../src/errors.js';
import { RestClient } from '../src/rest-client.js';
import { TokenCache } from '../src/token-cache.js';

/**
 * Builds a fetch mock from a script of canned responses. Each call pops
 * the next entry; if the script is exhausted, the test fails loudly
 * (so we never accidentally pass by "fetch was called fewer times than
 * expected, but the assertion happened to match").
 */
function scriptedFetch(
  script: Array<Response | { throws: unknown }>,
): typeof globalThis.fetch & { calls: Request[] } {
  const calls: Request[] = [];

  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(
      typeof input === 'string' || input instanceof URL ? input : input.url,
      init,
    );
    calls.push(req);

    const next = script.shift();
    if (!next) throw new Error(`fetch called ${calls.length} times but script ran out`);
    if ('throws' in next) throw next.throws;
    return next;
  }) as unknown as typeof globalThis.fetch & { calls: Request[] };

  (fn as unknown as { calls: Request[] }).calls = calls;
  return fn;
}

function buildClient(
  opts: Partial<Parameters<typeof resolveConfig>[0]> & { fetch: typeof globalThis.fetch },
) {
  const config = resolveConfig({
    apiUrl: 'https://chat.test',
    getToken: () => 'jwt-abc',
    maxRetries: 3,
    baseBackoffMs: 0, // make tests instant
    maxBackoffMs: 0,
    generateIdempotencyKey: () => 'idem-fixed',
    ...opts,
  });
  // Tests pre-date the TokenCache; for backwards compatibility the
  // helper wraps the test's `getToken` in one. Tests that care about
  // cache behavior should construct their own.
  return new RestClient(config, new TokenCache(config.getToken));
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('RestClient.request', () => {
  let originalRandom: () => number;

  beforeEach(() => {
    // Pin Math.random so backoff jitter is deterministic.
    originalRandom = Math.random;
    Math.random = () => 0;
  });

  afterEach(() => {
    Math.random = originalRandom;
    vi.useRealTimers();
  });

  describe('happy path', () => {
    it('returns the parsed JSON body on 200', async () => {
      const fetchFn = scriptedFetch([jsonResponse({ id: 'u-1', external_id: 'alice' })]);
      const client = buildClient({ fetch: fetchFn });

      const result = await client.request<{ id: string }>({
        method: 'GET',
        path: '/v1/me',
      });

      expect(result).toEqual({ id: 'u-1', external_id: 'alice' });
    });

    it('returns null on 204 No Content', async () => {
      const fetchFn = scriptedFetch([new Response(null, { status: 204 })]);
      const client = buildClient({ fetch: fetchFn });

      const result = await client.request({ method: 'DELETE', path: '/v1/x' });
      expect(result).toBeNull();
    });
  });

  describe('headers', () => {
    it('attaches Bearer token from getToken', async () => {
      const fetchFn = scriptedFetch([jsonResponse({})]);
      const client = buildClient({ fetch: fetchFn });

      await client.request({ method: 'GET', path: '/v1/me' });

      const headers = fetchFn.calls[0]!.headers;
      expect(headers.get('authorization')).toBe('Bearer jwt-abc');
      expect(headers.get('accept')).toBe('application/json');
    });

    it('skips Authorization when getToken returns null', async () => {
      const fetchFn = scriptedFetch([jsonResponse({})]);
      const client = buildClient({ fetch: fetchFn, getToken: () => null });

      await client.request({ method: 'GET', path: '/v1/me' });

      expect(fetchFn.calls[0]!.headers.get('authorization')).toBeNull();
    });

    it('adds Idempotency-Key for non-GET requests', async () => {
      const fetchFn = scriptedFetch([jsonResponse({ id: 'c-1' }, { status: 201 })]);
      const client = buildClient({ fetch: fetchFn });

      await client.request({ method: 'POST', path: '/v1/conversations', body: { type: 'group' } });

      expect(fetchFn.calls[0]!.headers.get('idempotency-key')).toBe('idem-fixed');
      expect(fetchFn.calls[0]!.headers.get('content-type')).toBe('application/json');
    });

    it('does NOT add Idempotency-Key for GET', async () => {
      const fetchFn = scriptedFetch([jsonResponse({ data: [] })]);
      const client = buildClient({ fetch: fetchFn });

      await client.request({ method: 'GET', path: '/v1/conversations' });
      expect(fetchFn.calls[0]!.headers.get('idempotency-key')).toBeNull();
    });

    it('honours an explicit idempotencyKey override', async () => {
      const fetchFn = scriptedFetch([jsonResponse({}, { status: 201 })]);
      const client = buildClient({ fetch: fetchFn });

      await client.request({
        method: 'POST',
        path: '/v1/x',
        body: { foo: 1 },
        idempotencyKey: 'caller-key',
      });

      expect(fetchFn.calls[0]!.headers.get('idempotency-key')).toBe('caller-key');
    });

    it('omits Idempotency-Key when caller passes null', async () => {
      const fetchFn = scriptedFetch([jsonResponse({}, { status: 201 })]);
      const client = buildClient({ fetch: fetchFn });

      await client.request({
        method: 'POST',
        path: '/v1/x',
        body: { foo: 1 },
        idempotencyKey: null,
      });

      expect(fetchFn.calls[0]!.headers.get('idempotency-key')).toBeNull();
    });
  });

  describe('query strings', () => {
    it('appends defined query params; drops null/undefined', async () => {
      const fetchFn = scriptedFetch([jsonResponse({})]);
      const client = buildClient({ fetch: fetchFn });

      await client.request({
        method: 'GET',
        path: '/v1/audit_logs',
        query: { limit: 25, cursor: 'abc', missing: null, also_missing: undefined },
      });

      expect(fetchFn.calls[0]!.url).toBe('https://chat.test/v1/audit_logs?limit=25&cursor=abc');
    });
  });

  describe('retry on 5xx', () => {
    it('retries up to maxRetries then surfaces the final 5xx as ApiError', async () => {
      const envelope = { error: { code: 'oops', message: 'oops', doc_url: '' } };
      const fetchFn = scriptedFetch([
        jsonResponse(envelope, { status: 500 }),
        jsonResponse(envelope, { status: 502 }),
        jsonResponse(envelope, { status: 503 }),
        jsonResponse(envelope, { status: 504 }),
      ]);
      const client = buildClient({ fetch: fetchFn });

      await expect(client.request({ method: 'GET', path: '/v1/me' })).rejects.toBeInstanceOf(
        ApiError,
      );

      expect(fetchFn.calls.length).toBe(4); // 1 initial + 3 retries
    });

    it('returns the first 2xx after a 5xx', async () => {
      const envelope = { error: { code: 'oops', message: 'oops', doc_url: '' } };
      const fetchFn = scriptedFetch([
        jsonResponse(envelope, { status: 503 }),
        jsonResponse({ id: 'u-1' }),
      ]);
      const client = buildClient({ fetch: fetchFn });

      const result = await client.request<{ id: string }>({ method: 'GET', path: '/v1/me' });
      expect(result).toEqual({ id: 'u-1' });
    });
  });

  describe('retry on 429', () => {
    it('retries and surfaces RateLimitedError when budget exhausted', async () => {
      const envelope = { error: { code: 'rate_limited', message: 'slow down', doc_url: '' } };
      const make429 = () =>
        new Response(JSON.stringify(envelope), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '1' },
        });

      const fetchFn = scriptedFetch([make429(), make429(), make429(), make429()]);
      const client = buildClient({ fetch: fetchFn, baseBackoffMs: 0, maxBackoffMs: 0 });

      const err = await client.request({ method: 'GET', path: '/v1/me' }).catch((e) => e);

      expect(err).toBeInstanceOf(RateLimitedError);
      expect((err as RateLimitedError).retryAfterMs).toBe(1000);
    });
  });

  describe('non-retryable failures', () => {
    it('401 → invalidate token cache, retry ONCE, then AuthError', async () => {
      // First 401 forces a token refresh; second 401 (with the fresh
      // token) is taken as a genuine credentials problem and surfaced.
      const envelope = { error: { code: 'invalid_user_token', message: 'nope', doc_url: '' } };
      const fetchFn = scriptedFetch([
        jsonResponse(envelope, { status: 401 }),
        jsonResponse(envelope, { status: 401 }),
      ]);

      const tokens = ['stale-jwt', 'fresh-jwt'];
      const getToken = vi.fn(async () => tokens.shift() ?? null);
      const config = resolveConfig({
        apiUrl: 'https://chat.test',
        getToken,
        fetch: fetchFn,
        maxRetries: 3,
        baseBackoffMs: 0,
        maxBackoffMs: 0,
        generateIdempotencyKey: () => 'idem-fixed',
      });
      const client = new RestClient(config, new TokenCache(config.getToken));

      const err = await client.request({ method: 'GET', path: '/v1/me' }).catch((e) => e);

      expect(err).toBeInstanceOf(AuthError);
      expect(fetchFn.calls.length).toBe(2);
      expect(getToken).toHaveBeenCalledTimes(2); // initial + post-invalidation
      // Second request carried the refreshed token.
      expect(fetchFn.calls[1]?.headers.get('authorization')).toBe('Bearer fresh-jwt');
    });

    it('401 → refresh → 200 succeeds (clock-skew recovery)', async () => {
      const envelope = { error: { code: 'invalid_user_token', message: 'expired', doc_url: '' } };
      const fetchFn = scriptedFetch([
        jsonResponse(envelope, { status: 401 }),
        jsonResponse({ id: 'u-1', external_id: 'alice' }),
      ]);

      const tokens = ['stale-jwt', 'fresh-jwt'];
      const getToken = vi.fn(async () => tokens.shift() ?? null);
      const config = resolveConfig({
        apiUrl: 'https://chat.test',
        getToken,
        fetch: fetchFn,
        maxRetries: 3,
        baseBackoffMs: 0,
        maxBackoffMs: 0,
        generateIdempotencyKey: () => 'idem-fixed',
      });
      const client = new RestClient(config, new TokenCache(config.getToken));

      const result = await client.request<{ id: string }>({ method: 'GET', path: '/v1/me' });

      expect(result.id).toBe('u-1');
      expect(fetchFn.calls.length).toBe(2);
      expect(fetchFn.calls[1]?.headers.get('authorization')).toBe('Bearer fresh-jwt');
    });

    it('404 → ApiError, no retry', async () => {
      const envelope = { error: { code: 'not_found', message: 'missing', doc_url: '' } };
      const fetchFn = scriptedFetch([jsonResponse(envelope, { status: 404 })]);
      const client = buildClient({ fetch: fetchFn });

      const err = await client.request({ method: 'GET', path: '/v1/x' }).catch((e) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
      expect(fetchFn.calls.length).toBe(1);
    });

    it('422 with details surfaces them on the ApiError', async () => {
      const envelope = {
        error: {
          code: 'validation_failed',
          message: 'bad',
          doc_url: '',
          details: { body: ["can't be blank"] },
        },
      };
      const fetchFn = scriptedFetch([jsonResponse(envelope, { status: 422 })]);
      const client = buildClient({ fetch: fetchFn });

      const err = await client.request({ method: 'POST', path: '/v1/x', body: {} }).catch((e) => e);

      expect((err as ApiError).details).toEqual({ body: ["can't be blank"] });
    });
  });

  describe('network errors', () => {
    it('retries on transient network failure', async () => {
      const fetchFn = scriptedFetch([
        { throws: new TypeError('fetch failed') },
        jsonResponse({ id: 'u-1' }),
      ]);
      const client = buildClient({ fetch: fetchFn });

      const result = await client.request<{ id: string }>({ method: 'GET', path: '/v1/me' });
      expect(result).toEqual({ id: 'u-1' });
    });

    it('surfaces NetworkError when retries exhausted', async () => {
      const fetchFn = scriptedFetch([
        { throws: new TypeError('fetch failed') },
        { throws: new TypeError('fetch failed') },
        { throws: new TypeError('fetch failed') },
        { throws: new TypeError('fetch failed') },
      ]);
      const client = buildClient({ fetch: fetchFn });

      await expect(client.request({ method: 'GET', path: '/v1/me' })).rejects.toBeInstanceOf(
        NetworkError,
      );
    });

    it('does NOT retry an AbortError', async () => {
      const abort = new DOMException('aborted', 'AbortError');
      const fetchFn = scriptedFetch([{ throws: abort }]);
      const client = buildClient({ fetch: fetchFn });

      // AbortError surfaces AS-IS (not wrapped in NetworkError) so
      // callers — useMembers, useConversation, etc. — can detect a
      // caller-initiated abort and skip the "failed to load" branch.
      // Regression test for the alpha.3 fix where StrictMode + the
      // wrapped error caused spurious member-load failures.
      await expect(client.request({ method: 'GET', path: '/v1/me' })).rejects.toBe(abort);
      expect(fetchFn.calls.length).toBe(1);
    });
  });
});
