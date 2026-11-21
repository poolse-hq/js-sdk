import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConversationView, ThreadSummary, type ChatLayout } from '../src/index.js';
import { msg, viewRoutes } from './_fixtures.js';
import { jsonResponse, renderWithProvider, routedFetch } from './_helpers.js';
import { PoolseProvider } from '@poolse/react';

const lastReply = new Date(Date.now() - 5 * 60_000).toISOString();
const root = msg(1, 'u-2', {
  reply_count: 4,
  last_reply_at: lastReply,
  thread_participants: [
    { user_id: 'u-a', external_id: 'alice' },
    { user_id: 'u-b', external_id: 'bob' },
    { user_id: 'u-c', external_id: 'carol' },
    { user_id: 'u-d', external_id: 'dave' },
  ],
});

const config = { apiUrl: 'https://chat.test', getToken: () => 'jwt' };

describe('<ThreadSummary>', () => {
  it('stacks up to three avatars and reads "N replies · last reply …"', () => {
    const { container } = render(
      <PoolseProvider config={{ ...config, fetch: routedFetch({}) }}>
        <ThreadSummary message={root as never} />
      </PoolseProvider>,
    );
    expect(
      container.querySelectorAll('.poolse-thread-summary__avatars .poolse-avatar'),
    ).toHaveLength(3);
    expect(container.textContent).toContain('4 replies');
    expect(container.textContent).toContain('· last reply 5m ago');
  });

  it('renders nothing without replies', () => {
    const { container } = render(
      <PoolseProvider config={{ ...config, fetch: routedFetch({}) }}>
        <ThreadSummary message={msg(2) as never} />
      </PoolseProvider>,
    );
    expect(container.querySelector('.poolse-thread-summary')).toBeNull();
  });
});

describe('thread summary in ConversationView', () => {
  for (const layout of ['bubbles', 'list', 'compact'] as ChatLayout[]) {
    it(`${layout}: shows under the root and opens the thread`, async () => {
      const fetchFn = routedFetch(
        viewRoutes([root], {
          'GET /v1/messages/m1/replies': () => jsonResponse({ data: [] }),
        }),
      );
      const { container } = renderWithProvider(
        <ConversationView conversationId="c-1" layout={layout} loadFonts={false} />,
        fetchFn,
      );
      await waitFor(() => expect(container.querySelector('.poolse-thread-summary')).not.toBeNull());
      const summary = container.querySelector('.poolse-thread-summary')!;
      expect(summary.textContent).toContain('4 replies');
      expect(summary.querySelectorAll('.poolse-avatar')).toHaveLength(3);
      fireEvent.click(summary);
      await waitFor(() => expect(container.querySelector('.poolse-thread')).not.toBeNull());
    });
  }
});
