import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useMembers } from '../src/use-members.js';
import { jsonResponse, noContent, renderHookWithProvider, scriptedFetch } from './_helpers.js';

// Test fixture: every member has both a uuid (user_id) and an
// external_id. The latter is what callers + components consume in 2.0.
const member = (
  ext: string,
  uid = `uid-${ext}`,
  role: 'owner' | 'admin' | 'member' = 'member',
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

describe('useMembers', () => {
  it('lists members on mount', async () => {
    const fetchFn = scriptedFetch([jsonResponse({ data: [member('alice'), member('bob')] })]);
    const { result } = renderHookWithProvider(() => useMembers('c-1'), fetchFn);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.members).toHaveLength(2);
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/conversations/c-1/members');
  });

  it('addMembers appends returned memberships to local state', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [member('alice')] }),
      jsonResponse({ data: [member('bob'), member('carol')] }, { status: 201 }),
    ]);
    const { result } = renderHookWithProvider(() => useMembers('c-1'), fetchFn);

    await waitFor(() => expect(result.current.members).toHaveLength(1));

    await act(async () => {
      await result.current.addMembers(['bob', 'carol']);
    });

    expect(result.current.members.map((m) => m.external_id).sort()).toEqual([
      'alice',
      'bob',
      'carol',
    ]);
  });

  it('addMembers dedupes when server returns a row already in state', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [member('alice')] }),
      jsonResponse({ data: [member('alice')] }, { status: 201 }), // re-add same user
    ]);
    const { result } = renderHookWithProvider(() => useMembers('c-1'), fetchFn);

    await waitFor(() => expect(result.current.members).toHaveLength(1));
    await act(async () => {
      await result.current.addMembers(['alice']);
    });
    expect(result.current.members).toHaveLength(1);
  });

  it('removeMember optimistically removes by external_id', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [member('alice'), member('bob')] }),
      noContent(),
    ]);
    const { result } = renderHookWithProvider(() => useMembers('c-1'), fetchFn);

    await waitFor(() => expect(result.current.members).toHaveLength(2));

    await act(async () => {
      await result.current.removeMember('bob');
    });

    expect(result.current.members.map((m) => m.external_id)).toEqual(['alice']);
    // SDK still hits the user_id-keyed DELETE endpoint under the hood.
    expect(fetchFn.calls[1]?.url).toBe('https://chat.test/v1/conversations/c-1/members/uid-bob');
  });

  it('removeMember rolls back on error', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [member('alice'), member('bob')] }),
      jsonResponse({ error: { code: 'forbidden', message: 'nope', doc_url: '' } }, { status: 403 }),
    ]);
    const { result } = renderHookWithProvider(() => useMembers('c-1'), fetchFn);

    await waitFor(() => expect(result.current.members).toHaveLength(2));

    let caught: unknown = null;
    await act(async () => {
      try {
        await result.current.removeMember('bob');
      } catch (err) {
        caught = err;
      }
    });
    expect(caught).not.toBeNull();
    expect(result.current.members).toHaveLength(2);
  });

  it('removeMember no-ops for an unknown external_id', async () => {
    const fetchFn = scriptedFetch([jsonResponse({ data: [member('alice')] })]);
    const { result } = renderHookWithProvider(() => useMembers('c-1'), fetchFn);

    await waitFor(() => expect(result.current.members).toHaveLength(1));

    await act(async () => {
      await result.current.removeMember('not-a-real-member');
    });

    // No second fetch — we never hit the API for an unknown member.
    expect(fetchFn.calls).toHaveLength(1);
    expect(result.current.members).toHaveLength(1);
  });
});
