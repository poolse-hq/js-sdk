import { fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConversationView, type ChatLayout } from '../src/index.js';
import { at, errorResponse, msg, viewRoutes } from './_fixtures.js';
import { jsonResponse, renderWithProvider, routedFetch } from './_helpers.js';

const edited = msg(1, 'u-2', { body: 'third take', edited_at: at(5) });
const edits = {
  data: [
    {
      version: 1,
      body: 'first take',
      written_at: at(1),
      replaced_at: at(2),
      editor_id: 'u-2',
    },
    {
      version: 2,
      body: 'second take',
      written_at: at(2),
      replaced_at: at(5),
      editor_id: 'u-2',
    },
  ],
  current_version: 3,
  edited_at: at(5),
};

describe('edit history', () => {
  for (const layout of ['bubbles', 'list', 'compact'] as ChatLayout[]) {
    it(`${layout}: "edited" opens the earlier versions`, async () => {
      const fetchFn = routedFetch(
        viewRoutes([edited], { 'GET /v1/messages/m1/edits': () => jsonResponse(edits) }),
      );
      const { container } = renderWithProvider(
        <ConversationView conversationId="c-1" layout={layout} loadFonts={false} />,
        fetchFn,
      );
      await waitFor(() => expect(container.textContent).toContain('third take'));
      const label = container.querySelector('button.poolse-edited-label')!;
      expect(label.textContent).toBe('edited');
      fireEvent.click(label);
      await waitFor(() =>
        expect(container.querySelector('.poolse-edit-history')?.textContent).toContain(
          'first take',
        ),
      );
      expect(container.querySelector('.poolse-edit-history')?.textContent).toContain('second take');
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(container.querySelector('.poolse-edit-history')).toBeNull();
    });
  }

  it('403 hides the history and leaves plain text', async () => {
    const fetchFn = routedFetch(
      viewRoutes([edited], { 'GET /v1/messages/m1/edits': () => errorResponse(403, 'forbidden') }),
    );
    const { container } = renderWithProvider(
      <ConversationView conversationId="c-1" layout="list" loadFonts={false} />,
      fetchFn,
    );
    await waitFor(() => expect(container.textContent).toContain('third take'));
    fireEvent.click(container.querySelector('button.poolse-edited-label')!);
    await waitFor(() => expect(container.querySelector('button.poolse-edited-label')).toBeNull());
    expect(container.querySelector('.poolse-edit-history')).toBeNull();
    expect(container.querySelector('.poolse-row__edited')?.textContent).toBe('(edited)');
  });
});
