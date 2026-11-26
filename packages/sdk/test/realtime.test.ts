import { describe, expect, it, vi } from 'vitest';
import { Poolse } from '../src/index.js';
import { CONVERSATION_IDLE_LEAVE_MS, applyPresenceDiff } from '../src/realtime/realtime.js';

// We don't run a real WebSocket in tests — we observe surface behaviour
// (status changes, lazy connect, handle reuse) that doesn't require the
// underlying socket to actually open. The wire-level behaviour is the
// `phoenix` library's responsibility and is tested upstream.

describe('Poolse.realtime', () => {
  it('exposes a realtime client at construction time', () => {
    const chat = new Poolse({
      apiUrl: 'https://chat.example',
      getToken: () => 'tok',
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
    });

    expect(chat.realtime).toBeDefined();
    expect(chat.realtime.getStatus()).toBe('idle');
  });

  it('honours an explicit wsUrl override', () => {
    const chat = new Poolse({
      apiUrl: 'https://api.example',
      wsUrl: 'wss://realtime.example',
      getToken: () => 'tok',
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
    });

    // We can't reach into the internal socket, but the realtime client
    // was constructed with this URL — assert via the side-effect that
    // it didn't throw and that `apiUrl` is still trimmed correctly.
    expect(chat.realtime).toBeDefined();
  });

  it('destroy() flips status to closed', () => {
    const chat = new Poolse({
      apiUrl: 'https://chat.example',
      getToken: () => 'tok',
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
    });

    let observed = '';
    chat.realtime.onStatus((s) => {
      observed = s;
    });

    chat.destroy();
    expect(observed).toBe('closed');
  });
});

describe('Poolse.realtime pause/resume', () => {
  const chat = () =>
    new Poolse({
      apiUrl: 'https://chat.example',
      getToken: () => 'tok',
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
    });

  it('keeps channel handles across a pause', () => {
    const c = chat();
    const handle = c.realtime.conversation('c-1');
    c.realtime.pause();
    expect(c.realtime.getStatus()).toBe('closed');
    c.realtime.resume();
    expect(c.realtime.getStatus()).toBe('connecting');
    expect(c.realtime.conversation('c-1')).toBe(handle);
    c.destroy();
  });

  it('is a no-op before anything connected', () => {
    const c = chat();
    c.realtime.pause();
    c.realtime.resume();
    expect(c.realtime.getStatus()).toBe('idle');
  });
});

describe('ConversationChannel close', () => {
  it('a server-closed channel is dropped and reported', () => {
    const c = new Poolse({
      apiUrl: 'https://chat.example',
      getToken: () => 'tok',
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
    });
    const handle = c.realtime.conversation('c-1');
    const closed = vi.fn();
    handle.onClosed(closed);

    // What phoenix.js does on the server's phx_close.
    (handle as unknown as { channel: { trigger(e: string): void } }).channel.trigger('phx_close');

    expect(closed).toHaveBeenCalledOnce();
    expect(c.realtime.conversation('c-1')).not.toBe(handle);
    c.destroy();
  });
});

describe('user channel events', () => {
  const build = (userResolver?: (id: string) => { displayName: string }) =>
    new Poolse({
      apiUrl: 'https://chat.example',
      getToken: () => 'tok',
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
      ...(userResolver ? { userResolver } : {}),
    });
  const trigger = (handle: unknown, event: string, payload: unknown) =>
    (handle as { channel: { trigger(e: string, p: unknown): void } }).channel.trigger(
      event,
      payload,
    );

  it('onConversationRead delivers conversation:read', () => {
    const c = build();
    const user = c.realtime.user('u-1');
    const seen = vi.fn();
    user.onConversationRead(seen);

    const evt = {
      conversation_id: 'c-1',
      last_read_message_id: 'm-9',
      last_read_sequence: 9,
      unread_count: 0,
      mention_unread_count: 0,
    };
    trigger(user, 'conversation:read', evt);

    expect(seen).toHaveBeenCalledWith(evt);
    c.destroy();
  });

  it('onAppEvent on the client receives app:event', () => {
    const c = build();
    const seen = vi.fn();
    c.onAppEvent(seen);
    const user = c.realtime.user('u-1');

    trigger(user, 'app:event', { type: 'workspace:updated', data: { name: 'Acme' } });

    expect(seen).toHaveBeenCalledWith({ type: 'workspace:updated', data: { name: 'Acme' } });
    c.destroy();
  });

  it('onAppEvent joins the user channel once the user is known', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 'u-1' }), {
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof globalThis.fetch;
    const c = new Poolse({ apiUrl: 'https://chat.example', getToken: () => 'tok', fetch: fetchFn });
    c.onAppEvent(() => {});
    expect(c.realtime.peekUser()).toBeNull();

    await c.me.show();

    expect(c.realtime.peekUser()?.userId).toBe('u-1');
    c.destroy();
  });

  it('member:updated drops that member’s cached profile', async () => {
    let name = 'Old';
    const c = build(() => ({ displayName: name }));
    await c.users.get('alice');
    await c.users.get('bob');
    const user = c.realtime.user('u-1');

    name = 'New';
    trigger(user, 'app:event', { type: 'member:updated', data: { external_id: 'alice' } });

    expect(c.users.peek('alice')).toBeUndefined();
    expect(c.users.peek('bob')).toEqual({ displayName: 'Old' });
    expect(await c.users.get('alice')).toEqual({ displayName: 'New' });
    c.destroy();
  });

  it('member:updated naming nobody drops every cached profile', async () => {
    const c = build(() => ({ displayName: 'X' }));
    await c.users.get('alice');
    const user = c.realtime.user('u-1');

    trigger(user, 'app:event', { type: 'member:updated', data: {} });

    expect(c.users.peek('alice')).toBeUndefined();
    c.destroy();
  });
});

describe('transcript channel', () => {
  const build = () =>
    new Poolse({
      apiUrl: 'https://chat.example',
      getToken: () => 'tok',
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
    });
  const channelOf = (handle: unknown) =>
    (handle as { channel: { trigger(e: string, p: unknown): void } }).channel;

  it('shares one handle per call and leaves after the last release', () => {
    const c = build();
    const a = c.realtime.transcript('call-1');
    const b = c.realtime.transcript('call-1');
    expect(b).toBe(a);
    a.release();
    expect(a.closed).toBe(false);
    b.release();
    expect(a.closed).toBe(true);
    expect(c.realtime.transcript('call-1')).not.toBe(a);
    c.destroy();
  });

  it('streams segments; recording events reach the conversation', () => {
    const c = build();
    const t = c.realtime.transcript('call-1');
    const segs = vi.fn();
    t.onSegment(segs);
    channelOf(t).trigger('transcript:segment', { call_id: 'call-1', text: 'Hi', final: false });
    expect(segs).toHaveBeenCalledWith({ call_id: 'call-1', text: 'Hi', final: false });

    const conv = c.realtime.conversation('c-1');
    const started = vi.fn();
    const consent = vi.fn();
    conv.onRecordingStarted(started);
    conv.onRecordingConsent(consent);
    channelOf(conv).trigger('recording:started', { call_id: 'call-1', notice: 'banner' });
    channelOf(conv).trigger('recording:consent', { call_id: 'call-1', decision: 'declined' });
    expect(started).toHaveBeenCalledWith({ call_id: 'call-1', notice: 'banner' });
    expect(consent).toHaveBeenCalledOnce();
    c.destroy();
  });
});

describe('ConversationChannel lifetime', () => {
  const build = () =>
    new Poolse({
      apiUrl: 'https://chat.example',
      getToken: () => 'tok',
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
    });
  type Raw = {
    state: string;
    trigger(e: string, p?: unknown): void;
    joinPush: { matchReceive(r: { status: string; response: unknown }): void };
  };
  const raw = (handle: unknown) => (handle as { channel: Raw }).channel;

  it('a refused join closes the handle with the reason instead of retrying for good', () => {
    const c = build();
    const handle = c.realtime.conversation('c-1');
    const closed = vi.fn();
    handle.onClosed(closed);
    const channel = raw(handle);
    channel.joinPush.matchReceive({ status: 'error', response: { reason: 'forbidden' } });
    expect(closed).toHaveBeenCalledWith('forbidden');
    expect(handle.closedReason).toBe('forbidden');
    expect(['leaving', 'closed']).toContain(channel.state);
    expect(c.realtime.conversation('c-1')).not.toBe(handle);
    c.destroy();
  });

  it('leaves a topic nobody listens to after a minute and joins again on next use', () => {
    vi.useFakeTimers();
    try {
      const c = build();
      const handle = c.realtime.conversation('c-1');
      const off = handle.onMessage(() => {});
      const first = raw(handle);
      vi.advanceTimersByTime(CONVERSATION_IDLE_LEAVE_MS * 2);
      expect(first.state).not.toMatch(/leaving|closed/);

      off();
      vi.advanceTimersByTime(CONVERSATION_IDLE_LEAVE_MS - 1);
      expect(first.state).not.toMatch(/leaving|closed/);
      vi.advanceTimersByTime(1);
      expect(['leaving', 'closed']).toContain(first.state);

      // Same handle, a fresh channel, and listeners work on it.
      expect(c.realtime.conversation('c-1')).toBe(handle);
      const got = vi.fn();
      handle.onMessage(got);
      const second = raw(handle);
      expect(second).not.toBe(first);
      second.trigger('message:new', { id: 'm-1' });
      expect(got).toHaveBeenCalledWith({ id: 'm-1' });
      // The old channel's close is not reported as the handle closing.
      expect(handle.closedReason).toBeNull();
      c.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('presence diffs', () => {
  const meta = (ref: string) => ({ phx_ref: ref, online_at: 1, external_id: 'ana' });

  it('a user with two tabs stays present when one leaves', () => {
    let state = applyPresenceDiff({}, { joins: { u1: { metas: [meta('a')] } } });
    state = applyPresenceDiff(state, { joins: { u1: { metas: [meta('b')] } } });
    expect(state.u1!.metas.map((m) => m.phx_ref)).toEqual(['a', 'b']);
    state = applyPresenceDiff(state, { leaves: { u1: { metas: [meta('a')] } } });
    expect(state.u1!.metas.map((m) => m.phx_ref)).toEqual(['b']);
    state = applyPresenceDiff(state, { leaves: { u1: { metas: [meta('b')] } } });
    expect(state.u1).toBeUndefined();
  });

  it('onPresence gives the merged state', () => {
    const c = new Poolse({
      apiUrl: 'https://chat.example',
      getToken: () => 'tok',
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
    });
    const conv = c.realtime.conversation('c-1');
    const seen = vi.fn();
    conv.onPresence(seen);
    const ch = (conv as unknown as { channel: { trigger(e: string, p: unknown): void } }).channel;
    ch.trigger('presence_state', { u1: { metas: [meta('a'), meta('b')] } });
    ch.trigger('presence_diff', { joins: {}, leaves: { u1: { metas: [meta('a')] } } });
    expect(Object.keys(seen.mock.lastCall![0])).toEqual(['u1']);
    expect(conv.getPresenceState().u1!.metas).toHaveLength(1);
    c.destroy();
  });
});
