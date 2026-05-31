// Shared test scaffolding for resource-level tests. Mirrors the inline
// helpers in rest-client.test.ts so the same scriptedFetch + buildClient
// patterns work across the suite.
import { vi } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { Poolse } from '../src/poolse.js';
import { RestClient } from '../src/rest-client.js';
import { TokenCache } from '../src/token-cache.js';

export function scriptedFetch(
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

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

export function noContent(status = 204): Response {
  return new Response(null, { status });
}

/**
 * Build a low-level RestClient pointed at a scripted fetch. Use when
 * you want to test the client/transport behavior in isolation.
 */
export function buildClient(fetchFn: typeof globalThis.fetch) {
  const config = resolveConfig({
    apiUrl: 'https://chat.test',
    getToken: () => 'jwt-abc',
    fetch: fetchFn,
    maxRetries: 3,
    baseBackoffMs: 0,
    maxBackoffMs: 0,
    generateIdempotencyKey: () => 'idem-fixed',
  });
  return new RestClient(config, new TokenCache(config.getToken));
}

/**
 * Build a full Poolse instance pointed at a scripted fetch. Use this
 * for resource-level tests where you want to exercise the public API
 * shape (e.g. `chat.conversations.one(id).addMembers(...)`).
 */
export function buildPoolse(fetchFn: typeof globalThis.fetch): Poolse {
  return new Poolse({
    apiUrl: 'https://chat.test',
    getToken: () => 'jwt-abc',
    fetch: fetchFn,
    maxRetries: 0, // Resource tests aren't about retry; one-shot is enough.
    baseBackoffMs: 0,
    maxBackoffMs: 0,
    generateIdempotencyKey: () => 'idem-fixed',
  });
}

/** Convenience: parse the first request body as JSON. */
export async function bodyJson(req: Request): Promise<unknown> {
  const txt = await req.clone().text();
  return txt ? JSON.parse(txt) : null;
}
