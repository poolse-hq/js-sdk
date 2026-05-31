import { render } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PoolseProvider, usePoolse } from '../src/index.js';

// Smoke test for the provider — confirms PoolseProvider mounts and
// usePoolse() returns the constructed instance. The hooks themselves
// are covered by an end-to-end-style verification rather than per-hook
// unit tests (the values they produce are 99% pass-through of the
// underlying SDK, which has its own tests).

function Reader({ onReady }: { onReady: (chat: unknown) => void }) {
  const chat = usePoolse();
  onReady(chat);
  return null;
}

describe('PoolseProvider', () => {
  it('mounts and exposes the Poolse instance via usePoolse', () => {
    const seen: unknown[] = [];

    render(
      <PoolseProvider
        config={{
          apiUrl: 'https://chat.example',
          getToken: () => 'tok',
          fetch: vi.fn() as unknown as typeof globalThis.fetch,
        }}
      >
        <Reader onReady={(c) => seen.push(c)} />
      </PoolseProvider>,
    );

    expect(seen.length).toBe(1);
    expect((seen[0] as { realtime: unknown }).realtime).toBeDefined();
  });

  it('keeps the same Poolse instance across re-renders with a fresh inline config', () => {
    const seen: unknown[] = [];

    function Harness() {
      const [, setN] = useState(0);
      return (
        <PoolseProvider
          config={{
            // Fresh function + fresh object on every render — would
            // have torn down the SDK with the old `useMemo([config])`
            // wiring.
            apiUrl: 'https://chat.example',
            getToken: () => 'tok',
            fetch: vi.fn() as unknown as typeof globalThis.fetch,
          }}
        >
          <Reader onReady={(c) => seen.push(c)} />
          <button onClick={() => setN((n) => n + 1)}>bump</button>
        </PoolseProvider>
      );
    }

    const { rerender } = render(<Harness />);
    rerender(<Harness />);
    rerender(<Harness />);

    expect(seen.length).toBeGreaterThanOrEqual(3);
    const first = seen[0];
    expect(seen.every((c) => c === first)).toBe(true);
  });

  it('usePoolse throws outside a provider', () => {
    const orig = console.error;
    // React logs the thrown error to console.error during render —
    // suppress so test output stays clean.
    console.error = () => {};

    expect(() => render(<Reader onReady={() => {}} />)).toThrow(/PoolseProvider/);

    console.error = orig;
  });
});
