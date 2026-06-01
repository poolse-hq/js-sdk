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
  it('renders nothing visible when no one is typing', () => {
    const { container } = render(wrap(<TypingIndicator typing={new Set()} />));
    const root = container.querySelector('.poolse-typing')!;
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelector('.poolse-typing__dots')).toBeNull();
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
