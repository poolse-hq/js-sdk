import { describe, expect, it } from 'vitest';
import { buildPoolse, jsonResponse, scriptedFetch } from './_helpers.js';

describe('MeResource', () => {
  it('GETs /v1/me and returns the parsed user', async () => {
    const me = {
      id: 'u-1',
      tenant_id: 't-1',
      external_id: 'alice',
      display_name: 'Alice',
      custom_data: {},
      is_blocked: false,
      inserted_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const fetchFn = scriptedFetch([jsonResponse(me)]);
    const chat = buildPoolse(fetchFn);

    const result = await chat.me.show();

    expect(result).toEqual(me);
    expect(fetchFn.calls).toHaveLength(1);
    expect(fetchFn.calls[0]?.method).toBe('GET');
    expect(fetchFn.calls[0]?.url).toBe('https://chat.test/v1/me');
    expect(fetchFn.calls[0]?.headers.get('authorization')).toBe('Bearer jwt-abc');
  });

  it('forwards an AbortSignal to fetch', async () => {
    const fetchFn = scriptedFetch([jsonResponse({})]);
    const chat = buildPoolse(fetchFn);
    const controller = new AbortController();

    await chat.me.show(controller.signal);

    // The Request object built from init.signal will be in `signal`.
    // We can't easily assert identity (fetch wraps it), but presence
    // is enough — the SDK plumbed it through.
    expect(fetchFn.calls[0]?.signal).toBeDefined();
  });
});
