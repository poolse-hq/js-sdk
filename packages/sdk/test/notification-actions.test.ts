import { describe, expect, it, vi } from 'vitest';
import {
  AuthError,
  createNotificationActions,
  parseNotificationActions,
  Poolse,
  RateLimitedError,
} from '../src/index.js';
import { bodyJson, jsonResponse, noContent, scriptedFetch } from './_helpers.js';

const reply = {
  id: '00000000-0000-4000-8000-000000000001',
  conversation_id: 'c-1',
  body: 'on my way',
};

const build = (fetchFn: typeof globalThis.fetch) =>
  createNotificationActions({
    apiUrl: 'https://chat.test/',
    fetch: fetchFn,
    maxRetries: 0,
    baseBackoffMs: 0,
    maxBackoffMs: 0,
  });

describe('notification actions', () => {
  it('reply → POST /v1/notification-actions/reply with the grant as bearer', async () => {
    const fetchFn = scriptedFetch([jsonResponse(reply, { status: 201 })]);

    const msg = await build(fetchFn).reply({
      token: 'grant-1',
      text: 'on my way',
      id: reply.id,
    });

    const req = fetchFn.calls[0]!;
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://chat.test/v1/notification-actions/reply');
    expect(req.headers.get('authorization')).toBe('Bearer grant-1');
    expect(req.headers.get('idempotency-key')).toBe(reply.id);
    expect(await bodyJson(req)).toEqual({ text: 'on my way', id: reply.id });
    expect(msg.id).toBe(reply.id);
  });

  it('reply generates an id when none is given', async () => {
    const fetchFn = scriptedFetch([jsonResponse(reply, { status: 201 })]);

    await build(fetchFn).reply({ token: 'g', text: 'hi' });

    const body = (await bodyJson(fetchFn.calls[0]!)) as { id: string };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(fetchFn.calls[0]!.headers.get('idempotency-key')).toBe(body.id);
  });

  it('read → POST /v1/notification-actions/read, 204', async () => {
    const fetchFn = scriptedFetch([noContent()]);

    await expect(build(fetchFn).read({ token: 'grant-2' })).resolves.toBeNull();

    expect(fetchFn.calls[0]!.url).toBe('https://chat.test/v1/notification-actions/read');
    expect(fetchFn.calls[0]!.headers.get('authorization')).toBe('Bearer grant-2');
  });

  it('401 device_signed_out surfaces at once as AuthError', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse(
        { error: { code: 'device_signed_out', message: 'x', doc_url: '' } },
        { status: 401 },
      ),
    ]);

    const err = await build(fetchFn)
      .read({ token: 'g' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).code).toBe('device_signed_out');
    expect(fetchFn.calls).toHaveLength(1);
  });

  it('429 surfaces as RateLimitedError with Retry-After', async () => {
    const fetchFn = scriptedFetch([
      jsonResponse(
        { error: { code: 'rate_limited', message: 'x', doc_url: '' } },
        { status: 429, headers: { 'retry-after': '7', 'content-type': 'application/json' } },
      ),
    ]);

    const err = await build(fetchFn)
      .reply({ token: 'g', text: 'x' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).retryAfterMs).toBe(7000);
  });

  it('poolse.notificationActions uses the grant, not the session token', async () => {
    const fetchFn = scriptedFetch([noContent()]);
    const getToken = vi.fn(() => 'session-jwt');
    const chat = new Poolse({ apiUrl: 'https://chat.test', getToken, fetch: fetchFn });

    await chat.notificationActions.read({ token: 'grant-3' });

    expect(fetchFn.calls[0]!.headers.get('authorization')).toBe('Bearer grant-3');
    expect(getToken).not.toHaveBeenCalled();
  });

  it('parseNotificationActions', () => {
    expect(parseNotificationActions('reply,mark_read')).toEqual(['reply', 'mark_read']);
    expect(parseNotificationActions('reply, snooze')).toEqual(['reply']);
    expect(parseNotificationActions('')).toEqual([]);
    expect(parseNotificationActions(undefined)).toEqual([]);
  });
});
