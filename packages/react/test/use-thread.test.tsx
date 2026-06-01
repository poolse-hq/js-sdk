import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useThread } from '../src/use-thread.js';
import { jsonResponse, renderHookWithProvider, scriptedFetch } from './_helpers.js';

const reply = (id: string, seq: number, body = `r-${id}`) => ({
  id,
  tenant_id: 't-1',
  conversation_id: 'c-1',
  sender_id: 'u-1',
  type: 'text' as const,
  body,
  reply_to_id: 'm-root',
  thread_root_id: 'm-root',
  mentions: [],
  reactions: {},
  edited_at: null,
  deleted_at: null,
  sequence: seq,
  inserted_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

describe('useThread', () => {
  it('lists replies on mount with limit=500 + flags hasMore=false on a non-full page', async () => {
    // Default PAGE_SIZE is large (500) so the side-pane loads a full
    // thread in one round-trip. A short page = no more replies.
    const fetchFn = scriptedFetch([jsonResponse({ data: [reply('r-1', 1), reply('r-2', 2)] })]);
    const { result } = renderHookWithProvider(() => useThread('c-1', 'm-root'), fetchFn);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.replies).toHaveLength(2);
    expect(result.current.hasMore).toBe(false); // < PAGE_SIZE
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/messages/m-root/replies?limit=500');
  });

  it('sendReply pre-generates id, posts with reply_to_id set to root, dedupes echo', async () => {
    const sentRow = reply('client-uuid-123', 3, 'thread reply');
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [reply('r-1', 1)] }),
      jsonResponse(sentRow, { status: 201 }),
    ]);
    const { result } = renderHookWithProvider(() => useThread('c-1', 'm-root'), fetchFn);

    await waitFor(() => expect(result.current.replies).toHaveLength(1));

    await act(async () => {
      await result.current.sendReply({ body: 'thread reply', id: 'client-uuid-123' });
    });

    // Send POSTs to the conversation messages endpoint with reply_to_id
    expect(fetchFn.calls[1]?.url).toBe('https://chat.test/v1/conversations/c-1/messages');
    expect(fetchFn.calls[1]?.method).toBe('POST');
    const body = (await fetchFn.calls[1]!.clone().text())
      ? (JSON.parse(await fetchFn.calls[1]!.clone().text()) as {
          reply_to_id: string;
          id: string;
          body: string;
        })
      : null;
    expect(body?.reply_to_id).toBe('m-root');
    expect(body?.id).toBe('client-uuid-123');
    expect(body?.body).toBe('thread reply');

    // The optimistic temp got upserted to the canonical row (same id).
    expect(result.current.replies).toHaveLength(2);
    expect(result.current.replies[1]?.id).toBe('client-uuid-123');
  });

  it('sendReply rolls back on POST error', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ data: [reply('r-1', 1)] }),
      jsonResponse({ error: { code: 'boom', message: 'nope', doc_url: '' } }, { status: 500 }),
    ]);
    const { result } = renderHookWithProvider(() => useThread('c-1', 'm-root'), fetchFn);
    await waitFor(() => expect(result.current.replies).toHaveLength(1));

    let caught: unknown = null;
    await act(async () => {
      try {
        await result.current.sendReply({ body: 'fail', id: 'client-uuid' });
      } catch (err) {
        caught = err;
      }
    });
    expect(caught).not.toBeNull();
    expect(result.current.replies).toHaveLength(1);
    expect(result.current.replies[0]?.id).toBe('r-1');
  });
});
