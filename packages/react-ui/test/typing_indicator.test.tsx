import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { PoolseProvider } from '@poolse/react';
import { TypingIndicator } from '../src/TypingIndicator.js';

// Wraps in a provider — the indicator now uses useDisplayName
// which calls useUser → needs a Poolse instance even when the
// labelFor sync override is in play (the hook still runs).
function wrap(children: ReactNode) {
  return (
    <PoolseProvider
      config={{
        apiUrl: 'https://chat.test',
        getToken: () => 'jwt',
        fetch: async () => new Response('{}'),
      }}
    >
      {children}
    </PoolseProvider>
  );
}

describe('<TypingIndicator>', () => {
  it('keeps the live region mounted with empty text when no one is typing', () => {
    const { container } = render(wrap(<TypingIndicator typing={new Set()} />));
    const root = container.querySelector('.poolse-typing')!;
    // No data-typing attr → CSS visually hides the dot bubble.
    expect(root.getAttribute('data-typing')).toBeNull();
    // Live region must stay mounted so transitions into typing
    // are announced politely.
    const live = root.querySelector('[aria-live="polite"]')!;
    expect(live).not.toBeNull();
    expect(live.textContent).toBe('');
  });

  it('singular: "Alice is typing"', () => {
    const { container } = render(
      wrap(<TypingIndicator typing={new Set(['alice'])} labelFor={() => 'Alice'} />),
    );
    expect(container.textContent).toContain('Alice is typing');
    expect(container.querySelectorAll('.poolse-typing__dot')).toHaveLength(3);
  });

  it('pair: "Alice and Bob are typing"', () => {
    const names = new Map([
      ['a', 'Alice'],
      ['b', 'Bob'],
    ]);
    const { container } = render(
      wrap(<TypingIndicator typing={new Set(['a', 'b'])} labelFor={(id) => names.get(id) ?? id} />),
    );
    expect(container.textContent).toContain('Alice and Bob are typing');
  });

  it('crowd: "3 people are typing"', () => {
    const { container } = render(
      wrap(<TypingIndicator typing={new Set(['a', 'b', 'c'])} labelFor={(id) => id} />),
    );
    expect(container.textContent).toContain('3 people are typing');
  });
});
