// Shared test scaffolding for @poolse/react hooks.
//
// Pattern: every hook test builds a scripted fetch, hands it to a
// PoolseProvider that wraps `renderHook`. The hook fetches through
// that scripted fetch, and the test asserts on call URLs/methods/bodies
// plus the hook's returned state.

import { renderHook, type RenderHookOptions, type RenderHookResult } from '@testing-library/react';
import { type ReactNode } from 'react';
import { vi } from 'vitest';
import { PoolseProvider } from '../src/provider.js';

// NOTE: `phoenix` is globally stubbed via test/setup.ts (vitest
// setupFiles). Hooks that touch `chat.realtime.*` get a no-op
// Socket / Channel and never attempt real WS connections.

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
 * Render a hook inside a PoolseProvider wired to the given scripted
 * fetch. Hooks reach the provider's internally-built Poolse instance
 * via `usePoolse()` — that instance's `config.fetch` IS the script,
 * so every call the hook makes hits a canned response.
 *
 * The provider doesn't make any API calls during construction; the
 * script only needs to account for whatever the hook itself triggers.
 */
export function renderHookWithProvider<Result, Props = unknown>(
  hookFn: (initialProps: Props) => Result,
  fetchFn: typeof globalThis.fetch,
  options?: RenderHookOptions<Props>,
): RenderHookResult<Result, Props> {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <PoolseProvider
        config={{
          apiUrl: 'https://chat.test',
          getToken: () => 'jwt-abc',
          fetch: fetchFn,
        }}
      >
        {children}
      </PoolseProvider>
    );
  }
  return renderHook(hookFn, { wrapper: Wrapper, ...options });
}

/** Sleep helper for waiting on next microtask flush. */
export function tick(ms = 0): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
