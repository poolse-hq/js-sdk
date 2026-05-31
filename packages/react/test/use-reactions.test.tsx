import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useReactions } from '../src/use-reactions.js';
import { jsonResponse, renderHookWithProvider, scriptedFetch } from './_helpers.js';

const baseMsg = {
  id: 'm-1',
  tenant_id: 't-1',
  conversation_id: 'c-1',
  sender_id: 'u-1',
  type: 'text' as const,
  body: 'hi',
  reply_to_id: null,
  thread_root_id: null,
  mentions: [],
  reactions: { '🎉': ['u-1'] },
  edited_at: null,
  deleted_at: null,
  sequence: 1,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('useReactions', () => {
  it('seeds from initialReactions', () => {
    const fetchFn = scriptedFetch([]);
    const { result } = renderHookWithProvider(
      () =>
        useReactions('m-1', {
          conversationId: 'c-1',
          initialReactions: { '🎉': ['u-1'] },
          currentUserId: 'u-2',
        }),
      fetchFn,
    );
    expect(result.current.reactions).toEqual({ '🎉': ['u-1'] });
  });

  it('addReaction optimistically appends current user, then POSTs', async () => {
    const fetchFn = scriptedFetch([jsonResponse(baseMsg)]);
    const { result } = renderHookWithProvider(
      () =>
        useReactions('m-1', {
          conversationId: 'c-1',
          initialReactions: {},
          currentUserId: 'u-2',
        }),
      fetchFn,
    );

    await act(async () => {
      await result.current.addReaction('🚀');
    });

    expect(result.current.reactions['🚀']).toEqual(['u-2']);
    expect(fetchFn.calls[0]?.method).toBe('POST');
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/messages/m-1/reactions');
  });

  it('addReaction is idempotent locally (same user twice — no dup)', async () => {
    const fetchFn = scriptedFetch([jsonResponse(baseMsg), jsonResponse(baseMsg)]);
    const { result } = renderHookWithProvider(
      () =>
        useReactions('m-1', {
          conversationId: 'c-1',
          initialReactions: { '🚀': ['u-2'] },
          currentUserId: 'u-2',
        }),
      fetchFn,
    );
    await act(async () => {
      await result.current.addReaction('🚀');
    });
    expect(result.current.reactions['🚀']).toEqual(['u-2']);
  });

  it('removeReaction optimistically removes, rolls back on error', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ error: { code: 'boom', message: 'nope', doc_url: '' } }, { status: 500 }),
    ]);
    const { result } = renderHookWithProvider(
      () =>
        useReactions('m-1', {
          conversationId: 'c-1',
          initialReactions: { '🎉': ['u-1', 'u-2'] },
          currentUserId: 'u-2',
        }),
      fetchFn,
    );

    // Try/catch rather than expect.rejects.toThrow — the latter
    // sometimes leaves React internals in a state where the *next*
    // test's renderHook produces a null result.current.
    let caught: unknown = null;
    await act(async () => {
      try {
        await result.current.removeReaction('🎉');
      } catch (err) {
        caught = err;
      }
    });
    expect(caught).not.toBeNull();
    expect(result.current.reactions['🎉']).toEqual(['u-1', 'u-2']);
  });

  it('removeReaction drops the key entirely when last user removed', async () => {
    const fetchFn = scriptedFetch([jsonResponse(baseMsg)]);
    const { result } = renderHookWithProvider(
      () =>
        useReactions('m-1', {
          conversationId: 'c-1',
          initialReactions: { '🎉': ['u-2'] },
          currentUserId: 'u-2',
        }),
      fetchFn,
    );
    // initialReactions is seeded synchronously — no waitFor needed.
    expect(result.current.reactions['🎉']).toEqual(['u-2']);
    await act(async () => {
      await result.current.removeReaction('🎉');
    });
    expect(result.current.reactions['🎉']).toBeUndefined();
  });
});
