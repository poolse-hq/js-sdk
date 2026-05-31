// Shared test scaffolding for @poolse/react-ui — mirrors the
// helpers in @poolse/react. Each component test builds a scripted
// fetch, wraps the component in a PoolseProvider pointed at it,
// and asserts on rendered output + interaction.

import { render, type RenderOptions } from '@testing-library/react';
import { type ReactElement, type ReactNode } from 'react';
import { vi } from 'vitest';
import { PoolseProvider } from '@poolse/react';

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
 * Render a tree inside a PoolseProvider wired to a scripted fetch.
 */
export function renderWithProvider(
  ui: ReactElement,
  fetchFn: typeof globalThis.fetch,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
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
  return render(ui, { wrapper: Wrapper, ...options });
}
