import { fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConversationList } from '../src/ConversationList.js';
import { jsonResponse, renderWithProvider, scriptedFetch } from './_helpers.js';

const conv = (id: string, name?: string) => ({
  id,
  tenant_id: 't-1',
  type: 'group' as const,
  name: name ?? `Channel ${id}`,
  avatar_url: null,
  created_by_user_id: 'u-1',
  member_limit: null,
  custom_data: {},
  settings: {},
  last_message_at: null,
  last_sequence: 0,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const me = {
  id: 'u-me',
  tenant_id: 't-1',
  external_id: 'me',
  display_name: null,
  custom_data: {},
  is_blocked: false,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('<ConversationList>', () => {
  it('renders the loading placeholder before the list resolves', () => {
    // Two pending fetches: /v1/me + /v1/conversations. The component
    // shows "Loading…" while both are in flight.
    const fetchFn = scriptedFetch([
      jsonResponse(me),
      // No second response — keeps the conversations fetch pending.
    ]);
    const { container } = renderWithProvider(<ConversationList />, fetchFn);
    expect(container.textContent).toMatch(/loading/i);
  });

  it('renders one row per conversation once loaded', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse(me),
      jsonResponse({ data: [conv('c-1', 'general'), conv('c-2', 'random')] }),
    ]);
    const { container } = renderWithProvider(<ConversationList />, fetchFn);
    await waitFor(() => {
      expect(container.querySelectorAll('.poolse-list__item')).toHaveLength(2);
    });
    expect(container.textContent).toContain('general');
    expect(container.textContent).toContain('random');
  });

  it('marks selected row with aria-selected', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse(me),
      jsonResponse({ data: [conv('c-1'), conv('c-2')] }),
    ]);
    const { container } = renderWithProvider(<ConversationList selectedId="c-2" />, fetchFn);
    await waitFor(() => {
      const sel = container.querySelectorAll('[aria-selected="true"]');
      expect(sel).toHaveLength(1);
    });
  });

  it('fires onSelect with the conversation on click', async () => {
    const onSelect = vi.fn();
    const fetchFn = scriptedFetch([
      jsonResponse(me),
      jsonResponse({ data: [conv('c-1')] }),
    ]);
    const { container } = renderWithProvider(
      <ConversationList onSelect={onSelect} />,
      fetchFn,
    );
    await waitFor(() => expect(container.querySelectorAll('.poolse-list__item')).toHaveLength(1));
    fireEvent.click(container.querySelector('.poolse-list__item')!);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0].id).toBe('c-1');
  });

  it('renderItem escape hatch replaces the default row', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse(me),
      jsonResponse({ data: [conv('c-1', 'one')] }),
    ]);
    const { container } = renderWithProvider(
      <ConversationList renderItem={(c) => <span>custom:{c.name}</span>} />,
      fetchFn,
    );
    await waitFor(() => expect(container.textContent).toContain('custom:one'));
  });
});
