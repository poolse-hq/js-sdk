import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Poll } from '@poolse/sdk';
import {
  usePins,
  usePoll,
  useScheduledMessages,
  useTranslation,
} from '../src/use-messaging-plus.js';
import {
  jsonResponse,
  noContent,
  renderHookWithProvider,
  scriptedFetch,
  tick,
} from './_helpers.js';

const poll: Poll = {
  options: [
    { id: '1', text: 'Pizza', votes: 1, voter_ids: [] },
    { id: '2', text: 'Sushi', votes: 0, voter_ids: [] },
  ],
  multiple: false,
  anonymous: true,
  closes_at: null,
  closed_at: null,
  closed: false,
  voters: 1,
};

describe('usePoll', () => {
  it('votes optimistically and takes the server answer', async () => {
    const server = {
      ...poll,
      voters: 2,
      options: [poll.options[0]!, { ...poll.options[1]!, votes: 1 }],
    };
    const fetchFn = scriptedFetch([jsonResponse({ poll: server, my_option_ids: ['2'] })]);
    const { result } = renderHookWithProvider(
      () => usePoll({ id: 'm-1', conversation_id: 'c-1', poll, my_option_ids: [] }),
      fetchFn,
    );
    await act(async () => {
      await result.current.toggle('2');
    });
    expect(result.current.myOptionIds).toEqual(['2']);
    expect(result.current.poll?.options[1]?.votes).toBe(1);
    expect(fetchFn.calls[0]?.url).toContain('/v1/messages/m-1/poll/votes');
  });

  it('rolls back on an error and ignores taps on a closed poll', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ error: { code: 'poll_closed', message: 'x', doc_url: '' } }, { status: 409 }),
    ]);
    const { result } = renderHookWithProvider(
      () => usePoll({ id: 'm-1', conversation_id: 'c-1', poll, my_option_ids: ['1'] }),
      fetchFn,
    );
    await act(async () => {
      await result.current.toggle('2');
    });
    expect(result.current.myOptionIds).toEqual(['1']);
    expect(result.current.error).toBeTruthy();

    const closed = renderHookWithProvider(
      () =>
        usePoll({
          id: 'm-2',
          conversation_id: 'c-1',
          poll: { ...poll, closed: true },
          my_option_ids: [],
        }),
      scriptedFetch([]),
    );
    await act(async () => {
      await closed.result.current.toggle('1');
    });
    expect(closed.result.current.closed).toBe(true);
  });
});

describe('useTranslation and useScheduledMessages', () => {
  it('translates on demand and resets', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse({ message_id: 'm-1', language: 'de', text: 'Hallo', cached: true }),
    ]);
    const { result } = renderHookWithProvider(() => useTranslation('m-1', 'de'), fetchFn);
    await act(async () => {
      await result.current.translate();
    });
    expect(result.current.translation?.text).toBe('Hallo');
    act(() => result.current.reset());
    expect(result.current.translation).toBeNull();
  });

  it('lists and cancels scheduled messages', async () => {
    const s = { id: 's-1', conversation_id: 'c-1', body: 'later', status: 'scheduled' };
    const fetchFn = scriptedFetch([jsonResponse({ data: [s] }), noContent()]);
    const { result } = renderHookWithProvider(() => useScheduledMessages('c-1'), fetchFn);
    await act(async () => {
      await tick(10);
    });
    expect(result.current.scheduled).toHaveLength(1);
    await act(async () => {
      await result.current.cancel('s-1');
    });
    expect(result.current.scheduled).toHaveLength(0);
    expect(fetchFn.calls[1]?.method).toBe('DELETE');
  });
});

describe('stale answers after a key change', () => {
  it("usePins never shows the previous conversation's pins", async () => {
    let answerA!: (r: Response) => void;
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/c-a/')) return new Promise<Response>((r) => (answerA = r));
      return jsonResponse({ data: [{ id: 'pin-b' }] });
    }) as unknown as typeof globalThis.fetch;
    const { result, rerender } = renderHookWithProvider(
      ({ id }: { id: string }) => usePins(id),
      fetchFn,
      { initialProps: { id: 'c-a' } },
    );
    rerender({ id: 'c-b' });
    await act(async () => {
      await tick(10);
    });
    expect(result.current.pins.map((p) => p.id)).toEqual(['pin-b']);
    await act(async () => {
      answerA(jsonResponse({ data: [{ id: 'pin-a' }] }));
      await tick(10);
    });
    expect(result.current.pins.map((p) => p.id)).toEqual(['pin-b']);
  });

  it('useTranslation drops a translation for the previous language', async () => {
    let answer!: (r: Response) => void;
    const fetchFn = (() =>
      new Promise<Response>((r) => (answer = r))) as unknown as typeof globalThis.fetch;
    const { result, rerender } = renderHookWithProvider(
      ({ lang }: { lang: string }) => useTranslation('m-1', lang),
      fetchFn,
      { initialProps: { lang: 'de' } },
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.translate();
    });
    rerender({ lang: 'fr' });
    await act(async () => {
      await tick(10);
      answer(jsonResponse({ message_id: 'm-1', language: 'de', text: 'Hallo', cached: true }));
      await pending;
    });
    expect(result.current.translation).toBeNull();
  });
});
