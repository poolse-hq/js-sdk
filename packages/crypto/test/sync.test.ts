import { describe, expect, it } from 'vitest';
import {
  AccountKey,
  BlobConflictError,
  EncryptedBlobStore,
  MemoryBlobTransport,
  inspectEnvelope,
  type BlobTransport,
} from '../src';
import { expectCryptoError, expectEveryBitFlipRejected } from './helpers';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

async function twoDevices(transport: BlobTransport = new MemoryBlobTransport()) {
  const accountKey = await AccountKey.generate();
  return {
    accountKey,
    transport,
    a: new EncryptedBlobStore({ transport, accountKey, namespace: 'settings' }),
    b: new EncryptedBlobStore({ transport, accountKey, namespace: 'settings' }),
  };
}

describe('encrypted blob store', () => {
  it('syncs between two devices; the server sees neither names nor contents', async () => {
    const transport = new MemoryBlobTransport();
    const { a, b } = await twoDevices(transport);
    await a.putJson('theme', { scheme: 'dark', accent: 'ocean' });
    const got = await b.getJson<{ scheme: string }>('theme');
    expect(got?.value).toEqual({ scheme: 'dark', accent: 'ocean' });
    expect(got?.revision).toBe(1);

    const [key, stored] = [...transport.blobs.entries()][0]!;
    expect(key).toMatch(/^[0-9a-z]{32}$/);
    expect(key).toBe(await a.blobKey('theme'));
    const text = new TextDecoder('latin1').decode(stored.data);
    expect(text).not.toContain('theme');
    expect(text).not.toContain('ocean');
    expect(inspectEnvelope(stored.data)).toMatchObject({ kind: 'sync-record', revision: 1 });
  });

  it('a missing blob reads as null', async () => {
    const { a } = await twoDevices();
    expect(await a.get('nothing')).toBeNull();
  });

  it('detects conflicts with If-Match and merges with update()', async () => {
    const { a, b } = await twoDevices();
    await a.put('list', enc('x'));
    await b.get('list');
    await a.put('list', enc('x,a')); // a writes on top of its own version
    // b's version is now stale.
    await expect(b.put('list', enc('x,b'))).rejects.toBeInstanceOf(BlobConflictError);
    // update() re-reads and merges.
    const merged = await b.update('list', (current) => enc(`${dec(current!)},b`));
    expect(dec(merged!.data)).toBe('x,a,b');
    expect(merged!.revision).toBe(3);
    expect(dec((await a.get('list'))!.data)).toBe('x,a,b');
  });

  it('update() retries while another device keeps writing', async () => {
    const { a, b } = await twoDevices();
    await a.putJson('counter', 0);
    let interfere = 2;
    const result = await b.updateJson<number>('counter', async (n) => {
      if (interfere-- > 0) await a.updateJson<number>('counter', (m) => (m ?? 0) + 10);
      return (n ?? 0) + 1;
    });
    expect(result).toBe(21);
    expect((await a.getJson<number>('counter'))?.value).toBe(21);
  });

  it('creating refuses to overwrite an existing blob', async () => {
    const { a, b } = await twoDevices();
    await a.put('k', enc('a'));
    await expect(b.put('k', enc('b'), { ifVersion: null })).rejects.toBeInstanceOf(
      BlobConflictError,
    );
    await expect(b.put('k', enc('b'))).rejects.toBeInstanceOf(BlobConflictError); // never read it
  });

  it('deletes with an authenticated tombstone; purge removes it', async () => {
    const transport = new MemoryBlobTransport();
    const { a, b } = await twoDevices(transport);
    await a.put('draft', enc('hello'));
    await b.get('draft');
    await b.delete('draft');
    expect(await a.get('draft')).toBeNull();
    expect(transport.blobs.size).toBe(1);
    // Recreating continues the revision count.
    const again = await a.put('draft', enc('again'));
    expect(again.revision).toBe(3);
    await a.purge('draft');
    expect(transport.blobs.size).toBe(0);
  });

  it('refuses a rollback to an older revision', async () => {
    const transport = new MemoryBlobTransport();
    const { a, b } = await twoDevices(transport);
    await a.put('k', enc('v1'));
    const key = await a.blobKey('k');
    const old = transport.blobs.get(key)!;
    await a.put('k', enc('v2'));
    expect(dec((await b.get('k'))!.data)).toBe('v2');
    // The server serves the old record again.
    transport.blobs.set(key, { ...old, version: 'v99' });
    await expectCryptoError(b.get('k'), 'rollback');
  });

  it('remembers revisions across restarts with a RevisionStore', async () => {
    const transport = new MemoryBlobTransport();
    const accountKey = await AccountKey.generate();
    const saved = new Map<string, number>();
    const revisions = {
      get: (k: string) => saved.get(k),
      set: (k: string, r: number) => void saved.set(k, r),
    };
    const a = new EncryptedBlobStore({ transport, accountKey });
    await a.put('k', enc('v1'));
    const key = await a.blobKey('k');
    const old = transport.blobs.get(key)!;
    await a.put('k', enc('v2'));
    await new EncryptedBlobStore({ transport, accountKey, revisions }).get('k');
    transport.blobs.set(key, old);
    const restarted = new EncryptedBlobStore({ transport, accountKey, revisions });
    await expectCryptoError(restarted.get('k'), 'rollback');
  });

  it('refuses a record moved to another key or namespace', async () => {
    const transport = new MemoryBlobTransport();
    const { a, accountKey } = await twoDevices(transport);
    await a.put('one', enc('1'));
    await a.put('two', enc('2'));
    const k1 = await a.blobKey('one');
    const k2 = await a.blobKey('two');
    transport.blobs.set(k2, transport.blobs.get(k1)!);
    await expectCryptoError(a.get('two'), 'tampered');

    const other = new EncryptedBlobStore({ transport, accountKey, namespace: 'drafts' });
    expect(await other.blobKey('one')).not.toBe(k1);
    await expectCryptoError(other.getByKey(k1), 'wrong-key');
  });

  it('refuses another account key', async () => {
    const transport = new MemoryBlobTransport();
    const { a } = await twoDevices(transport);
    await a.put('k', enc('secret'));
    const stranger = new EncryptedBlobStore({
      transport,
      accountKey: await AccountKey.generate(),
      namespace: 'settings',
    });
    await expectCryptoError(stranger.getByKey(await a.blobKey('k')), 'wrong-key');
  });

  it('rejects every single-bit change to a record', async () => {
    const transport = new MemoryBlobTransport();
    const { a, accountKey } = await twoDevices(transport);
    await a.put('k', enc('data'));
    const key = await a.blobKey('k');
    const record = transport.blobs.get(key)!.data;
    await expectEveryBitFlipRejected(record, async (altered) => {
      const t = new MemoryBlobTransport();
      t.blobs.set(key, { data: altered, version: 'v1', updatedAt: '' });
      return new EncryptedBlobStore({ transport: t, accountKey, namespace: 'settings' }).get('k');
    });
  });

  it('lists blobs page by page and reads them back by key', async () => {
    const { a, b } = await twoDevices();
    const names = Array.from({ length: 7 }, (_, i) => `item-${i}`);
    for (const name of names) await a.put(name, enc(name));
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await b.list(cursor === undefined ? { limit: 3 } : { limit: 3, cursor });
      for (const info of page.blobs) seen.push((await b.getByKey(info.key))!.name);
      cursor = page.cursor ?? undefined;
    } while (cursor);
    expect(seen.sort()).toEqual(names);
  });

  it('keyPrefix scopes blob keys and listing', async () => {
    const transport = new MemoryBlobTransport();
    const accountKey = await AccountKey.generate();
    const st6 = new EncryptedBlobStore({ transport, accountKey, keyPrefix: 'st6.' });
    const other = new EncryptedBlobStore({ transport, accountKey, keyPrefix: 'nt.' });
    await st6.put('a', enc('1'));
    await other.put('a', enc('2'));
    expect((await st6.blobKey('a')).startsWith('st6.')).toBe(true);
    expect((await st6.list()).blobs.map((b) => b.key)).toEqual([await st6.blobKey('a')]);
  });

  it('has a change feed (memory transport) filtered by keyPrefix', async () => {
    const transport = new MemoryBlobTransport();
    const accountKey = await AccountKey.generate();
    const store = new EncryptedBlobStore({ transport, accountKey, keyPrefix: 'st6.' });
    const other = new EncryptedBlobStore({ transport, accountKey, keyPrefix: 'nt.' });
    await store.put('a', enc('1'));
    await other.put('a', enc('2'));
    const first = await store.changes();
    expect(first.changes.map((c) => c.key)).toEqual([await store.blobKey('a')]);
    await store.purge('a');
    const next = await store.changes({ cursor: first.cursor });
    expect(next.changes).toMatchObject([{ key: await store.blobKey('a'), deleted: true }]);
    await expectCryptoError(
      new EncryptedBlobStore({
        transport: {
          ...transport,
          get: transport.get,
          put: transport.put,
          delete: transport.delete,
          list: transport.list,
        },
        accountKey,
      }).changes(),
      'unavailable',
    );
  });

  it('validates names', async () => {
    const { a } = await twoDevices();
    await expectCryptoError(a.put('', enc('x')), 'malformed');
    await expectCryptoError(a.put('x'.repeat(2000), enc('x')), 'malformed');
  });
});
