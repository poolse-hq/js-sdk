import { act, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MentionInput } from '../src/MentionInput.js';
import { jsonResponse, renderWithProvider, scriptedFetch } from './_helpers.js';

const member = (uid: string) => ({
  id: `m-${uid}`,
  conversation_id: 'c-1',
  user_id: uid,
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
    // Wait for members fetch to resolve.
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

  it('submit passes mentions array to onSend', async () => {
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
    // Now type the rest of the message.
    act(() => {
      fireEvent.change(input, { target: { value: '@alice hi there' } });
    });
    fireEvent.keyDown(input, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 0));
    expect(onSend).toHaveBeenCalledWith({
      body: '@alice hi there',
      mentions: ['alice-1'],
    });
  });
});
