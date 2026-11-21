/**
 * Item content (kind 1):
 *
 *   header(4) | keyVersion u32 | keyCheck(16) | iv(12) | ct
 *
 * The plaintext is Padmé-padded before encryption, so the stored size only
 * roughly reflects the note's length. The content key is HKDF(itemKey,
 * "key/item-content"); the AES-GCM associated data is everything before the
 * ciphertext plus the caller's associated data (item id, version, …).
 */
import { type Bytes, ByteReader, ByteWriter, concat, fromUtf8, utf8 } from './bytes';
import { PoolseCryptoError } from './errors';
import {
  Alg,
  type AssociatedData,
  CHECK_LENGTH,
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
import { type ItemKey, secretOf } from './keys';
import { IV_LENGTH, aesDecrypt, aesEncrypt, randomBytes } from './subtle';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** What a note (or any item) holds. Titles are encrypted too. */
export interface ItemContent {
  title: string;
  /** The body as your editor stores it: Markdown text or a document tree. */
  body: JsonValue;
  /** Tags, folder, pinned, checklist state… anything the server mustn't read. */
  metadata?: { [key: string]: JsonValue };
}

/**
 * The associated data for an item. `itemId` is required; add `version` for
 * version history (NT8) so one version can't be served as another, and
 * anything else that identifies the slot the ciphertext belongs in.
 */
export type ItemAssociatedData = AssociatedData & { readonly itemId: string };

async function seal(
  key: ItemKey,
  type: string,
  plaintext: Uint8Array,
  ad: ItemAssociatedData,
): Promise<Bytes> {
  requireItemId(ad);
  const raw = secretOf(key);
  const iv = randomBytes(IV_LENGTH);
  const prefix = writeHeader(new ByteWriter(), Kind.Item, Alg.Aes256GcmHkdfSha256)
    .u32(key.version)
    .bytes(await keyCheck(raw, 'item'))
    .bytes(iv)
    .finish();
  const aad = concat(prefix, encodeAssociatedData('item', ad, { '@type': type }));
  const ct = await aesEncrypt(await deriveAesKey(raw, 'item-content'), iv, pad(plaintext), aad);
  return concat(prefix, ct);
}

async function open(
  key: ItemKey,
  type: string,
  envelope: Uint8Array,
  ad: ItemAssociatedData,
): Promise<Bytes> {
  requireItemId(ad);
  const r = new ByteReader(envelope);
  readHeader(r, Kind.Item, [Alg.Aes256GcmHkdfSha256]);
  const keyVersion = r.u32();
  const check = r.bytes(CHECK_LENGTH);
  const iv = r.bytes(IV_LENGTH);
  const prefix = r.consumed();
  const ct = r.rest();
  if (keyVersion !== key.version) {
    throw new PoolseCryptoError(
      'wrong-key',
      `This was encrypted with key version ${keyVersion}, not ${key.version}`,
    );
  }
  const raw = secretOf(key);
  await verifyKeyCheck(raw, 'item', check);
  const aad = concat(prefix, encodeAssociatedData('item', ad, { '@type': type }));
  return unpad(await aesDecrypt(await deriveAesKey(raw, 'item-content'), iv, ct, aad));
}

function requireItemId(ad: ItemAssociatedData): void {
  if (typeof ad.itemId !== 'string' || ad.itemId.length === 0) {
    throw new PoolseCryptoError('malformed', 'Associated data needs an itemId');
  }
}

/** Encrypt a note's title, body and metadata as one envelope. */
export async function encryptItem(
  key: ItemKey,
  content: ItemContent,
  ad: ItemAssociatedData,
): Promise<Uint8Array> {
  if (typeof content.title !== 'string')
    throw new PoolseCryptoError('malformed', 'title must be a string');
  return seal(key, 'item', utf8(JSON.stringify(content)), ad);
}

export async function decryptItem(
  key: ItemKey,
  envelope: Uint8Array,
  ad: ItemAssociatedData,
): Promise<ItemContent> {
  const text = fromUtf8(await open(key, 'item', envelope, ad));
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PoolseCryptoError('malformed', 'Decrypted item is not JSON');
  }
  if (!value || typeof value !== 'object' || typeof (value as ItemContent).title !== 'string') {
    throw new PoolseCryptoError('malformed', 'Decrypted item has no title');
  }
  return value as ItemContent;
}

/** Encrypt arbitrary small bytes with an item key (e.g. an encrypted folder name). */
export async function encryptBytes(
  key: ItemKey,
  plaintext: Uint8Array,
  ad: ItemAssociatedData,
): Promise<Uint8Array> {
  return seal(key, 'bytes', plaintext, ad);
}

export async function decryptBytes(
  key: ItemKey,
  envelope: Uint8Array,
  ad: ItemAssociatedData,
): Promise<Uint8Array> {
  return open(key, 'bytes', envelope, ad);
}
