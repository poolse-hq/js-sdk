import { fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemberList } from '../src/MemberList.js';
import { jsonResponse, noContent, renderWithProvider, scriptedFetch } from './_helpers.js';

// 2.0 wire format: every membership carries `external_id` alongside
// the internal `user_id`. Tests pass external_id explicitly so the
// fixtures look like what the backend actually emits.
const member = (
  ext: string,
  role: 'owner' | 'admin' | 'member' = 'member',
  uid = `uid-${ext}`,
) => ({
  id: `m-${ext}`,
  conversation_id: 'c-1',
  user_id: uid,
  external_id: ext,
  role,
  last_read_message_id: null,
  last_read_at: null,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

describe('<MemberList>', () => {
  it('lists members with role badges', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [member('alice', 'owner'), member('bob', 'member')] }),
    ]);
    const { container } = renderWithProvider(
      <MemberList conversationId="c-1" labelFor={(id) => id.toUpperCase()} />,
      fetchFn,
    );
    await waitFor(() => expect(container.querySelectorAll('.poolse-list__item')).toHaveLength(2));
    expect(container.textContent).toContain('ALICE');
    expect(container.textContent).toContain('BOB');
    expect(container.textContent).toContain('owner');
    expect(container.textContent).toContain('member');
  });

  it('shows online indicator when onlineExternalIds includes user', async () => {
    const fetchFn = scriptedFetch([jsonResponse({ data: [member('alice')] })]);
    const { container } = renderWithProvider(
      <MemberList conversationId="c-1" onlineExternalIds={new Set(['alice'])} />,
      fetchFn,
    );
    await waitFor(() => expect(container.querySelectorAll('.poolse-list__item')).toHaveLength(1));
    expect(container.querySelector('.poolse-avatar__presence')).not.toBeNull();
    expect(container.textContent).toContain('online');
  });

  it('renders remove button only when canRemove returns true', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [member('alice', 'owner'), member('bob', 'member')] }),
    ]);
    const { container } = renderWithProvider(
      <MemberList conversationId="c-1" canRemove={(m) => m.role !== 'owner'} />,
      fetchFn,
    );
    await waitFor(() => expect(container.querySelectorAll('.poolse-list__item')).toHaveLength(2));
    expect(container.querySelectorAll('.poolse-icon-btn--danger')).toHaveLength(1);
  });

  it('clicking remove triggers the DELETE request keyed by internal user_id', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [member('alice', 'admin')] }),
      noContent(),
    ]);
    const { container } = renderWithProvider(
      <MemberList conversationId="c-1" canRemove={() => true} />,
      fetchFn,
    );
    await waitFor(() => expect(container.querySelectorAll('.poolse-list__item')).toHaveLength(1));
    fireEvent.click(container.querySelector('.poolse-icon-btn--danger')!);
    await waitFor(() => expect(fetchFn.calls.length).toBe(2));
    expect(fetchFn.calls[1]?.method).toBe('DELETE');
    // SDK translates external_id ('alice') → internal user_id ('uid-alice')
    // before hitting the DELETE endpoint. The consumer never sees the
    // uuid; the API still uses it.
    expect(fetchFn.calls[1]?.url).toBe('https://chat.test/v1/conversations/c-1/members/uid-alice');
  });
});
