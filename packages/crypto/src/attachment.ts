/**
 * Encrypted attachments, streamed in chunks so a large file never has to be
 * in memory at once (kind 4).
 *
 *   header(4) | keyVersion u32 | keyCheck(16) | salt(32) | chunkSize u32
 *   chunk 0 | chunk 1 | … | final chunk
 *
 * Each file gets its own key, HKDF(itemKey, salt, "key/attachment"), with a
 * fresh random salt, so the chunk nonces can be a counter: 3 zero bytes,
 * the chunk index (u64) and a final-chunk flag (the STREAM construction of
 * Hoang, Reyhanitabar, Rogaway and Vizár). Every chunk but the last holds
 * exactly `chunkSize` plaintext bytes; the last holds 0…chunkSize. Reordered,
 * dropped, duplicated or appended chunks and a stream cut at a chunk
 * boundary all fail to decrypt.
 *
 * Streaming decryption hands out each chunk once it is authenticated, but
 * only reaching the end proves the file is complete — don't act on partial
 * output until the iteration finishes without throwing.
 */
import { type Bytes, ByteReader, ByteWriter, concat } from './bytes';
import { PoolseCryptoError } from './errors';
import {
  Alg,
  CHECK_LENGTH,
  HEADER_LENGTH,
  Kind,
  deriveAesKey,
  encodeAssociatedData,
  keyCheck,
  readHeader,
  verifyKeyCheck,
  writeHeader,
} from './format';
import type { ItemAssociatedData } from './item';
import { type ItemKey, secretOf } from './keys';
import { TAG_LENGTH, aesDecrypt, aesEncrypt, randomBytes } from './subtle';

export const DEFAULT_CHUNK_SIZE = 64 * 1024;
export const MIN_CHUNK_SIZE = 16;
export const MAX_CHUNK_SIZE = 16 * 1024 * 1024;

const SALT_LENGTH = 32;
export const ATTACHMENT_HEADER_LENGTH = HEADER_LENGTH + 4 + CHECK_LENGTH + SALT_LENGTH + 4;

/** Anything a file's bytes can come from. */
export type ByteSource =
  | Uint8Array
  | Blob
  | ReadableStream<Uint8Array>
  | AsyncIterable<Uint8Array>
  | Iterable<Uint8Array>;

/** Associated data for an attachment: the item plus the attachment's own id. */
export type AttachmentAssociatedData = ItemAssociatedData & { readonly attachmentId: string };

export interface EncryptAttachmentOptions {
  /** Plaintext bytes per chunk. Default 64 KiB; 16 bytes to 16 MiB. */
  chunkSize?: number;
}

function nonce(index: number, final: boolean): Bytes {
  const n = new Uint8Array(12);
  new DataView(n.buffer).setBigUint64(3, BigInt(index));
  n[11] = final ? 1 : 0;
  return n;
}

async function* iterate(source: ByteSource): AsyncGenerator<Uint8Array> {
  if (source instanceof Uint8Array) {
    yield source;
    return;
  }
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    if (typeof source.stream === 'function') {
      yield* iterate(source.stream() as ReadableStream<Uint8Array>);
    } else {
      yield new Uint8Array(await source.arrayBuffer());
    }
    return;
  }
  if (typeof (source as ReadableStream<Uint8Array>).getReader === 'function') {
    const reader = (source as ReadableStream<Uint8Array>).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }
  yield* source as AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
}

/** Re-slices an input stream into fixed-size pieces, one piece of lookahead. */
class Chunker {
  private parts: Uint8Array[] = [];
  private length = 0;

  push(part: Uint8Array): void {
    if (part.length === 0) return;
    this.parts.push(part);
    this.length += part.length;
  }

  get buffered(): number {
    return this.length;
  }

  take(n: number): Bytes {
    const out = new Uint8Array(n);
    let offset = 0;
    while (offset < n) {
      const head = this.parts[0]!;
      const need = n - offset;
      if (head.length <= need) {
        out.set(head, offset);
        offset += head.length;
        this.parts.shift();
      } else {
        out.set(head.subarray(0, need), offset);
        this.parts[0] = head.subarray(need);
        offset += need;
      }
    }
    this.length -= n;
    return out;
  }

  takeAll(): Bytes {
    return this.take(this.length);
  }
}

function checkChunkSize(size: number): void {
  if (!Number.isInteger(size) || size < MIN_CHUNK_SIZE || size > MAX_CHUNK_SIZE) {
    throw new PoolseCryptoError(
      'malformed',
      `Chunk size must be ${MIN_CHUNK_SIZE}…${MAX_CHUNK_SIZE} bytes`,
    );
  }
}

function requireIds(ad: AttachmentAssociatedData): void {
  if (!ad.itemId || !ad.attachmentId) {
    throw new PoolseCryptoError('malformed', 'Associated data needs itemId and attachmentId');
  }
}

/**
 * Encrypt a file as a stream of pieces: the header first, then one piece per
 * chunk. Concatenate them for upload (see `encryptedAttachmentSize` for the
 * total length up front).
 */
export async function* encryptAttachment(
  key: ItemKey,
  source: ByteSource,
  ad: AttachmentAssociatedData,
  options: EncryptAttachmentOptions = {},
): AsyncGenerator<Uint8Array> {
  requireIds(ad);
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  checkChunkSize(chunkSize);
  const raw = secretOf(key);
  const salt = randomBytes(SALT_LENGTH);
  const header = writeHeader(new ByteWriter(), Kind.Attachment, Alg.Aes256GcmHkdfSha256)
    .u32(key.version)
    .bytes(await keyCheck(raw, 'attachment'))
    .bytes(salt)
    .u32(chunkSize)
    .finish();
  const fileKey = await deriveAesKey(raw, 'attachment', salt);
  const aad = concat(header, encodeAssociatedData('attachment', ad));
  yield header;

  const chunker = new Chunker();
  let index = 0;
  for await (const part of iterate(source)) {
    chunker.push(part);
    // Keep at least one byte back: only the end of input says which chunk is final.
    while (chunker.buffered > chunkSize) {
      yield await aesEncrypt(fileKey, nonce(index++, false), chunker.take(chunkSize), aad);
    }
  }
  yield await aesEncrypt(fileKey, nonce(index, true), chunker.takeAll(), aad);
}

/** Decrypt a stream produced by `encryptAttachment`, chunk by chunk. */
export async function* decryptAttachment(
  key: ItemKey,
  source: ByteSource,
  ad: AttachmentAssociatedData,
): AsyncGenerator<Uint8Array> {
  requireIds(ad);
  const input = new Chunker();
  const it = iterate(source)[Symbol.asyncIterator]();
  let ended = false;
  const fill = async (n: number): Promise<void> => {
    while (!ended && input.buffered < n) {
      const next = await it.next();
      if (next.done) ended = true;
      else input.push(next.value);
    }
  };

  await fill(ATTACHMENT_HEADER_LENGTH);
  if (input.buffered < ATTACHMENT_HEADER_LENGTH) {
    throw new PoolseCryptoError('malformed', 'Attachment is truncated');
  }
  const header = input.take(ATTACHMENT_HEADER_LENGTH);
  const r = new ByteReader(header);
  readHeader(r, Kind.Attachment, [Alg.Aes256GcmHkdfSha256]);
  const keyVersion = r.u32();
  const check = r.bytes(CHECK_LENGTH);
  const salt = r.bytes(SALT_LENGTH);
  const chunkSize = r.u32();
  checkChunkSize(chunkSize);
  if (keyVersion !== key.version) {
    throw new PoolseCryptoError(
      'wrong-key',
      `This was encrypted with key version ${keyVersion}, not ${key.version}`,
    );
  }
  const raw = secretOf(key);
  await verifyKeyCheck(raw, 'attachment', check);
  const fileKey = await deriveAesKey(raw, 'attachment', salt);
  const aad = concat(header, encodeAssociatedData('attachment', ad));

  const sealed = chunkSize + TAG_LENGTH;
  let index = 0;
  for (;;) {
    // One byte past a full chunk tells us whether more follows.
    await fill(sealed + 1);
    if (input.buffered > sealed) {
      yield await aesDecrypt(fileKey, nonce(index++, false), input.take(sealed), aad);
      continue;
    }
    if (input.buffered < TAG_LENGTH)
      throw new PoolseCryptoError('malformed', 'Attachment is truncated');
    yield await aesDecrypt(fileKey, nonce(index, true), input.takeAll(), aad);
    return;
  }
}

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const part of stream) parts.push(part);
  return concat(...parts);
}

/** `encryptAttachment` into one byte array, for files that fit in memory. */
export async function encryptAttachmentBytes(
  key: ItemKey,
  source: ByteSource,
  ad: AttachmentAssociatedData,
  options: EncryptAttachmentOptions = {},
): Promise<Uint8Array> {
  return collect(encryptAttachment(key, source, ad, options));
}

/** `decryptAttachment` into one byte array. */
export async function decryptAttachmentBytes(
  key: ItemKey,
  source: ByteSource,
  ad: AttachmentAssociatedData,
): Promise<Uint8Array> {
  return collect(decryptAttachment(key, source, ad));
}

/** The encrypted size of a `plainSize`-byte file — for Content-Length. */
export function encryptedAttachmentSize(plainSize: number, chunkSize = DEFAULT_CHUNK_SIZE): number {
  checkChunkSize(chunkSize);
  const chunks = Math.max(1, Math.ceil(plainSize / chunkSize));
  return ATTACHMENT_HEADER_LENGTH + plainSize + chunks * TAG_LENGTH;
}
