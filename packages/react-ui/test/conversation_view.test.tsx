import { PoolseProvider } from '@poolse/react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConversationView } from '../src/index.js';

// Smoke test — confirms the component mounts inside a provider and
// renders empty-state placeholder. We don't test real send flow here
// (that's covered by manual / e2e); just that the React tree wires up.

describe('<ConversationView>', () => {
  it('mounts under a PoolseProvider without throwing', () => {
    const { container } = render(
      <PoolseProvider
        config={{
          apiUrl: 'https://chat.example',
          getToken: () => 'tok',
          fetch: vi.fn(() =>
            Promise.reject(new Error('no network in test')),
          ) as unknown as typeof globalThis.fetch,
        }}
      >
        <ConversationView conversationId="00000000-0000-0000-0000-000000000001" />
      </PoolseProvider>,
    );

    expect(container.querySelector('.poolse-conversation')).not.toBeNull();
    expect(container.querySelector('.poolse-composer')).not.toBeNull();
  });
});
