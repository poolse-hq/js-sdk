import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useConversation } from '../src/use-conversation.js';
import { jsonResponse, renderHookWithProvider, scriptedFetch } from './_helpers.js';

const conv = {
  id: 'c-1',
  tenant_id: 't-1',
  type: 'group' as const,
  name: 'general',
  avatar_url: null,
  created_by_user_id: 'u-1',
  member_limit: null,
  custom_data: {},
  settings: {},
  last_message_at: null,
  last_sequence: 0,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('useConversation', () => {
  it('fetches the conversation on mount and exposes it', async () => {
    const fetchFn = scriptedFetch([jsonResponse(conv)]);
    const { result } = renderHookWithProvider(() => useConversation('c-1'), fetchFn);

    expect(result.current.loading).toBe(true);
    expect(result.current.conversation).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.conversation?.id).toBe('c-1');
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/conversations/c-1');
  });

  it('surfaces errors via state', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ error: { code: 'not_found', message: 'gone', doc_url: '' } }, { status: 404 }),
    ]);
    const { result } = renderHookWithProvider(() => useConversation('c-1'), fetchFn);

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.conversation).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('returns null + not-loading when id is null (route placeholder)', async () => {
    const fetchFn = scriptedFetch([]);
    const { result } = renderHookWithProvider(() => useConversation(null), fetchFn);
    // No render-time fetch.
    expect(result.current.conversation).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(fetchFn.calls).toHaveLength(0);
  });

  it('refetch hits the server again and updates state', async () => {
    const fetchFn = scriptedFetch([jsonResponse(conv), jsonResponse({ ...conv, name: 'renamed' })]);
    const { result } = renderHookWithProvider(() => useConversation('c-1'), fetchFn);

    await waitFor(() => expect(result.current.conversation?.name).toBe('general'));
    await result.current.refetch();
    await waitFor(() => expect(result.current.conversation?.name).toBe('renamed'));
    expect(fetchFn.calls).toHaveLength(2);
  });
});
