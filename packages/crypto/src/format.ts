/**
 * The envelope format shared by everything this library writes.
 *
 * Every binary object starts with the same four bytes:
 *
 *   0x70 ('p')  magic
 *   0x01        format version — bumped for any incompatible change
 *   kind        what follows (item, key wrap, attachment, …)
 *   alg         the algorithm suite it was made with
 *
 * A reader refuses a newer format version or an unknown algorithm with
 * `unsupported`, so old clients fail loudly instead of misreading new data.
 * The header (and every field after it up to the ciphertext) is part of the
 * AES-GCM associated data, so it can't be changed without detection either.
 */
import { type Bytes, ByteReader, ByteWriter, concat, constantTimeEqual, utf8 } from './bytes';
import { PoolseCryptoError } from './errors';
import { aesKey, hkdf, label } from './subtle';

export const MAGIC = 0x70;
export const FORMAT_VERSION = 1;

export const Kind = {
  Item: 1,
  KeyWrap: 2,
  PublicKeyWrap: 3,
  Attachment: 4,
  DeviceRequest: 5,
  DeviceGrant: 6,
  DevicePublicKeys: 7,
  SyncRecord: 8,
  DeviceSecret: 9,
} as const;
export type EnvelopeKind = (typeof Kind)[keyof typeof Kind];

/**
 * Algorithm suites. A new suite gets a new id; existing ids never change
 * meaning.
 */
export const Alg = {
  /** No encryption (only for the device-key export when no wrapping key is given). */
  None: 0,
  /** AES-256-GCM, keys derived with HKDF-SHA-256. */
  Aes256GcmHkdfSha256: 1,
  /** P-256: ECDH + HKDF-SHA-256 + AES-256-GCM for wrapping, ECDSA/SHA-256 for signatures. */
  P256: 2,
  /** HMAC-SHA-256 over a P-256 payload (device grants). */
  HmacSha256: 3,
} as const;
export type AlgorithmId = (typeof Alg)[keyof typeof Alg];

const KIND_NAMES: Record<number, string> = {
  [Kind.Item]: 'item',
  [Kind.KeyWrap]: 'key wrap',
  [Kind.PublicKeyWrap]: 'public key wrap',
  [Kind.Attachment]: 'attachment',
  [Kind.DeviceRequest]: 'device request',
  [Kind.DeviceGrant]: 'device grant',
  [Kind.DevicePublicKeys]: 'device public keys',
  [Kind.SyncRecord]: 'sync record',
  [Kind.DeviceSecret]: 'device secret',
};

/** Domain-separation prefix for every HKDF info, MAC and signature input. */
export const DOMAIN = 'poolse-crypto/v1/';

export const HEADER_LENGTH = 4;

export function writeHeader(writer: ByteWriter, kind: EnvelopeKind, alg: AlgorithmId): ByteWriter {
  return writer.u8(MAGIC).u8(FORMAT_VERSION).u8(kind).u8(alg);
}

/**
 * Read and check the four-byte header. `algs` lists the suites the caller
 * can handle for this kind; the chosen one is returned.
 */
export function readHeader(
  reader: ByteReader,
  kind: EnvelopeKind,
  algs: readonly AlgorithmId[],
): AlgorithmId {
  if (reader.remaining() < HEADER_LENGTH)
    throw new PoolseCryptoError('malformed', 'Data is truncated');
  if (reader.u8() !== MAGIC) throw new PoolseCryptoError('malformed', 'Not poolse-crypto data');
  const version = reader.u8();
  if (version > FORMAT_VERSION) {
    throw new PoolseCryptoError(
      'unsupported',
      `Format version ${version} is newer than this library supports (${FORMAT_VERSION})`,
    );
  }
  if (version !== FORMAT_VERSION)
    throw new PoolseCryptoError('malformed', `Unknown format version ${version}`);
  const got = reader.u8();
  if (got !== kind) {
    throw new PoolseCryptoError(
      'malformed',
      `Expected ${KIND_NAMES[kind]} data, got ${KIND_NAMES[got] ?? `kind ${got}`}`,
    );
  }
  const alg = reader.u8();
  if (!(algs as readonly number[]).includes(alg)) {
    throw new PoolseCryptoError(
      'unsupported',
      `Unsupported algorithm ${alg} for ${KIND_NAMES[kind]}`,
    );
  }
  return alg as AlgorithmId;
}

/** What `inspectEnvelope` reports without decrypting anything. */
export interface EnvelopeInfo {
  formatVersion: number;
  kind:
    | 'item'
    | 'key-wrap'
    | 'public-key-wrap'
    | 'attachment'
    | 'device-request'
    | 'device-grant'
    | 'device-public-keys'
    | 'sync-record'
    | 'device-secret';
  alg: number;
  /** Item key version, for items, attachments and key wraps. */
  keyVersion?: number;
  /** Device id of the recipient, for public key wraps. */
  recipientId?: string;
  /** Revision, for sync records. */
  revision?: number;
}

// ---------------------------------------------------------------------------
// Associated data

/**
 * Values the ciphertext is bound to without being stored in it — typically
 * the item id and version. Decrypting with different values fails, which
 * stops a server from swapping one item's ciphertext in for another's or
 * serving an old version under a new number.
 *
 * Keys starting with `@` are reserved for the library.
 */
export type AssociatedData = Readonly<Record<string, string | number>>;

/**
 * Canonical encoding: a domain label, then the entries sorted by key, each
 * key and value length-prefixed and each value tagged with its type (so
 * `1` and `"1"` differ).
 */
export function encodeAssociatedData(
  domain: string,
  data: AssociatedData,
  internal: AssociatedData = {},
): Bytes {
  for (const key of Object.keys(data)) {
    if (key.startsWith('@')) {
      throw new PoolseCryptoError('malformed', `Associated-data key "${key}" is reserved`);
    }
  }
  const merged: Record<string, string | number> = { ...data, ...internal };
  const keys = Object.keys(merged).sort();
  const w = new ByteWriter().bytes16(utf8(`${DOMAIN}ad/${domain}`)).u16(keys.length);
  for (const key of keys) {
    if (key.length === 0) throw new PoolseCryptoError('malformed', 'Empty associated-data key');
    const value = merged[key];
    w.bytes16(utf8(key));
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new PoolseCryptoError(
          'malformed',
          `Associated-data value for "${key}" is not finite`,
        );
      }
      w.u8(1).bytes32(utf8(String(value)));
    } else if (typeof value === 'string') {
      w.u8(0).bytes32(utf8(value));
    } else {
      throw new PoolseCryptoError(
        'malformed',
        `Associated-data value for "${key}" must be a string or number`,
      );
    }
  }
  return w.finish();
}

// ---------------------------------------------------------------------------
// Key derivation helpers

/** An AES-256-GCM key derived from `raw` for one purpose. */
export async function deriveAesKey(
  raw: Uint8Array,
  purpose: string,
  salt: Uint8Array = new Uint8Array(0),
): Promise<CryptoKey> {
  return aesKey(await hkdf(raw, salt, label(DOMAIN, 'key/', purpose)));
}

export const CHECK_LENGTH = 16;

/**
 * A 16-byte key check value stored next to the ciphertext. It is derived on
 * its own HKDF branch, so it says nothing about the content key, and it lets
 * a reader tell "wrong key" from "tampered". It also commits the envelope to
 * one key, which AES-GCM on its own doesn't.
 */
export async function keyCheck(raw: Uint8Array, purpose: string): Promise<Bytes> {
  return hkdf(raw, new Uint8Array(0), label(DOMAIN, 'check/', purpose), CHECK_LENGTH);
}

export async function verifyKeyCheck(
  raw: Uint8Array,
  purpose: string,
  stored: Uint8Array,
): Promise<void> {
  if (!constantTimeEqual(await keyCheck(raw, purpose), stored)) {
    throw new PoolseCryptoError('wrong-key', 'This was encrypted with a different key');
  }
}

/** A public 16-byte identifier derived from a secret key. */
export async function keyId(raw: Uint8Array, purpose: string): Promise<Bytes> {
  return hkdf(raw, new Uint8Array(0), label(DOMAIN, 'id/', purpose), 16);
}

// ---------------------------------------------------------------------------
// Padding (Padmé): hides the exact plaintext length, leaking at most
// O(log log n) bits of it, for at most ~12% overhead.

export function padmeLength(length: number): number {
  if (length < 2) return length;
  const e = Math.floor(Math.log2(length));
  const s = Math.floor(Math.log2(e)) + 1;
  const lastBits = e - s;
  const mask = 2 ** lastBits - 1;
  return Math.ceil(length / (mask + 1)) * (mask + 1);
}

/** u32 length || data || zero bytes, up to the Padmé length. */
export function pad(data: Uint8Array): Bytes {
  const unpadded = 4 + data.length;
  const out = new Uint8Array(Math.max(padmeLength(unpadded), 32));
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(data, 4);
  return out;
}

export function unpad(padded: Uint8Array): Bytes {
  if (padded.length < 4) throw new PoolseCryptoError('malformed', 'Padding is invalid');
  const length = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint32(0);
  if (4 + length > padded.length) throw new PoolseCryptoError('malformed', 'Padding is invalid');
  for (let i = 4 + length; i < padded.length; i++) {
    if (padded[i] !== 0) throw new PoolseCryptoError('malformed', 'Padding is invalid');
  }
  return new Uint8Array(padded.subarray(4, 4 + length));
}

export function prefixed(prefix: Uint8Array, ad: Uint8Array): Bytes {
  return concat(prefix, ad);
}
