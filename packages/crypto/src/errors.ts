/**
 * Why an operation was refused. Decryption errors are deliberately coarse:
 * `tampered` covers a modified ciphertext, a wrong associated-data value and
 * a forged tag alike, because telling them apart would help an attacker.
 *
 * - `malformed` — not something this library wrote (bad length, encoding,
 *   trailing bytes, truncated stream).
 * - `unsupported` — written by a newer format version or with an algorithm
 *   this build doesn't know. Update the library rather than retrying.
 * - `wrong-key` — the key's check value doesn't match: a different key (or a
 *   different key version) was used to encrypt this.
 * - `tampered` — authentication failed: the data, or the associated data it
 *   was bound to (item id, version…), isn't what was encrypted.
 * - `bad-signature` — a signature is invalid, or the signer isn't one the
 *   caller said to trust.
 * - `expired` — a device approval request is too old (or from the future).
 * - `checksum` — a recovery key was mistyped.
 * - `rollback` — the blob store returned an older revision than this device
 *   has already seen.
 * - `unavailable` — WebCrypto (or an algorithm it needs) is missing.
 */
export type PoolseCryptoErrorCode =
  | 'malformed'
  | 'unsupported'
  | 'wrong-key'
  | 'tampered'
  | 'bad-signature'
  | 'expired'
  | 'checksum'
  | 'rollback'
  | 'unavailable';

export class PoolseCryptoError extends Error {
  override readonly name = 'PoolseCryptoError';

  constructor(
    readonly code: PoolseCryptoErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The blob changed on the server since it was read (`If-Match` failed, or a
 * create found the key already taken). Read it again, merge, and retry.
 */
export class BlobConflictError extends Error {
  override readonly name = 'BlobConflictError';

  constructor(
    readonly key: string,
    /** The server's current version, when the transport knows it. */
    readonly currentVersion: string | null = null,
  ) {
    super(`Blob "${key}" was changed by another device`);
  }
}
