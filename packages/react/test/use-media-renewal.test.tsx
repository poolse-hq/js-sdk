import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useMediaRenewal } from '../src/index.js';

describe('useMediaRenewal', () => {
  it('renews at most three times a minute, then reports exhausted', () => {
    const refresh = vi.fn();
    const { result } = renderHook(() => useMediaRenewal(refresh, 'r1'));
    for (let i = 0; i < 3; i++) {
      let ok = false;
      act(() => {
        ok = result.current.renew();
      });
      expect(ok).toBe(true);
    }
    expect(result.current.exhausted).toBe(false);
    act(() => {
      expect(result.current.renew()).toBe(false);
    });
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(result.current.exhausted).toBe(true);
  });

  it('starts over for a new key and after the window', () => {
    vi.useFakeTimers();
    try {
      const refresh = vi.fn();
      const { result, rerender } = renderHook(({ k }) => useMediaRenewal(refresh, k, { max: 1 }), {
        initialProps: { k: 'a' },
      });
      act(() => void result.current.renew());
      act(() => void result.current.renew());
      expect(result.current.exhausted).toBe(true);
      rerender({ k: 'b' });
      expect(result.current.exhausted).toBe(false);
      act(() => void result.current.renew());
      expect(refresh).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(61_000);
      act(() => void result.current.renew());
      expect(refresh).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
