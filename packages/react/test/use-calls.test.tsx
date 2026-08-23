// The call state machine, driven by a fake `CallsResource`.
//
// Every test here is a bug that shipped. The failures they cover were
// all of the same shape: a signal arrives about SOME call, and the hook
// applies it to the call the user is actually in.

import type { CallMedia, IncomingCall } from '@poolse/sdk';
import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePoolse } from '../src/provider.js';
import { useCalls } from '../src/use-calls.js';
import { renderHookWithProvider, scriptedFetch } from './_helpers.js';

type Handler<T> = (call: T) => void;

/** Stand-in for the SDK's `CallsResource`, with the wire under test control. */
function fakeCalls() {
  const handlers: Record<string, Handler<never>[]> = {};
  const on = (name: string) => (fn: Handler<never>) => {
    (handlers[name] ??= []).push(fn);
    return () => {};
  };

  return {
    fire<T>(name: string, payload: T) {
      for (const fn of handlers[name] ?? []) (fn as Handler<T>)(payload);
    },
    resource: {
      // `media` widened, not inferred — a test that overrides it with
      // `mockResolvedValueOnce` needs the property to accept both.
      invite: vi.fn(async (conversationId: string) => ({
        callId: 'call-out',
        conversationId,
        calleeUserIds: ['u-them'],
        media: 'audio' as CallMedia,
      })),
      accept: vi.fn(async () => {}),
      decline: vi.fn(async () => {}),
      markBusy: vi.fn(async () => {}),
      hangUp: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      onIncoming: on('incoming'),
      onAccepted: on('accepted'),
      onDeclined: on('declined'),
      onBusy: on('busy'),
      onEnded: on('ended'),
      onCancelled: on('cancelled'),
    },
  };
}

/**
 * Mount `useCalls` against a fake resource.
 *
 * Starts with a null user so the hook builds nothing, spies on
 * `realtime.calls`, then supplies the id — which re-runs the hook's memo
 * and hands it the fake.
 */
async function mount() {
  const wire = fakeCalls();

  const view = renderHookWithProvider(
    ({ userId }: { userId: string | null }) => ({
      poolse: usePoolse(),
      calls: useCalls(userId, { ringTimeoutMs: 0 }),
    }),
    scriptedFetch([]),
    { initialProps: { userId: null as string | null } },
  );

  vi.spyOn(view.result.current.poolse.realtime, 'calls').mockReturnValue(wire.resource as never);
  await act(async () => {
    view.rerender({ userId: 'u-me' });
  });

  return { wire, view, calls: () => view.result.current.calls };
}

// Annotated rather than inferred: several tests override `media`, and
// an inferred literal type makes that an error.
const INCOMING: IncomingCall = {
  callId: 'call-in',
  conversationId: 'conv-1',
  callerUserId: 'u-them',
  media: 'audio',
};

describe('useCalls answering', () => {
  it('lets the answerer hang up on the other side', async () => {
    // `accept()` clears `incoming`, and a callee never had an
    // `outgoing`, so hangUp() resolved no call id at all and returned
    // before signalling. The caller sat in a call the callee had left.
    const { wire, calls } = await mount();

    await act(async () => wire.fire('incoming', INCOMING));
    await act(async () => calls().accept());
    expect(calls().phase).toBe('active');

    await act(async () => calls().hangUp());

    expect(wire.resource.hangUp).toHaveBeenCalledWith({
      callId: 'call-in',
      conversationId: 'conv-1',
    });
  });

  it('survives a stale cancel arriving after the call is answered', async () => {
    // A caller's ring timeout firing as the callee answers. The guard
    // fell through whenever `incoming` was null — which is exactly what
    // accept() leaves behind — and dropped the callee out of the call
    // they had just joined, with media still running.
    const { wire, calls } = await mount();

    await act(async () => wire.fire('incoming', INCOMING));
    await act(async () => calls().accept());

    await act(async () =>
      wire.fire('cancelled', {
        callId: 'call-old',
        conversationId: 'conv-1',
        callerUserId: 'u-them',
      }),
    );

    expect(calls().phase).toBe('active');
    expect(calls().activeConversationId).toBe('conv-1');
  });

  it('still dismisses a cancel for the ring being shown', async () => {
    const { wire, calls } = await mount();

    await act(async () => wire.fire('incoming', INCOMING));
    expect(calls().phase).toBe('ringing-in');

    await act(async () =>
      wire.fire('cancelled', {
        callId: 'call-in',
        conversationId: 'conv-1',
        callerUserId: 'u-them',
      }),
    );

    expect(calls().phase).toBe('idle');
    expect(calls().incoming).toBeNull();
  });
});

describe('useCalls media type', () => {
  it('a callee stays on video after answering', async () => {
    // `media` drives whether the room opens the camera. It was derived
    // from `incoming ?? outgoing`, and accept() clears `incoming` in the
    // same batch that flips the phase — so the callee fell back to
    // 'audio' and never opened its camera, while the caller (which keeps
    // `outgoing`) did. The default looked random; it was really
    // "whichever end you were on".
    const { wire, calls } = await mount();

    await act(async () => wire.fire('incoming', { ...INCOMING, media: 'video' }));
    expect(calls().media).toBe('video');

    await act(async () => calls().accept());

    expect(calls().phase).toBe('active');
    expect(calls().media).toBe('video');
  });

  it('a caller stays on video after being answered', async () => {
    const { wire, calls } = await mount();

    wire.resource.invite.mockResolvedValueOnce({
      callId: 'call-out',
      conversationId: 'conv-1',
      calleeUserIds: ['u-them'],
      media: 'video',
    });
    await act(async () => calls().call('conv-1', 'video'));
    await act(async () =>
      wire.fire('accepted', { callId: 'call-out', conversationId: 'conv-1', userId: 'u-them' }),
    );

    expect(calls().media).toBe('video');
  });

  it('does not let a finished video call bleed into the next audio one', async () => {
    const { wire, calls } = await mount();

    await act(async () => wire.fire('incoming', { ...INCOMING, media: 'video' }));
    await act(async () => calls().accept());
    await act(async () => calls().hangUp());
    expect(calls().media).toBe('audio');

    await act(async () => wire.fire('incoming', { ...INCOMING, callId: 'call-3', media: 'audio' }));
    expect(calls().media).toBe('audio');
  });
});

describe('useCalls signal targeting', () => {
  it('ignores an end for a call this client is not in', async () => {
    const { wire, calls } = await mount();

    await act(async () => wire.fire('incoming', INCOMING));
    await act(async () => calls().accept());

    await act(async () =>
      wire.fire('ended', { callId: 'call-other', conversationId: 'conv-9', userId: 'u-x' }),
    );

    expect(calls().phase).toBe('active');
  });

  it('honours an end for the call it is in', async () => {
    const { wire, calls } = await mount();

    await act(async () => wire.fire('incoming', INCOMING));
    await act(async () => calls().accept());

    await act(async () =>
      wire.fire('ended', { callId: 'call-in', conversationId: 'conv-1', userId: 'u-them' }),
    );

    expect(calls().phase).toBe('idle');
    expect(calls().activeConversationId).toBeNull();
  });

  it("ignores an accept for somebody else's call", async () => {
    const { wire, calls } = await mount();

    await act(async () => calls().call('conv-1', 'audio'));
    expect(calls().phase).toBe('ringing-out');

    await act(async () =>
      wire.fire('accepted', { callId: 'call-other', conversationId: 'conv-9', userId: 'u-x' }),
    );

    expect(calls().phase).toBe('ringing-out');
    expect(calls().activeConversationId).toBeNull();
  });

  it('marks a second caller busy without disturbing the call in progress', async () => {
    const { wire, calls } = await mount();

    await act(async () => wire.fire('incoming', INCOMING));
    await act(async () => calls().accept());

    const second = { ...INCOMING, callId: 'call-2', callerUserId: 'u-third' };
    await act(async () => wire.fire('incoming', second));

    expect(wire.resource.markBusy).toHaveBeenCalledTimes(1);
    expect(calls().phase).toBe('active');
    expect(calls().activeConversationId).toBe('conv-1');
  });
});
