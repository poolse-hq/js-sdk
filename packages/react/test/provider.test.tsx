import { act, render } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PoolseProvider, usePoolse } from '../src/index.js';

// The provider: mounts, hands out one stable Poolse instance, and owns
// (destroys) only the one it built. The hooks have their own test files.

function Reader({ onReady }: { onReady: (chat: unknown) => void }) {
  const chat = usePoolse();
  onReady(chat);
  return null;
}

describe('PoolseProvider', () => {
  it('a client built from config survives StrictMode and is destroyed on unmount', async () => {
    let chat: { destroyed: boolean } | null = null;
    const { unmount } = render(
      <StrictMode>
        <PoolseProvider
          config={{
            apiUrl: 'https://chat.example',
            getToken: () => 'tok',
            fetch: vi.fn() as unknown as typeof globalThis.fetch,
          }}
        >
          <Reader onReady={(c) => (chat = c as { destroyed: boolean })} />
        </PoolseProvider>
      </StrictMode>,
    );
    await act(() => new Promise((r) => setTimeout(r, 10)));
    expect(chat!.destroyed).toBe(false);
    unmount();
    await act(() => new Promise((r) => setTimeout(r, 10)));
    expect(chat!.destroyed).toBe(true);
  });

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
