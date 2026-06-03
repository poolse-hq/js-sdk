import { act, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MentionInput } from '../src/MentionInput.js';
import { jsonResponse, renderWithProvider, scriptedFetch } from './_helpers.js';

// 2.0: memberships carry both uuid (user_id) and the tenant's
// external_id. MentionInput surfaces external_id to consumers; the
// inserted text uses external_id (or the labelFor-transformed version)
// while the wire payload's `mentions` array still uses user_id.
const member = (ext: string, uid = `uid-${ext}`) => ({
  id: `m-${ext}`,
  conversation_id: 'c-1',
  user_id: uid,
  external_id: ext,
  role: 'member' as const,
  last_read_message_id: null,
  last_read_at: null,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

describe('<MentionInput>', () => {
  it('shows a dropdown when user types @', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [member('alice-123'), member('bob-456')] }),
    ]);
    const { container } = renderWithProvider(
      <MentionInput
        conversationId="c-1"
        onSend={vi.fn()}
        labelFor={(id) => id.split('-')[0] ?? id}
      />,
      fetchFn,
    );
    await waitFor(() => expect(fetchFn.calls.length).toBeGreaterThan(0));

    const input = container.querySelector('.poolse-composer__input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(input, { target: { value: '@' } });
    });

    await waitFor(() => expect(container.querySelector('.poolse-mention-menu')).not.toBeNull());
    const items = container.querySelectorAll('.poolse-mention-menu__item');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('alice');
  });

  it('filters the dropdown by query', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [member('alice-123'), member('bob-456')] }),
    ]);
    const { container } = renderWithProvider(
      <MentionInput
        conversationId="c-1"
        onSend={vi.fn()}
        labelFor={(id) => id.split('-')[0] ?? id}
      />,
      fetchFn,
    );
    await waitFor(() => expect(fetchFn.calls.length).toBeGreaterThan(0));
    const input = container.querySelector('.poolse-composer__input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(input, { target: { value: '@bo' } });
    });
    await waitFor(() => {
      const items = container.querySelectorAll('.poolse-mention-menu__item');
      expect(items).toHaveLength(1);
      expect(items[0]?.textContent).toContain('bob');
    });
  });

  it('Enter while picker open inserts the active member', async () => {
    const fetchFn = scriptedFetch([jsonResponse({ data: [member('alice-1')] })]);
    const { container } = renderWithProvider(
      <MentionInput conversationId="c-1" onSend={vi.fn()} labelFor={() => 'alice'} />,
      fetchFn,
    );
    await waitFor(() => expect(fetchFn.calls.length).toBeGreaterThan(0));
    const input = container.querySelector('.poolse-composer__input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(input, { target: { value: '@' } });
    });
    await waitFor(() => expect(container.querySelector('.poolse-mention-menu')).not.toBeNull());
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toMatch(/^@alice /);
    expect(container.querySelector('.poolse-mention-menu')).toBeNull();
  });

  it('submit passes mentions array (poolse user_ids) to onSend', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const fetchFn = scriptedFetch([jsonResponse({ data: [member('alice-1')] })]);
    const { container } = renderWithProvider(
      <MentionInput conversationId="c-1" onSend={onSend} labelFor={() => 'alice'} />,
      fetchFn,
    );
    await waitFor(() => expect(fetchFn.calls.length).toBeGreaterThan(0));
    const input = container.querySelector('.poolse-composer__input') as HTMLTextAreaElement;

    act(() => {
      fireEvent.change(input, { target: { value: '@' } });
    });
    await waitFor(() => expect(container.querySelector('.poolse-mention-menu')).not.toBeNull());
    fireEvent.keyDown(input, { key: 'Enter' });
    act(() => {
      fireEvent.change(input, { target: { value: '@alice hi there' } });
    });
    fireEvent.keyDown(input, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 0));
    // mentions on the wire still uses internal user_id (backend
    // `messages.mentions` column is uuid-typed). Consumer-facing
    // identifiers in display + dedupe are external_id; the wire
    // mention array remains uuid-keyed.
    expect(onSend).toHaveBeenCalledWith({
      body: '@alice hi there',
      mentions: ['uid-alice-1'],
    });
  });
});
