import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Poolse } from '@poolse/sdk';
import { usePoolse } from '../src/provider.js';
import { ROOM_ERROR_MS, useCallRoom } from '../src/use-call-room.js';
import { renderHookWithProvider, scriptedFetch } from './_helpers.js';

// A CallRoom that records its listeners, so the test can raise errors.
function fakeRoom(joinError?: Error) {
  const listeners = new Map<string, (arg: unknown) => void>();
  const room = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === 'then') return undefined;
        if (prop === 'join')
          return () => (joinError ? Promise.reject(joinError) : Promise.resolve(true));
        if (prop === 'getBackground') return () => ({ type: 'none' });
        if (prop.startsWith('on'))
          return (fn: (arg: unknown) => void) => {
            listeners.set(prop, fn);
            return () => listeners.delete(prop);
          };
        if (prop === 'getParticipants' || prop.startsWith('list')) return () => [];
        if (prop.startsWith('list') || prop === 'enumerateDevices')
          return () => Promise.resolve([]);
        return () => false;
      },
    },
  );
  return { room, raise: (err: Error) => listeners.get('onError')?.(err) };
}

function render(fake: ReturnType<typeof fakeRoom>) {
  let spied = false;
  return renderHookWithProvider(() => {
    const chat = usePoolse() as Poolse;
    if (!spied) {
      spied = true;
      vi.spyOn(chat, 'call').mockReturnValue(fake.room as never);
    }
    return useCallRoom('c-1', { livekit: {} as never });
  }, scriptedFetch([]));
}

describe('useCallRoom errors', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('clears a mid-call error by itself', () => {
    const fake = fakeRoom();
    const { result } = render(fake);
    act(() => fake.raise(new Error('could not play remote audio')));
    expect(result.current.error?.message).toBe('could not play remote audio');
    act(() => vi.advanceTimersByTime(ROOM_ERROR_MS));
    expect(result.current.error).toBeNull();
  });

  it('keeps a newer error for its own full time', () => {
    const fake = fakeRoom();
    const { result } = render(fake);
    act(() => fake.raise(new Error('first')));
    act(() => vi.advanceTimersByTime(ROOM_ERROR_MS - 1000));
    act(() => fake.raise(new Error('second')));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.error?.message).toBe('second');
    act(() => vi.advanceTimersByTime(ROOM_ERROR_MS));
    expect(result.current.error).toBeNull();
  });

  it('keeps a failed join until the next attempt', async () => {
    const fake = fakeRoom(new Error('no SFU'));
    const { result } = render(fake);
    await act(async () => {
      await result.current.join();
    });
    act(() => vi.advanceTimersByTime(ROOM_ERROR_MS * 3));
    expect(result.current.error?.message).toBe('no SFU');
  });
});
