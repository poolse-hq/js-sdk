/**
 * Encrypted sync of a user's own data between their devices (ST6), over an
 * opaque per-user blob store (`PUT/GET/DELETE /v1/me/blobs/:key` with
 * `If-Match` versions, and a cursor-paged list). The server sees blob keys,
 * sizes, versions and times — never names or contents.
 *
 * Sync record (kind 8):
 *
 *   header(4) | revision u64 | keyCheck(16) | iv(12) | ct
 *
 * Plaintext (Padmé-padded): flags u8 (bit 0 = deleted) | u16 len | name | data.
 * The key is HKDF(accountKey, "key/sync/<namespace>"); the associated data
 * binds the namespace and blob key, so a record can't be moved to another
 * key. The revision goes up by one on every write; a device that remembers
 * the highest revision it has seen (`revisions`) notices a server serving an
 * older record and refuses it with `rollback`.
 */
import { type Bytes, ByteReader, ByteWriter, concat, fromUtf8, toBase32, utf8 } from './bytes';
import { BlobConflictError, PoolseCryptoError } from './errors';
import {
  Alg,
  CHECK_LENGTH,
  DOMAIN,
  Kind,
  deriveAesKey,
  encodeAssociatedData,
  keyCheck,
  pad,
  readHeader,
  unpad,
  verifyKeyCheck,
  writeHeader,
} from './format';
import { type AccountKey, secretOf } from './keys';
import { IV_LENGTH, aesDecrypt, aesEncrypt, hkdf, hmac, label, randomBytes } from './subtle';

// ---------------------------------------------------------------------------
// Transport

/** One blob as the server lists it. */
export interface BlobInfo {
  key: string;
  /** Opaque version for `If-Match` (the server's ETag, unquoted). */
  version: string;
  size?: number;
  updatedAt?: string;
}

/** One entry of the change feed: a blob written or deleted. */
export interface BlobChange extends BlobInfo {
  deleted: boolean;
}

/** The server's limits, as it reports them with a listing. */
export interface BlobLimits {
  maxBlobBytes?: number;
  maxUserBytes?: number;
  maxBlobs?: number;
}

/**
 * Preconditions for a write. `ifMatch`: only if the blob is still at that
 * version. `ifNoneMatch: '*'`: only if it doesn't exist yet. Neither:
 * unconditionally.
 */
export interface BlobPrecondition {
  ifMatch?: string;
  ifNoneMatch?: '*';
}

export interface BlobListOptions {
  cursor?: string;
  limit?: number;
  /** Only keys starting with this. */
  prefix?: string;
}

export interface BlobListPage {
  blobs: BlobInfo[];
  /** Pass back for the next page; `null` on the last one. */
  cursor: string | null;
  limits?: BlobLimits;
}

export interface BlobChangesPage {
  changes: BlobChange[];
  /** Keep it and pass it next time — returned even when nothing changed. */
  cursor: string;
}

/**
 * How the store reaches the server. `createHttpBlobTransport` talks to the
 * poolse server; `MemoryBlobTransport` is an in-memory one for tests.
 *
 * `put` and `delete` must throw `BlobConflictError` when a precondition
 * fails (HTTP 412, or 409 for a create that found the key taken); `get`
 * returns `null` for a missing blob (404). `changes` is optional: a feed of
 * writes and deletions since a cursor, oldest first.
 */
export interface BlobTransport {
  get(key: string): Promise<{ data: Uint8Array; version: string } | null>;
  put(key: string, data: Uint8Array, precondition: BlobPrecondition): Promise<{ version: string }>;
  delete(key: string, precondition: BlobPrecondition): Promise<void>;
  list(options: BlobListOptions): Promise<BlobListPage>;
  changes?(options: { cursor?: string; limit?: number }): Promise<BlobChangesPage>;
}

/** An in-memory BlobTransport with the server's If-Match semantics. */
export class MemoryBlobTransport implements BlobTransport {
  readonly blobs = new Map<string, { data: Uint8Array; version: string; updatedAt: string }>();
  private counter = 0;
  private readonly log: BlobChange[] = [];

  private check(key: string, precondition: BlobPrecondition): void {
    const current = this.blobs.get(key);
    if (precondition.ifNoneMatch === '*' && current)
      throw new BlobConflictError(key, current.version);
    if (precondition.ifMatch !== undefined && current?.version !== precondition.ifMatch) {
      throw new BlobConflictError(key, current?.version ?? null);
    }
  }

  async get(key: string) {
    const blob = this.blobs.get(key);
    return blob ? { data: new Uint8Array(blob.data), version: blob.version } : null;
  }

  async put(key: string, data: Uint8Array, precondition: BlobPrecondition) {
    this.check(key, precondition);
    const version = `v${++this.counter}`;
    const updatedAt = new Date().toISOString();
    this.blobs.set(key, { data: new Uint8Array(data), version, updatedAt });
    this.log.push({ key, version, size: data.length, updatedAt, deleted: false });
    return { version };
  }

  async delete(key: string, precondition: BlobPrecondition) {
    this.check(key, precondition);
    if (!this.blobs.delete(key)) return;
    const version = `v${++this.counter}`;
    this.log.push({ key, version, size: 0, updatedAt: new Date().toISOString(), deleted: true });
  }

  async list(options: BlobListOptions) {
    const limit = options.limit ?? 100;
    const keys = [...this.blobs.keys()]
      .sort()
      .filter((k) => options.prefix === undefined || k.startsWith(options.prefix))
      .filter((k) => options.cursor === undefined || k > options.cursor);
    const page = keys.slice(0, limit);
    return {
      blobs: page.map((key) => {
        const blob = this.blobs.get(key)!;
        return { key, version: blob.version, size: blob.data.length, updatedAt: blob.updatedAt };
      }),
      cursor: keys.length > limit ? (page[page.length - 1] ?? null) : null,
    };
  }

  async changes(options: { cursor?: string; limit?: number }) {
    const from = options.cursor === undefined ? 0 : Number(options.cursor);
    const page = this.log.slice(from, from + (options.limit ?? 100));
    return { changes: page.map((c) => ({ ...c })), cursor: String(from + page.length) };
  }
}

/**
 * Where the highest revision seen per blob is remembered. The default is in
 * memory, which catches rollbacks within one session only; give the store a
 * persistent one (IndexedDB, AsyncStorage, a file) to catch them across
 * restarts.
 */
export interface RevisionStore {
  get(key: string): number | undefined | Promise<number | undefined>;
  set(key: string, revision: number): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Store

export interface EncryptedBlobStoreOptions {
  transport: BlobTransport;
  accountKey: AccountKey;
  /** Separates kinds of data (e.g. `"settings"`, `"drafts"`): each gets its own key. Default `"default"`. */
  namespace?: string;
  revisions?: RevisionStore;
  /** Prefix for every blob key, e.g. `"st6."`. Default none. */
  keyPrefix?: string;
}

/** A decrypted blob. */
export interface SyncedBlob {
  name: string;
  data: Uint8Array;
  /** The server's version — pass it as `ifVersion` to write on top of exactly this. */
  version: string;
  revision: number;
}

export interface PutOptions {
  /**
   * `string`: write only if the blob is still at this version. `null`: only
   * if it doesn't exist. Omitted: on top of the version this store last read
   * or wrote for the name, or as a new blob if it has seen none.
   */
  ifVersion?: string | null;
}

const FLAG_DELETED = 0x01;
const MAX_NAME_LENGTH = 1024;

export class EncryptedBlobStore {
  private readonly transport: BlobTransport;
  private readonly accountKey: AccountKey;
  private readonly namespace: string;
  private readonly keyPrefix: string;
  private readonly revisions: RevisionStore;
  private readonly known = new Map<string, { version: string; revision: number }>();
  private keyPromise: Promise<CryptoKey> | null = null;
  private nameKeyPromise: Promise<Bytes> | null = null;

  constructor(options: EncryptedBlobStoreOptions) {
    this.transport = options.transport;
    this.accountKey = options.accountKey;
    this.namespace = options.namespace ?? 'default';
    this.keyPrefix = options.keyPrefix ?? '';
    const memory = new Map<string, number>();
    this.revisions = options.revisions ?? {
      get: (key) => memory.get(key),
      set: (key, revision) => void memory.set(key, revision),
    };
  }

  private contentKey(): Promise<CryptoKey> {
    this.keyPromise ??= deriveAesKey(secretOf(this.accountKey), `sync/${this.namespace}`);
    return this.keyPromise;
  }

  /**
   * The blob key for a name: an HMAC of the namespace and name under a key
   * derived from the account key, so the server can't read names or tell
   * which blob is which across namespaces.
   */
  async blobKey(name: string): Promise<string> {
    checkName(name);
    this.nameKeyPromise ??= hkdf(
      secretOf(this.accountKey),
      new Uint8Array(0),
      label(DOMAIN, 'key/sync-names/', this.namespace),
    );
    const mac = await hmac(await this.nameKeyPromise, utf8(name));
    return this.keyPrefix + toBase32(mac.slice(0, 20)).toLowerCase();
  }

  private aad(prefix: Uint8Array, blobKey: string): Bytes {
    return concat(
      prefix,
      encodeAssociatedData('sync', { namespace: this.namespace, key: blobKey }),
    );
  }

  private async seal(
    blobKey: string,
    revision: number,
    flags: number,
    name: string,
    data: Uint8Array,
  ) {
    const raw = secretOf(this.accountKey);
    const iv = randomBytes(IV_LENGTH);
    const prefix = writeHeader(new ByteWriter(), Kind.SyncRecord, Alg.Aes256GcmHkdfSha256)
      .u64(revision)
      .bytes(await keyCheck(raw, `sync/${this.namespace}`))
      .bytes(iv)
      .finish();
    const plaintext = new ByteWriter().u8(flags).bytes16(utf8(name)).bytes(data).finish();
    const ct = await aesEncrypt(
      await this.contentKey(),
      iv,
      pad(plaintext),
      this.aad(prefix, blobKey),
    );
    return concat(prefix, ct);
  }

  private async open(blobKey: string, record: Uint8Array) {
    const r = new ByteReader(record);
    readHeader(r, Kind.SyncRecord, [Alg.Aes256GcmHkdfSha256]);
    const revision = r.u64();
    await verifyKeyCheck(
      secretOf(this.accountKey),
      `sync/${this.namespace}`,
      r.bytes(CHECK_LENGTH),
    );
    const iv = r.bytes(IV_LENGTH);
    const prefix = r.consumed();
    const ct = r.rest();
    const plaintext = unpad(
      await aesDecrypt(await this.contentKey(), iv, ct, this.aad(prefix, blobKey)),
    );
    const p = new ByteReader(plaintext);
    const flags = p.u8();
    const name = fromUtf8(p.bytes16());
    const data = p.rest();
    return { revision, deleted: (flags & FLAG_DELETED) !== 0, name, data };
  }

  /** Read by blob key (as `list` returns them). Deleted blobs read as `null`. */
  async getByKey(blobKey: string): Promise<SyncedBlob | null> {
    const blob = await this.transport.get(blobKey);
    if (!blob) return null;
    const record = await this.open(blobKey, blob.data);
    const seen = await this.revisions.get(blobKey);
    if (seen !== undefined && record.revision < seen) {
      throw new PoolseCryptoError(
        'rollback',
        `The server returned revision ${record.revision} of a blob already seen at ${seen}`,
      );
    }
    await this.remember(blobKey, blob.version, record.revision);
    if (record.deleted) return null;
    return {
      name: record.name,
      data: record.data,
      version: blob.version,
      revision: record.revision,
    };
  }

  /** Download and decrypt a blob. `null` if it doesn't exist or was deleted. */
  async get(name: string): Promise<SyncedBlob | null> {
    const blobKey = await this.blobKey(name);
    const blob = await this.getByKey(blobKey);
    if (blob && blob.name !== name) {
      throw new PoolseCryptoError('tampered', 'The blob belongs to a different name');
    }
    return blob;
  }

  async getJson<T = unknown>(
    name: string,
  ): Promise<(Omit<SyncedBlob, 'data'> & { value: T }) | null> {
    const blob = await this.get(name);
    if (!blob) return null;
    const { data, ...rest } = blob;
    return { ...rest, value: JSON.parse(fromUtf8(data)) as T };
  }

  /**
   * Encrypt and upload. Throws `BlobConflictError` when another device wrote
   * first: `get` the newer version, merge, and `put` again (or use `update`).
   */
  async put(name: string, data: Uint8Array, options: PutOptions = {}): Promise<SyncedBlob> {
    return this.write(name, data, 0, options);
  }

  async putJson(name: string, value: unknown, options: PutOptions = {}): Promise<SyncedBlob> {
    return this.put(name, utf8(JSON.stringify(value)), options);
  }

  /**
   * Delete by writing an encrypted tombstone, so the deletion is authenticated
   * and the revision keeps counting (a plain DELETE could be forged or undone
   * by the server). `purge` removes the blob for real.
   */
  async delete(name: string, options: PutOptions = {}): Promise<void> {
    await this.write(name, new Uint8Array(0), FLAG_DELETED, options);
  }

  /** Remove the blob from the server. Unauthenticated: prefer `delete`. */
  async purge(name: string, options: PutOptions = {}): Promise<void> {
    const blobKey = await this.blobKey(name);
    const version =
      options.ifVersion === undefined ? this.known.get(blobKey)?.version : options.ifVersion;
    await this.transport.delete(blobKey, version ? { ifMatch: version } : {});
    this.known.delete(blobKey);
  }

  /**
   * Read, change, write — retried on conflict. `change` gets the current
   * data (`null` if none) and returns the new data, or `null` to delete.
   * It may run more than once, so keep it free of side effects.
   */
  async update(
    name: string,
    change: (current: Uint8Array | null) => Uint8Array | null | Promise<Uint8Array | null>,
    options: { retries?: number } = {},
  ): Promise<SyncedBlob | null> {
    const retries = options.retries ?? 5;
    for (let attempt = 0; ; attempt++) {
      const blobKey = await this.blobKey(name);
      const current = await this.get(name);
      const next = await change(current ? current.data : null);
      // A tombstone still has a version to write on top of.
      const ifVersion = current?.version ?? this.known.get(blobKey)?.version ?? null;
      try {
        if (next === null) {
          if (current) await this.delete(name, { ifVersion });
          return null;
        }
        return await this.put(name, next, { ifVersion });
      } catch (error) {
        if (!(error instanceof BlobConflictError) || attempt >= retries) throw error;
      }
    }
  }

  async updateJson<T>(
    name: string,
    change: (current: T | null) => T | null | Promise<T | null>,
    options: { retries?: number } = {},
  ): Promise<T | null> {
    let result: T | null = null;
    await this.update(
      name,
      async (data) => {
        result = await change(data ? (JSON.parse(fromUtf8(data)) as T) : null);
        return result === null ? null : utf8(JSON.stringify(result));
      },
      options,
    );
    return result;
  }

  /**
   * One page of this user's blobs (under `keyPrefix`, if set). Read each with
   * `getByKey`.
   */
  async list(options: { cursor?: string; limit?: number } = {}): Promise<BlobListPage> {
    const page = await this.transport.list(
      this.keyPrefix ? { ...options, prefix: this.keyPrefix } : options,
    );
    if (!this.keyPrefix) return page;
    return { ...page, blobs: page.blobs.filter((b) => b.key.startsWith(this.keyPrefix)) };
  }

  /**
   * What changed since `cursor` (writes and deletions, oldest first), under
   * `keyPrefix` if set. Keep the returned cursor; read changed blobs with
   * `getByKey` (a deleted one reads as `null`). Needs a transport with
   * `changes` (the HTTP one has it).
   */
  async changes(options: { cursor?: string; limit?: number } = {}): Promise<BlobChangesPage> {
    if (!this.transport.changes) {
      throw new PoolseCryptoError('unavailable', 'This blob transport has no change feed');
    }
    const page = await this.transport.changes(options);
    if (!this.keyPrefix) return page;
    return { ...page, changes: page.changes.filter((c) => c.key.startsWith(this.keyPrefix)) };
  }

  private async write(
    name: string,
    data: Uint8Array,
    flags: number,
    options: PutOptions,
  ): Promise<SyncedBlob> {
    const blobKey = await this.blobKey(name);
    const known = this.known.get(blobKey);
    const ifVersion =
      options.ifVersion === undefined ? (known?.version ?? null) : options.ifVersion;
    const seen = (await this.revisions.get(blobKey)) ?? 0;
    const revision = Math.max(seen, known?.revision ?? 0) + 1;
    const record = await this.seal(blobKey, revision, flags, name, data);
    let result: { version: string };
    try {
      result = await this.transport.put(
        blobKey,
        record,
        ifVersion === null ? { ifNoneMatch: '*' } : { ifMatch: ifVersion },
      );
    } catch (error) {
      if (error instanceof BlobConflictError) this.known.delete(blobKey);
      throw error;
    }
    await this.remember(blobKey, result.version, revision);
    return { name, data: new Uint8Array(data), version: result.version, revision };
  }

  private async remember(blobKey: string, version: string, revision: number): Promise<void> {
    this.known.set(blobKey, { version, revision });
    const seen = await this.revisions.get(blobKey);
    if (seen === undefined || revision > seen) await this.revisions.set(blobKey, revision);
  }
}

function checkName(name: string): void {
  if (typeof name !== 'string' || name.length === 0 || utf8(name).length > MAX_NAME_LENGTH) {
    throw new PoolseCryptoError('malformed', `Blob names are 1…${MAX_NAME_LENGTH} bytes`);
  }
}
