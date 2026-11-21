import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { PoolseProvider } from '@poolse/react';
import { describe, expect, it, vi } from 'vitest';
import { ConversationView, MentionInput } from '../src/index.js';
import { member, msg, viewRoutes } from './_fixtures.js';
import { jsonResponse, routedFetch } from './_helpers.js';

const NAMES: Record<string, string> = { 'u-ali': 'Alice Smith', 'u-bob': 'Bob Jones' };

function mount(onSend = vi.fn()) {
  const fetchFn = routedFetch({
    'GET /v1/conversations/c-1/members': () =>
      jsonResponse({ data: [member('u-1', 'u-ali'), member('u-2', 'u-bob')] }),
  });
  const utils = render(
    <PoolseProvider
      config={{
        apiUrl: 'https://chat.test',
        getToken: () => 'jwt',
        fetch: fetchFn,
        userResolver: async (id: string) => ({ displayName: NAMES[id] ?? id, avatarUrl: null }),
      }}
    >
      <MentionInput conversationId="c-1" onSend={onSend} />
    </PoolseProvider>,
  );
  const input = utils.container.querySelector('textarea')!;
  const type = (value: string) =>
    act(() => {
      fireEvent.change(input, { target: { value, selectionStart: value.length } });
    });
  return { ...utils, input, type, fetchFn };
}

const items = (c: HTMLElement) => Array.from(c.querySelectorAll('.poolse-mention-menu__item'));

describe('mention suggestions', () => {
  it('match the resolved display name, show an avatar, and navigate by keyboard', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { container, input, type, fetchFn } = mount(onSend);
    await waitFor(() => expect(fetchFn.calls.length).toBeGreaterThan(0));
    type('@');
    await waitFor(() => expect(items(container)[0]?.textContent).toContain('Alice Smith'));
    expect(items(container)[0]?.querySelector('.poolse-avatar')).not.toBeNull();

    type('@jon');
    await waitFor(() => expect(items(container)).toHaveLength(1));
    expect(items(container)[0]?.textContent).toContain('Bob Jones');

    type('@');
    await waitFor(() => expect(items(container)).toHaveLength(2));
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(items(container)[1]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('@Bob Jones ');

    fireEvent.change(input, { target: { value: '@Bob Jones hi' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0]?.[0]).toMatchObject({ body: '@Bob Jones hi', mentions: ['u-2'] });
  });

  it('drops a mention whose @name was deleted before sending', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { container, input, type, fetchFn } = mount(onSend);
    await waitFor(() => expect(fetchFn.calls.length).toBeGreaterThan(0));
    type('@ali');
    await waitFor(() => expect(items(container)).toHaveLength(1));
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.value).toBe('@Alice Smith ');
    fireEvent.change(input, { target: { value: 'never mind' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0]?.[0]).toEqual({ body: 'never mind' });
  });

  it('does not offer the viewer', async () => {
    const { container } = render(
      <PoolseProvider
        config={{
          apiUrl: 'https://chat.test',
          getToken: () => 'jwt',
          fetch: routedFetch(
            viewRoutes([msg(1)], {}, [member('u-me', 'me'), member('u-2', 'two')]),
          ),
        }}
      >
        <ConversationView conversationId="c-1" loadFonts={false} />
      </PoolseProvider>,
    );
    await waitFor(() =>
      expect(container.querySelector('textarea[aria-autocomplete="list"]')).not.toBeNull(),
    );
    const input = container.querySelector('textarea')!;
    act(() => {
      fireEvent.change(input, { target: { value: '@', selectionStart: 1 } });
    });
    await waitFor(() => expect(items(container)).toHaveLength(1));
    expect(items(container)[0]?.textContent).toContain('two');
  });
});
