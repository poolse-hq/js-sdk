import { describe, expect, it } from 'vitest';
import {
  AccountKey,
  BlobConflictError,
  BlobTransportError,
  EncryptedBlobStore,
  createHttpBlobTransport,
  isValidBlobKey,
  type BlobTransportErrorCode,
} from '../src';

const API = 'https://chat.example.com';

interface Call {
  method: string;
  url: URL;
  headers: Headers;
  body: Uint8Array | null;
}

/**
 * A fake of the poolse server's blob store (docs/STORAGE.md §5): quoted
 * numeric ETags, If-Match / If-None-Match, tombstones, the change feed.
 */
function fakeServer() {
  const blobs = new Map<
    string,
    { content: Uint8Array; version: number; deleted: boolean; updated: number }
  >();
  const calls: Call[] = [];
  let clock = 0;
  const etag = (v: number) => `"${v}"`;
  const wire = (key: string) => {
    const b = blobs.get(key)!;
    return {
      key,
      version: b.version,
      etag: etag(b.version),
      size: b.content.length,
      size_bytes: b.content.length,
      deleted: b.deleted,
      updated_at: new Date(b.updated * 1000).toISOString(),
    };
  };
  const error = (status: number, code: string) =>
    new Response(JSON.stringify({ error: { code, message: code } }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const unquote = (v: string | null) => v?.trim().replace(/^W\//, '').replace(/^"|"$/g, '') ?? null;

  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    const body = init.body ? new Uint8Array(init.body as Uint8Array) : null;
    const method = init.method ?? 'GET';
    calls.push({ method, url, headers, body });
    if (headers.get('authorization') !== 'Bearer t0k') return error(401, 'unauthorized');

    if (url.pathname === '/v1/me/blobs' && method === 'GET') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const cursor = url.searchParams.get('cursor');
      const limit = Number(url.searchParams.get('limit') ?? 200);
      const keys = [...blobs.keys()]
        .filter((k) => !blobs.get(k)!.deleted && k.startsWith(prefix) && (!cursor || k > cursor))
        .sort();
      const page = keys.slice(0, limit);
      return Response.json({
        data: page.map(wire),
        next_cursor: keys.length > limit ? page[page.length - 1] : null,
        limits: { max_blob_bytes: 26214400, max_user_bytes: 1073741824, max_blobs: 10000 },
      });
    }
    if (url.pathname === '/v1/me/blob-changes') {
      const after = Number(url.searchParams.get('cursor') ?? 0);
      const changed = [...blobs.keys()]
        .filter((k) => blobs.get(k)!.updated > after)
        .sort((a, b) => blobs.get(a)!.updated - blobs.get(b)!.updated);
      return Response.json({ data: changed.map(wire), next_cursor: String(clock) });
    }
    const key = decodeURIComponent(url.pathname.replace('/v1/me/blobs/', ''));
    const current = blobs.get(key);
    const live = current && !current.deleted;
    const ifMatch = unquote(headers.get('if-match'));
    const ifNoneMatch = headers.get('if-none-match');
    const preconditionFails =
      (ifNoneMatch === '*' && live) ||
      (ifMatch === '*' && !live) ||
      (ifMatch !== null && ifMatch !== '*' && String(current?.version) !== ifMatch);

    if (method === 'GET') {
      if (!live) return error(404, 'not_found');
      return new Response(new Uint8Array(current.content), {
        headers: { 'content-type': 'application/octet-stream', etag: etag(current.version) },
      });
    }
    if (method === 'PUT') {
      if (preconditionFails) return error(412, 'precondition_failed');
      const version = (current?.version ?? 0) + 1;
      blobs.set(key, { content: body!, version, deleted: false, updated: ++clock });
      return new Response(JSON.stringify({ key, version, size: body!.length }), {
        status: version === 1 ? 201 : 200,
        headers: { etag: etag(version), 'content-type': 'application/json' },
      });
    }
    if (method === 'DELETE') {
      if (!live) return error(404, 'not_found');
      if (preconditionFails) return error(412, 'precondition_failed');
      const version = current.version + 1;
      blobs.set(key, { content: new Uint8Array(0), version, deleted: true, updated: ++clock });
      return new Response(null, { status: 204, headers: { etag: etag(version) } });
    }
    return error(405, 'method_not_allowed');
  };
  return { fetch: fetch as typeof globalThis.fetch, blobs, calls };
}

/** A fetch that always answers with one response. */
function answering(status: number, body: unknown = null, headers: Record<string, string> = {}) {
  return (async () =>
    new Response(body === null ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    })) as typeof fetch;
}

const transportWith = (fetch: typeof globalThis.fetch) =>
  createHttpBlobTransport({ apiUrl: `${API}/`, getToken: () => 't0k', fetch });

async function expectTransportError(
  promise: Promise<unknown>,
  code: BlobTransportErrorCode,
): Promise<BlobTransportError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(BlobTransportError);
  expect((error as BlobTransportError).code).toBe(code);
  return error as BlobTransportError;
}

describe('HTTP blob transport', () => {
  it('round-trips bytes and ETag versions, with the right headers', async () => {
    const server = fakeServer();
    const t = transportWith(server.fetch);
    const created = await t.put('st6.abc', Uint8Array.of(1, 2, 3), { ifNoneMatch: '*' });
    expect(created.version).toBe('1');
    const put = server.calls.at(-1)!;
    expect(put.method).toBe('PUT');
    expect(put.url.href).toBe(`${API}/v1/me/blobs/st6.abc`);
    expect(put.headers.get('authorization')).toBe('Bearer t0k');
    expect(put.headers.get('content-type')).toBe('application/octet-stream');
    expect(put.headers.get('if-none-match')).toBe('*');
    expect(put.body).toEqual(Uint8Array.of(1, 2, 3));

    const got = await t.get('st6.abc');
    expect(got).toEqual({ data: Uint8Array.of(1, 2, 3), version: '1' });

    const updated = await t.put('st6.abc', Uint8Array.of(4), { ifMatch: got!.version });
    expect(server.calls.at(-1)!.headers.get('if-match')).toBe('"1"');
    expect(updated.version).toBe('2');
  });

  it('maps 412 and 409 to BlobConflictError with the current version', async () => {
    const server = fakeServer();
    const t = transportWith(server.fetch);
    await t.put('k', Uint8Array.of(1), {});
    await expect(t.put('k', Uint8Array.of(2), { ifNoneMatch: '*' })).rejects.toBeInstanceOf(
      BlobConflictError,
    );
    await expect(t.put('k', Uint8Array.of(2), { ifMatch: '7' })).rejects.toBeInstanceOf(
      BlobConflictError,
    );
    const c = await transportWith(answering(409, null, { etag: '"5"' }))
      .put('k', Uint8Array.of(1), {})
      .catch((e: unknown) => e);
    expect(c).toBeInstanceOf(BlobConflictError);
    expect((c as BlobConflictError).currentVersion).toBe('5');
  });

  it('get: 404 is null', async () => {
    expect(await transportWith(fakeServer().fetch).get('missing')).toBeNull();
  });

  it('get without an ETag is a bad response (CORS hint)', async () => {
    const t = transportWith((async () => new Response(new Uint8Array([1]))) as typeof fetch);
    const e = await expectTransportError(t.get('k'), 'bad_response');
    expect(e.message).toMatch(/Access-Control-Expose-Headers/);
  });

  it('put falls back to the JSON version without an ETag', async () => {
    const t = transportWith(answering(201, { key: 'k', version: 9, size: 1 }));
    expect(await t.put('k', Uint8Array.of(1), {})).toEqual({ version: '9' });
  });

  it('delete: 204, If-Match honoured, 404 tolerated only without If-Match', async () => {
    const server = fakeServer();
    const t = transportWith(server.fetch);
    await t.put('k', Uint8Array.of(1), {});
    await expect(t.delete('k', { ifMatch: '9' })).rejects.toBeInstanceOf(BlobConflictError);
    await t.delete('k', { ifMatch: '1' });
    expect(server.calls.at(-1)!.headers.get('if-match')).toBe('"1"');
    expect(await t.get('k')).toBeNull();
    await expect(t.delete('k', {})).resolves.toBeUndefined();
    await expect(t.delete('k', { ifMatch: '2' })).rejects.toBeInstanceOf(BlobConflictError);
  });

  it('maps every error status to a clear code', async () => {
    const cases: [number, string | null, BlobTransportErrorCode][] = [
      [413, 'too_large', 'too_large'],
      [413, 'quota_exceeded', 'quota_exceeded'],
      [403, 'sync_disabled', 'sync_disabled'],
      [403, 'forbidden', 'forbidden'],
      [422, 'invalid_key', 'invalid_key'],
      [422, 'validation_failed', 'http'],
      [401, 'unauthorized', 'unauthorized'],
      [500, null, 'server'],
      [503, null, 'server'],
      [400, 'bad_request', 'http'],
    ];
    for (const [status, code, expected] of cases) {
      const body = code ? { error: { code, message: `m:${code}` } } : null;
      const e = await expectTransportError(
        transportWith(answering(status, body)).put('k', Uint8Array.of(1), {}),
        expected,
      );
      expect(e.status).toBe(status);
      expect(e.serverCode).toBe(code);
      if (code) expect(e.message).toBe(`m:${code}`);
    }
    await expectTransportError(transportWith(answering(404, null)).list({}), 'not_found');
  });

  it('429 carries Retry-After and is retryable', async () => {
    const e = await expectTransportError(
      transportWith(
        answering(429, { error: { code: 'rate_limited' } }, { 'retry-after': '7' }),
      ).get('k'),
      'rate_limited',
    );
    expect(e.retryAfterMs).toBe(7000);
    expect(e.retryable).toBe(true);
  });

  it('network failures and a missing fetch are network errors', async () => {
    const failing = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    const e = await expectTransportError(transportWith(failing).get('k'), 'network');
    expect(e.status).toBe(0);
  });

  it('asks for a new token once after a 401', async () => {
    const server = fakeServer();
    const tokens = ['stale', 't0k'];
    const t = createHttpBlobTransport({
      apiUrl: API,
      getToken: async () => tokens.shift() ?? 'none',
      fetch: server.fetch,
    });
    expect(await t.get('k')).toBeNull();
    expect(server.calls.length).toBe(2);
    const never = createHttpBlobTransport({
      apiUrl: API,
      getToken: () => 'bad',
      fetch: server.fetch,
    });
    await expectTransportError(never.get('k'), 'unauthorized');
  });

  it('refuses invalid keys before sending anything', async () => {
    const server = fakeServer();
    const t = transportWith(server.fetch);
    for (const key of ['', 'A', 'a/b', '.a', 'a.', 'a..b', 'x'.repeat(129), 'ä']) {
      expect(isValidBlobKey(key)).toBe(false);
      await expectTransportError(t.get(key), 'invalid_key');
    }
    expect(server.calls.length).toBe(0);
    expect(isValidBlobKey('st6.0123abc')).toBe(true);
    expect(isValidBlobKey('x'.repeat(128))).toBe(true);
  });

  it('lists with prefix and cursor, and reports limits', async () => {
    const server = fakeServer();
    const t = transportWith(server.fetch);
    for (const k of ['a.1', 'a.2', 'a.3', 'b.1']) await t.put(k, Uint8Array.of(1), {});
    const first = await t.list({ prefix: 'a.', limit: 2 });
    expect(server.calls.at(-1)!.url.search).toBe('?prefix=a.&limit=2');
    expect(first.blobs.map((b) => [b.key, b.version, b.size])).toEqual([
      ['a.1', '1', 1],
      ['a.2', '1', 1],
    ]);
    expect(first.limits).toEqual({
      maxBlobBytes: 26214400,
      maxUserBytes: 1073741824,
      maxBlobs: 10000,
    });
    const second = await t.list({ prefix: 'a.', limit: 2, cursor: first.cursor! });
    expect(second.blobs.map((b) => b.key)).toEqual(['a.3']);
    expect(second.cursor).toBeNull();
  });

  it('reads the change feed, deletions included, and keeps the cursor', async () => {
    const server = fakeServer();
    const t = transportWith(server.fetch);
    await t.put('a', Uint8Array.of(1), {});
    const first = await t.changes({});
    expect(first.changes.map((c) => [c.key, c.deleted])).toEqual([['a', false]]);
    await t.put('b', Uint8Array.of(1), {});
    await t.delete('a', {});
    const next = await t.changes({ cursor: first.cursor });
    expect(next.changes.map((c) => [c.key, c.deleted, c.version])).toEqual([
      ['b', false, '1'],
      ['a', true, '2'],
    ]);
    const idle = await t.changes({ cursor: next.cursor });
    expect(idle.changes).toEqual([]);
    expect(idle.cursor).toBe(next.cursor);
  });
});

describe('EncryptedBlobStore over HTTP', () => {
  it('syncs two devices, resolves a conflict with update(), and sees changes', async () => {
    const server = fakeServer();
    const accountKey = await AccountKey.generate();
    const make = () =>
      new EncryptedBlobStore({
        transport: transportWith(server.fetch),
        accountKey,
        namespace: 'settings',
        keyPrefix: 'st6.',
      });
    const a = make();
    const b = make();
    const key = await a.blobKey('pins');
    expect(isValidBlobKey(key)).toBe(true);

    await a.putJson('pins', ['general']);
    expect((await b.getJson<string[]>('pins'))?.value).toEqual(['general']);
    await a.updateJson<string[]>('pins', (p) => [...(p ?? []), 'eng']);

    // b's version is stale: a plain put conflicts, update() re-reads and merges.
    await expect(b.putJson('pins', ['lost'])).rejects.toBeInstanceOf(BlobConflictError);
    const merged = await b.updateJson<string[]>('pins', (p) => [...(p ?? []), 'design']);
    expect(merged).toEqual(['general', 'eng', 'design']);
    expect((await a.getJson<string[]>('pins'))?.value).toEqual(['general', 'eng', 'design']);
    // Server-side the bytes are opaque and the name is hidden.
    const stored = server.blobs.get(key)!;
    expect(new TextDecoder('latin1').decode(stored.content)).not.toContain('design');
    expect(stored.version).toBe(3);

    const listed = await b.list();
    expect(server.calls.at(-1)!.url.searchParams.get('prefix')).toBe('st6.');
    expect(listed.blobs.map((x) => x.key)).toEqual([key]);

    const changes = await b.changes();
    expect(changes.changes.map((c) => c.key)).toEqual([key]);
    await a.purge('pins');
    const after = await b.changes({ cursor: changes.cursor });
    expect(after.changes).toMatchObject([{ key, deleted: true }]);
    expect(await b.get('pins')).toBeNull();
  });
});
