import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useMembers } from '../src/use-members.js';
import { jsonResponse, noContent, renderHookWithProvider, scriptedFetch } from './_helpers.js';

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

describe('useMembers', () => {
  it('lists members on mount', async () => {
    const fetchFn = scriptedFetch([jsonResponse({ data: [member('u-1'), member('u-2')] })]);
    const { result } = renderHookWithProvider(() => useMembers('c-1'), fetchFn);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.members).toHaveLength(2);
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/conversations/c-1/members');
  });

  it('addMembers appends returned memberships to local state', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [member('u-1')] }),
      jsonResponse({ data: [member('u-2'), member('u-3')] }, { status: 201 }),
    ]);
    const { result } = renderHookWithProvider(() => useMembers('c-1'), fetchFn);

    await waitFor(() => expect(result.current.members).toHaveLength(1));

    await act(async () => {
      await result.current.addMembers(['bob', 'carol']);
    });

    expect(result.current.members.map((m) => m.user_id).sort()).toEqual(['u-1', 'u-2', 'u-3']);
  });

  it('addMembers dedupes when server returns a row already in state', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [member('u-1')] }),
      jsonResponse({ data: [member('u-1')] }, { status: 201 }), // re-add same user
    ]);
    const { result } = renderHookWithProvider(() => useMembers('c-1'), fetchFn);

    await waitFor(() => expect(result.current.members).toHaveLength(1));
    await act(async () => {
      await result.current.addMembers(['alice']);
    });
    expect(result.current.members).toHaveLength(1);
  });

  it('removeMember optimistically removes', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [member('u-1'), member('u-2')] }),
      noContent(),
    ]);
    const { result } = renderHookWithProvider(() => useMembers('c-1'), fetchFn);

    await waitFor(() => expect(result.current.members).toHaveLength(2));

    await act(async () => {
      await result.current.removeMember('u-2');
    });

    expect(result.current.members.map((m) => m.user_id)).toEqual(['u-1']);
  });

  it('removeMember rolls back on error', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [member('u-1'), member('u-2')] }),
      jsonResponse({ error: { code: 'forbidden', message: 'nope', doc_url: '' } }, { status: 403 }),
    ]);
    const { result } = renderHookWithProvider(() => useMembers('c-1'), fetchFn);

    await waitFor(() => expect(result.current.members).toHaveLength(2));

    let caught: unknown = null;
    await act(async () => {
      try {
        await result.current.removeMember('u-2');
      } catch (err) {
        caught = err;
      }
    });
    expect(caught).not.toBeNull();
    expect(result.current.members).toHaveLength(2);
  });
});
