/**
 * Recovery key: 128 random bits shown to the user once, so they can restore
 * their account key when every device is gone.
 *
 * It is a random secret, not a password, so no password KDF is needed: 2^128
 * guesses is out of reach whatever the hashing cost. HKDF turns it into the
 * wrapping key.
 *
 * Display form: the 16 secret bytes plus a 4-byte checksum (the first bytes
 * of SHA-256 over a versioned label and the secret), 160 bits in Crockford
 * base32 — 32 characters in eight groups of four:
 *
 *   7K2M-9QXD-4HB0-RT6W-…
 *
 * Parsing ignores case, spaces and hyphens and reads O as 0 and I/L as 1;
 * the checksum catches typos (a mistyped key fails with `checksum`, not by
 * silently deriving a different key).
 */
import {
  type Bytes,
  concat,
  constantTimeEqual,
  fromBase32,
  toBase32,
  toBase64Url,
  toBytes,
} from './bytes';
import { PoolseCryptoError } from './errors';
import { DOMAIN, keyId } from './format';
import { AccountKey, secretOf, setSecret } from './keys';
import { label, randomBytes, sha256 } from './subtle';
import { type AccountContext, WrapPurpose, unwrapSymmetric, wrapSymmetric } from './wrap';

const SECRET_LENGTH = 16;
const CHECKSUM_LENGTH = 4;
const DISPLAY_LENGTH = 32;

async function checksum(secret: Uint8Array): Promise<Bytes> {
  return (await sha256(label(DOMAIN, 'recovery-checksum', secret))).slice(0, CHECKSUM_LENGTH);
}

export class RecoveryKey {
  /** Public identifier (base64url): which recovery key a wrap belongs to. */
  readonly id: string;
  readonly #display: string;

  private constructor(raw: Bytes, id: string, display: string) {
    this.id = id;
    this.#display = display;
    setSecret(this, raw);
  }

  /** @internal */
  static async create(raw: Bytes): Promise<RecoveryKey> {
    const encoded = toBase32(concat(raw, await checksum(raw)));
    const display = (encoded.match(/.{4}/g) ?? []).join('-');
    return new RecoveryKey(raw, toBase64Url(await keyId(raw, 'recovery')), display);
  }

  /** The key as the user writes it down. Show it once; never log it. */
  toDisplayString(): string {
    return this.#display;
  }

  /** Deliberately not the secret, so string interpolation can't leak it. */
  toString(): string {
    return `RecoveryKey(${this.id})`;
  }

  toJSON(): { id: string } {
    return { id: this.id };
  }
}

export async function generateRecoveryKey(): Promise<RecoveryKey> {
  return RecoveryKey.create(randomBytes(SECRET_LENGTH));
}

/** Read a recovery key the user typed or pasted. */
export async function parseRecoveryKey(text: string): Promise<RecoveryKey> {
  const clean = text.toUpperCase().replace(/[\s-]/g, '');
  if (clean.length !== DISPLAY_LENGTH) {
    throw new PoolseCryptoError('malformed', `A recovery key has ${DISPLAY_LENGTH} characters`);
  }
  const bytes = fromBase32(clean);
  const raw = toBytes(bytes.subarray(0, SECRET_LENGTH));
  if (!constantTimeEqual(await checksum(raw), bytes.subarray(SECRET_LENGTH))) {
    throw new PoolseCryptoError('checksum', 'This recovery key has a typo');
  }
  return RecoveryKey.create(raw);
}

/** Wrap the account key under the recovery key; store the result on the server. */
export async function wrapAccountKeyWithRecoveryKey(
  accountKey: AccountKey,
  recoveryKey: RecoveryKey,
  options: AccountContext,
): Promise<Uint8Array> {
  return wrapSymmetric(
    secretOf(recoveryKey),
    WrapPurpose.AccountKeyRecovery,
    secretOf(accountKey),
    0,
    { accountId: options.accountId },
  );
}

export async function unwrapAccountKeyWithRecoveryKey(
  wrap: Uint8Array,
  recoveryKey: RecoveryKey,
  options: AccountContext,
): Promise<AccountKey> {
  const { key } = await unwrapSymmetric(
    secretOf(recoveryKey),
    WrapPurpose.AccountKeyRecovery,
    wrap,
    { accountId: options.accountId },
  );
  return AccountKey.fromBytes(key);
}
