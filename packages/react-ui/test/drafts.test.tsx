import { fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConversationView, type DraftStorage } from '../src/index.js';
import { msg, viewRoutes } from './_fixtures.js';
import { jsonResponse, noContent, renderWithProvider, routedFetch } from './_helpers.js';

function routes() {
  return routedFetch(
    viewRoutes([msg(1)], {
      'GET /v1/conversations/c-2/messages': () =>
        jsonResponse({ data: [{ ...msg(7), id: 'x7', conversation_id: 'c-2' }] }),
      'GET /v1/conversations/c-2/members': () => jsonResponse({ data: [] }),
      'POST /v1/conversations/c-2/read': () => noContent(),
      'POST /v1/conversations/c-1/messages': () => jsonResponse(msg(2, 'u-me')),
    }),
  );
}

const textarea = (c: HTMLElement) => c.querySelector('textarea') as HTMLTextAreaElement;

describe('drafts', () => {
  it('keep text and the quote per conversation across switches, in localStorage too', async () => {
    const { container, rerender } = renderWithProvider(
      <ConversationView conversationId="c-1" loadFonts={false} />,
      routes(),
    );
    await waitFor(() => expect(container.textContent).toContain('message 1'));
    fireEvent.click(container.querySelector('[data-message-id="m1"] [aria-label="Reply"]')!);
    fireEvent.change(textarea(container), { target: { value: 'half a thought' } });
    await waitFor(() =>
      expect(localStorage.getItem('poolse:draft:u-me:c-1')).toContain('half a thought'),
    );
    expect(JSON.parse(localStorage.getItem('poolse:draft:u-me:c-1')!).replyTo.id).toBe('m1');

    rerender(<ConversationView conversationId="c-2" loadFonts={false} />);
    await waitFor(() => expect(container.textContent).toContain('message 7'));
    expect(textarea(container).value).toBe('');
    expect(container.querySelector('.poolse-composer__reply')).toBeNull();

    rerender(<ConversationView conversationId="c-1" loadFonts={false} />);
    await waitFor(() => expect(textarea(container).value).toBe('half a thought'));
    expect(container.querySelector('.poolse-composer__reply')?.textContent).toContain('message 1');

    // Sending clears it.
    fireEvent.submit(container.querySelector('form.poolse-composer')!);
    await waitFor(() => expect(localStorage.getItem('poolse:draft:u-me:c-1')).toBeNull());
  });

  it('uses draftStorage (async) and restores from it', async () => {
    const store = new Map<string, string>([
      ['poolse:draft:u-me:c-2', JSON.stringify({ v: 1, text: 'from storage', replyTo: null })],
    ]);
    const draftStorage: DraftStorage = {
      get: async (k) => store.get(k) ?? null,
      set: vi.fn(async (k: string, v: string) => void store.set(k, v)),
      remove: vi.fn(async (k: string) => void store.delete(k)),
    };
    const { container } = renderWithProvider(
      <ConversationView conversationId="c-2" draftStorage={draftStorage} loadFonts={false} />,
      routes(),
    );
    await waitFor(() => expect(textarea(container).value).toBe('from storage'));
    fireEvent.change(textarea(container), { target: { value: 'from storage, edited' } });
    await waitFor(() => expect(draftStorage.set).toHaveBeenCalled());
    expect(store.get('poolse:draft:u-me:c-2')).toContain('edited');
  });

  it('persistDrafts={false} keeps nothing', async () => {
    const draftStorage: DraftStorage = { get: vi.fn(() => null), set: vi.fn(), remove: vi.fn() };
    const { container } = renderWithProvider(
      <ConversationView
        conversationId="c-1"
        persistDrafts={false}
        draftStorage={draftStorage}
        loadFonts={false}
      />,
      routes(),
    );
    await waitFor(() => expect(container.textContent).toContain('message 1'));
    fireEvent.change(textarea(container), { target: { value: 'gone' } });
    expect(draftStorage.set).not.toHaveBeenCalled();
    expect(draftStorage.get).not.toHaveBeenCalled();
  });
});
