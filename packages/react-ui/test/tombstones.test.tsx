import { fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConversationView, type ChatLayout } from '../src/index.js';
import { errorResponse, msg, viewRoutes } from './_fixtures.js';
import { renderWithProvider, routedFetch } from './_helpers.js';

const row = (container: HTMLElement, id: string) => {
  const el = container.querySelector(`[data-message-id="${id}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`no row ${id}`);
  return el;
};

const feed = [
  msg(1),
  // A deleted thread root: tombstone with its thread fields kept.
  msg(2, 'u-2', { body: null, deleted_at: '2026-01-01T11:00:00Z', reply_count: 3 }),
  msg(3, 'u-me', {
    quoted_message_id: 'm9',
    quoted_message: {
      id: 'm9',
      sender_id: 'u-2',
      sender_external_id: 'two',
      body: null,
      deleted_at: '2026-01-01T11:00:00Z',
      inserted_at: '2026-01-01T09:00:00Z',
    },
  }),
];

describe('tombstones', () => {
  for (const layout of ['bubbles', 'list', 'compact'] as ChatLayout[]) {
    it(`${layout}: a deleted message reads "This message was deleted" and keeps its thread`, async () => {
      const { container } = renderWithProvider(
        <ConversationView conversationId="c-1" layout={layout} loadFonts={false} />,
        routedFetch(viewRoutes(feed)),
      );
      await waitFor(() => expect(container.textContent).toContain('message 3'));
      const dead = row(container, 'm2');
      expect(dead.querySelector('.poolse-message__body--deleted')?.textContent).toBe(
        'This message was deleted',
      );
      expect(dead.querySelector('.poolse-msg-actions')).toBeNull();
      expect(dead.querySelector('.poolse-reactions')).toBeNull();
      expect(dead.querySelector('[aria-label="View 3 replies"]')).not.toBeNull();
      expect(row(container, 'm3').textContent).toContain('Original message deleted');
    });
  }

  it('maps quoted_message_deleted to a notice, drops the quote and keeps the text', async () => {
    const fetchFn = routedFetch(
      viewRoutes([msg(1)], {
        'POST /v1/conversations/c-1/messages': () => errorResponse(422, 'quoted_message_deleted'),
      }),
    );
    const { container } = renderWithProvider(
      <ConversationView conversationId="c-1" loadFonts={false} />,
      fetchFn,
    );
    await waitFor(() => expect(container.textContent).toContain('message 1'));
    fireEvent.click(row(container, 'm1').querySelector('[aria-label="Reply"]')!);
    expect(container.querySelector('.poolse-composer__reply')).not.toBeNull();

    const input = container.querySelector('textarea')!;
    fireEvent.change(input, { target: { value: 'my answer' } });
    fireEvent.submit(container.querySelector('form.poolse-composer')!);

    await waitFor(() =>
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        'The message you replied to was deleted.',
      ),
    );
    expect(container.querySelector('.poolse-composer__reply')).toBeNull();
    await waitFor(() => expect(container.querySelector('textarea')?.value).toBe('my answer'));
  });
});
