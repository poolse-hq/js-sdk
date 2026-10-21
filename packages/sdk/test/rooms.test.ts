import { describe, expect, it } from 'vitest';
import { AuthError } from '../src/errors.js';
import { buildPoolse, jsonResponse, scriptedFetch } from './_helpers.js';

const session = {
  cv: 1,
  created: true,
  call: { id: 'call-1', conversation_id: 'c-1', kind: 'room', media: 'video', state: 'live' },
  livekit: { url: 'wss://lk.test', token: 'lk' },
  control_token: 'control-xyz',
};

describe('RoomsResource', () => {
  it('starts (or joins) the room with the session token', async () => {
    const fetchFn = scriptedFetch([jsonResponse(session, { status: 201 })]);
    const chat = buildPoolse(fetchFn);

    const s = await chat.rooms.start('c-1', 'video');

    expect(s.call.id).toBe('call-1');
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/conversations/c-1/room');
    expect(fetchFn.calls[0]?.method).toBe('POST');
    expect(await fetchFn.calls[0]?.json()).toEqual({ media: 'video' });
    expect(fetchFn.calls[0]?.headers.get('authorization')).toBe('Bearer jwt-abc');
  });

  it('leaves with the call’s control token, not the session', async () => {
    const fetchFn = scriptedFetch([new Response(null, { status: 204 })]);
    const chat = buildPoolse(fetchFn);

    await chat.rooms.leave(session as never);

    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/calls/call-1/hangup');
    expect(fetchFn.calls[0]?.headers.get('authorization')).toBe('Bearer control-xyz');
  });

  it('a 401 on a caller-supplied token is not retried with a refreshed session', async () => {
    const unauthorized = jsonResponse(
      { error: { code: 'unauthorized', message: 'Invalid or expired token.' } },
      { status: 401 },
    );
    const fetchFn = scriptedFetch([unauthorized]);
    const chat = buildPoolse(fetchFn);

    await expect(chat.rooms.leave(session as never)).rejects.toBeInstanceOf(AuthError);
    expect(fetchFn.calls).toHaveLength(1);
  });
});
