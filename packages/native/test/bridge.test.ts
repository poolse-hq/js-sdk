import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let fakeNative: Record<string, unknown> | null = null;

vi.mock('react-native', () => ({ View: 'View' }));
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => fakeNative,
  requireNativeViewManager: () => 'NativeView',
}));

async function load() {
  vi.resetModules();
  return import('../src/index.js');
}

describe('without the native call core', () => {
  beforeEach(() => {
    fakeNative = null;
  });

  it('place, join and moveCallHere reject instead of reporting success', async () => {
    const calls = await load();
    expect(calls.nativeCallsAvailable).toBe(false);
    await expect(calls.place('c-1', { media: 'audio', sessionToken: 't' })).rejects.toThrow(
      /not in this build/,
    );
    await expect(calls.join('call-1', 'c-1', 't')).rejects.toThrow(/not in this build/);
    await expect(
      calls.moveCallHere('call-1', { conversationId: 'c-1', sessionToken: 't' }),
    ).rejects.toThrow(/not in this build/);
  });

  it('fire-and-forget commands stay no-ops', async () => {
    const calls = await load();
    expect(() => calls.hangUp()).not.toThrow();
    expect(calls.getCallState()).toBeNull();
  });
});

describe('server requests time out', () => {
  const join = vi.fn(async () => undefined);
  const configure = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.useFakeTimers();
    fakeNative = {
      join,
      configure,
      callControl: async () => ({
        callId: 'call-1',
        controlToken: 'ct',
        apiBaseUrl: 'https://api.test',
        serverId: null,
      }),
    };
    // A server that never answers; only the abort ends the request.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            );
          }),
      ),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('startRoom gives up with a plain error', async () => {
    const calls = await load();
    await calls.configure('https://api.test');
    const started = calls.startRoom('c-1', { media: 'audio', sessionToken: 't' });
    const check = expect(started).rejects.toThrow(/didn't answer/);
    await vi.advanceTimersByTimeAsync(15_000);
    await check;
    expect(join).not.toHaveBeenCalled();
  });

  it('ringIntoCall gives up with a plain error', async () => {
    const calls = await load();
    const rung = calls.ringIntoCall({ userIds: ['u-2'] });
    const check = expect(rung).rejects.toThrow(/didn't answer/);
    await vi.advanceTimersByTimeAsync(15_000);
    await check;
  });

  it('a prompt answer is not cut off', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ created: true, call: { id: 'call-9' } }))),
    );
    const calls = await load();
    await calls.configure('https://api.test');
    await expect(calls.startRoom('c-1', { media: 'audio', sessionToken: 't' })).resolves.toEqual({
      callId: 'call-9',
      created: true,
    });
    expect(join).toHaveBeenCalledWith('call-9', 'c-1', 't', null);
  });
});
