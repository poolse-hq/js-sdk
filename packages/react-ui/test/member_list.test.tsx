import { fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemberList } from '../src/MemberList.js';
import { jsonResponse, noContent, renderWithProvider, scriptedFetch } from './_helpers.js';

const member = (uid: string, role: 'owner' | 'admin' | 'member' = 'member') => ({
  id: `m-${uid}`,
  conversation_id: 'c-1',
  user_id: uid,
  role,
  last_read_message_id: null,
  last_read_at: null,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

describe('<MemberList>', () => {
  it('lists members with role badges', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [member('u-1', 'owner'), member('u-2', 'member')] }),
    ]);
    const { container } = renderWithProvider(
      <MemberList conversationId="c-1" labelFor={(id) => id.toUpperCase()} />,
      fetchFn,
    );
    await waitFor(() =>
      expect(container.querySelectorAll('.poolse-list__item')).toHaveLength(2),
    );
    expect(container.textContent).toContain('U-1');
    expect(container.textContent).toContain('U-2');
    expect(container.textContent).toContain('owner');
    expect(container.textContent).toContain('member');
  });

  it('shows online indicator when onlineUserIds includes user', async () => {
    const fetchFn = scriptedFetch([jsonResponse({ data: [member('u-1')] })]);
    const { container } = renderWithProvider(
      <MemberList conversationId="c-1" onlineUserIds={new Set(['u-1'])} />,
      fetchFn,
    );
    await waitFor(() =>
      expect(container.querySelectorAll('.poolse-list__item')).toHaveLength(1),
    );
    expect(container.querySelector('.poolse-avatar__presence')).not.toBeNull();
    expect(container.textContent).toContain('online');
  });

  it('renders remove button only when canRemove returns true', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [member('u-1', 'owner'), member('u-2', 'member')] }),
    ]);
    const { container } = renderWithProvider(
      <MemberList conversationId="c-1" canRemove={(m) => m.role !== 'owner'} />,
      fetchFn,
    );
    await waitFor(() =>
      expect(container.querySelectorAll('.poolse-list__item')).toHaveLength(2),
    );
    // Only one row (the non-owner) gets the remove button.
    expect(container.querySelectorAll('.poolse-icon-btn--danger')).toHaveLength(1);
  });

  it('clicking remove triggers the DELETE request', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [member('u-1', 'admin')] }),
      noContent(),
    ]);
    const { container } = renderWithProvider(
      <MemberList conversationId="c-1" canRemove={() => true} />,
      fetchFn,
    );
    await waitFor(() =>
      expect(container.querySelectorAll('.poolse-list__item')).toHaveLength(1),
    );
    fireEvent.click(container.querySelector('.poolse-icon-btn--danger')!);
    await waitFor(() => expect(fetchFn.calls.length).toBe(2));
    expect(fetchFn.calls[1]?.method).toBe('DELETE');
    expect(fetchFn.calls[1]?.url).toBe('https://chat.test/v1/conversations/c-1/members/u-1');
  });
});
