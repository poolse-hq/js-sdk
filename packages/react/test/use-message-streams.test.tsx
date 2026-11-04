import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MessageStreamEvent } from '@poolse/sdk';
import { usePoolse } from '../src/provider.js';
import { useMessageStreams } from '../src/use-message-streams.js';
import { renderHookWithProvider, scriptedFetch } from './_helpers.js';

// Captures the conversation handlers the hook registers, so the test can
// play realtime events into it.
function fakeConversation() {
  const handlers: {
    stream?: (e: MessageStreamEvent) => void;
    message?: (m: { id: string }) => void;
  } = {};
  return {
    handlers,
    conv: {
      onMessageStream: (fn: (e: MessageStreamEvent) => void) => {
        handlers.stream = fn;
        return () => {};
      },
      onMessage: (fn: (m: { id: string }) => void) => {
        handlers.message = fn;
        return () => {};
      },
    },
  };
}

const base = { id: 's-1', conversation_id: 'c-1', sender_id: 'agent-user' };

describe('useMessageStreams', () => {
  it('builds the reply from deltas and drops it when the message lands', () => {
    const fake = fakeConversation();
    let spied = false;
    const { result } = renderHookWithProvider(() => {
      const chat = usePoolse();
      if (!spied) {
        vi.spyOn(chat.realtime, 'conversation').mockReturnValue(fake.conv as never);
        spied = true;
      }
      return useMessageStreams('c-1');
    }, scriptedFetch([]));

    act(() =>
      fake.handlers.stream!({ ...base, status: 'started', sender_external_id: 'reception' }),
    );
    expect(result.current).toEqual([
      expect.objectContaining({
        id: 's-1',
        text: '',
        status: 'streaming',
        sender_external_id: 'reception',
      }),
    ]);

    act(() => fake.handlers.stream!({ ...base, status: 'delta', delta: 'Hello ' }));
    act(() => fake.handlers.stream!({ ...base, status: 'delta', delta: 'there' }));
    expect(result.current[0]!.text).toBe('Hello there');

    act(() => fake.handlers.message!({ id: 's-1' }));
    expect(result.current).toEqual([]);
  });

  it('marks a failed reply, then removes it after a few seconds', () => {
    vi.useFakeTimers();
    try {
      const fake = fakeConversation();
      let spied = false;
      const { result } = renderHookWithProvider(() => {
        const chat = usePoolse();
        if (!spied) {
          vi.spyOn(chat.realtime, 'conversation').mockReturnValue(fake.conv as never);
          spied = true;
        }
        return useMessageStreams('c-1');
      }, scriptedFetch([]));

      // Joined mid-reply: a delta with no `started` still shows.
      act(() => fake.handlers.stream!({ ...base, status: 'delta', delta: 'Hi' }));
      act(() => fake.handlers.stream!({ ...base, status: 'failed', error: 'Overloaded' }));
      expect(result.current[0]).toMatchObject({
        text: 'Hi',
        status: 'failed',
        error: 'Overloaded',
      });

      act(() => vi.advanceTimersByTime(8000));
      expect(result.current).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
