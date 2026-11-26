/**
 * Key wrapping.
 *
 * Symmetric wrap (kind 2) — a key encrypted under another secret key:
 *
 *   header(4) | purpose u8 | keyVersion u32 | kekCheck(16) | iv(12) | u16 len | ct
 *
 * Public-key wrap (kind 3) — a key encrypted to a device's ECDH public key
 * (ECIES: a fresh ephemeral P-256 key per wrap, HKDF over the shared secret
 * with both public keys as salt, AES-256-GCM), optionally signed by the
 * sending device:
 *
 *   header(4) | purpose u8 | flags u8 | keyVersion u32 | recipientId(16) |
 *   ephemeralPublic(65) | [signerPublic(65) if signed] | iv(12) |
 *   u16 len | ct | [signature(64) if signed]
 *
 * In both, everything before the ciphertext is AES-GCM associated data
 * together with the caller's associated data (account id, item id), and the
 * signature covers the whole wrap plus that associated data.
 */
import { type Bytes, ByteReader, ByteWriter, concat, constantTimeEqual } from './bytes';
import { PoolseCryptoError } from './errors';
import {
  Alg,
  type AssociatedData,
  CHECK_LENGTH,
  DOMAIN,
  Kind,
  deriveAesKey,
  encodeAssociatedData,
  keyCheck,
  readHeader,
  verifyKeyCheck,
  writeHeader,
} from './format';
import {
  AccountKey,
  type DeviceKeys,
  type DevicePublicKeys,
  ItemKey,
  deviceIdRaw,
  devicePrivate,
  secretOf,
} from './keys';
import {
  ECDSA_SIGNATURE_LENGTH,
  IV_LENGTH,
  P256_PUBLIC_LENGTH,
  aesDecrypt,
  aesEncrypt,
  aesKey,
  ecdh,
  ecdsaSign,
  ecdsaVerify,
  exportP256Public,
  generateP256,
  hkdf,
  importP256Public,
  label,
  randomBytes,
} from './subtle';

/** What a wrapped key is for. Part of the format: never renumber. */
export const WrapPurpose = {
  /** The account key, under a recovery key. */
  AccountKeyRecovery: 1,
  /** An item key, under the account key. */
  ItemKey: 2,
  /** An older item key, under its successor (so history stays readable). */
  PreviousItemKey: 3,
  /** The account key, to one of the user's devices. */
  AccountKeyDevice: 4,
  /** An item key, to a recipient's device (sharing). */
  ItemKeyShare: 5,
} as const;
export type WrapPurposeId = (typeof WrapPurpose)[keyof typeof WrapPurpose];

const PURPOSE_NAMES: Record<number, string> = {
  1: 'account-key-recovery',
  2: 'item-key',
  3: 'previous-item-key',
  4: 'account-key-device',
  5: 'item-key-share',
};

const FLAG_SIGNED = 0x01;

function purposeName(purpose: number): string {
  const name = PURPOSE_NAMES[purpose];
  if (!name) throw new PoolseCryptoError('unsupported', `Unknown key-wrap purpose ${purpose}`);
  return name;
}

// ---------------------------------------------------------------------------
// Symmetric wrap

/** @internal */
export async function wrapSymmetric(
  kek: Uint8Array,
  purpose: WrapPurposeId,
  key: Uint8Array,
  keyVersion: number,
  ad: AssociatedData,
): Promise<Bytes> {
  const name = purposeName(purpose);
  const iv = randomBytes(IV_LENGTH);
  const prefix = writeHeader(new ByteWriter(), Kind.KeyWrap, Alg.Aes256GcmHkdfSha256)
    .u8(purpose)
    .u32(keyVersion)
    .bytes(await keyCheck(kek, `kek/${name}`))
    .bytes(iv)
    .finish();
  const aad = concat(
    prefix,
    encodeAssociatedData(`wrap/${name}`, ad, { '@keyVersion': keyVersion }),
  );
  const ct = await aesEncrypt(await deriveAesKey(kek, `kek/${name}`), iv, key, aad);
  return new ByteWriter().bytes(prefix).bytes16(ct).finish();
}

/** @internal */
export async function unwrapSymmetric(
  kek: Uint8Array,
  purpose: WrapPurposeId,
  wrap: Uint8Array,
  ad: AssociatedData,
): Promise<{ key: Bytes; keyVersion: number }> {
  const r = new ByteReader(wrap);
  readHeader(r, Kind.KeyWrap, [Alg.Aes256GcmHkdfSha256]);
  const got = r.u8();
  const name = purposeName(got);
  if (got !== purpose) {
    throw new PoolseCryptoError(
      'malformed',
      `Expected a ${purposeName(purpose)} wrap, got ${name}`,
    );
  }
  const keyVersion = r.u32();
  const check = r.bytes(CHECK_LENGTH);
  const iv = r.bytes(IV_LENGTH);
  const prefix = r.consumed();
  const ct = r.bytes16();
  r.end();
  await verifyKeyCheck(kek, `kek/${name}`, check);
  const aad = concat(
    prefix,
    encodeAssociatedData(`wrap/${name}`, ad, { '@keyVersion': keyVersion }),
  );
  const key = await aesDecrypt(await deriveAesKey(kek, `kek/${name}`), iv, ct, aad);
  return { key, keyVersion };
}

// ---------------------------------------------------------------------------
// Public-key wrap

export interface UnwrapResult<K> {
  key: K;
  /**
   * The signing device, when the caller passed `requireSignatureFrom` (it is
   * one of those). `null` otherwise.
   */
  signer: DevicePublicKeys | null;
  /** The raw signing key the wrap was signed with, or `null` if unsigned. */
  signingKey: Uint8Array | null;
}

async function kekFromShared(
  shared: Uint8Array,
  ephemeral: Uint8Array,
  recipient: Uint8Array,
  name: string,
): Promise<CryptoKey> {
  return aesKey(await hkdf(shared, concat(ephemeral, recipient), label(DOMAIN, 'pubwrap/', name)));
}

function signatureInput(body: Uint8Array, ad: Uint8Array): Bytes {
  return concat(label(DOMAIN, 'sig/pubwrap'), body, ad);
}

/** @internal */
export async function wrapToDevice(
  recipient: DevicePublicKeys,
  purpose: WrapPurposeId,
  key: Uint8Array,
  keyVersion: number,
  ad: AssociatedData,
  signer?: DeviceKeys,
): Promise<Bytes> {
  const name = purposeName(purpose);
  const recipientKey = await importP256Public('ecdh', recipient.encryption);
  const ephemeral = await generateP256('ecdh');
  const ephemeralPublic = await exportP256Public(ephemeral.publicKey);
  const shared = await ecdh(ephemeral.privateKey, recipientKey);
  const iv = randomBytes(IV_LENGTH);
  const w = writeHeader(new ByteWriter(), Kind.PublicKeyWrap, Alg.P256)
    .u8(purpose)
    .u8(signer ? FLAG_SIGNED : 0)
    .u32(keyVersion)
    .bytes(deviceIdRaw(recipient))
    .bytes(ephemeralPublic);
  if (signer) w.bytes(signer.publicKeys.signing);
  const prefix = w.bytes(iv).finish();
  const adBytes = encodeAssociatedData(`wrap/${name}`, ad, { '@keyVersion': keyVersion });
  const kek = await kekFromShared(shared, ephemeralPublic, recipient.encryption, name);
  const ct = await aesEncrypt(kek, iv, key, concat(prefix, adBytes));
  const body = new ByteWriter().bytes(prefix).bytes16(ct).finish();
  if (!signer) return body;
  const signature = await ecdsaSign(devicePrivate(signer).signing, signatureInput(body, adBytes));
  return concat(body, signature);
}

function asList(
  value: DevicePublicKeys | readonly DevicePublicKeys[],
): readonly DevicePublicKeys[] {
  return Array.isArray(value) ? value : [value as DevicePublicKeys];
}

/** @internal */
export async function unwrapFromDevice(
  device: DeviceKeys,
  purpose: WrapPurposeId,
  wrap: Uint8Array,
  ad: AssociatedData,
  requireSignatureFrom?: DevicePublicKeys | readonly DevicePublicKeys[],
): Promise<{
  key: Bytes;
  keyVersion: number;
  signer: DevicePublicKeys | null;
  signingKey: Bytes | null;
}> {
  const r = new ByteReader(wrap);
  readHeader(r, Kind.PublicKeyWrap, [Alg.P256]);
  const got = r.u8();
  const name = purposeName(got);
  if (got !== purpose) {
    throw new PoolseCryptoError(
      'malformed',
      `Expected a ${purposeName(purpose)} wrap, got ${name}`,
    );
  }
  const flags = r.u8();
  if ((flags & ~FLAG_SIGNED) !== 0)
    throw new PoolseCryptoError('unsupported', 'Unknown key-wrap flags');
  const signed = (flags & FLAG_SIGNED) !== 0;
  const keyVersion = r.u32();
  const recipientId = r.bytes(16);
  const ephemeralPublic = r.bytes(P256_PUBLIC_LENGTH);
  const signingKey = signed ? r.bytes(P256_PUBLIC_LENGTH) : null;
  const iv = r.bytes(IV_LENGTH);
  const prefix = r.consumed();
  const ct = r.bytes16();
  const body = r.consumed();
  const signature = signed ? r.bytes(ECDSA_SIGNATURE_LENGTH) : null;
  r.end();

  if (!constantTimeEqual(recipientId, deviceIdRaw(device.publicKeys))) {
    throw new PoolseCryptoError('wrong-key', 'This key was wrapped for a different device');
  }
  const adBytes = encodeAssociatedData(`wrap/${name}`, ad, { '@keyVersion': keyVersion });

  // Check the signature before decrypting, so a forged wrap is reported as
  // such and never reaches AES.
  let signer: DevicePublicKeys | null = null;
  if (signingKey && signature) {
    const verifier = await importP256Public('ecdsa', signingKey);
    if (!(await ecdsaVerify(verifier, signature, signatureInput(body, adBytes)))) {
      throw new PoolseCryptoError('bad-signature', 'The key wrap signature is invalid');
    }
  }
  if (requireSignatureFrom !== undefined) {
    const trusted = asList(requireSignatureFrom);
    signer = (signingKey && trusted.find((t) => constantTimeEqual(t.signing, signingKey))) || null;
    if (!signer) {
      throw new PoolseCryptoError(
        'bad-signature',
        signingKey ? 'The key wrap is signed by an untrusted device' : 'The key wrap is not signed',
      );
    }
  }

  const ephemeralKey = await importP256Public('ecdh', ephemeralPublic);
  const shared = await ecdh(devicePrivate(device).encryption, ephemeralKey);
  const kek = await kekFromShared(shared, ephemeralPublic, device.publicKeys.encryption, name);
  const key = await aesDecrypt(kek, iv, ct, concat(prefix, adBytes));
  return { key, keyVersion, signer, signingKey };
}

// ---------------------------------------------------------------------------
// Public API

export interface AccountContext {
  /** The user's account id — binds the wrap to this account. */
  accountId: string;
}

export interface ItemContext {
  /** The item's stable id — binds the wrap (or ciphertext) to this item. */
  itemId: string;
}

/**
 * Wrap the account key for one of the user's devices. Pass `signer` (the
 * device doing the wrapping) so the recipient can check where it came from.
 */
export async function wrapAccountKeyForDevice(
  accountKey: AccountKey,
  recipient: DevicePublicKeys,
  options: AccountContext & { signer?: DeviceKeys },
): Promise<Uint8Array> {
  return wrapToDevice(
    recipient,
    WrapPurpose.AccountKeyDevice,
    secretOf(accountKey),
    0,
    { accountId: options.accountId },
    options.signer,
  );
}

/**
 * Open a wrap of the account key made for this device.
 *
 * **A wrap fetched from the server proves nothing on its own:** anyone can
 * wrap a key to a device's public key, so a malicious server could hand
 * over a wrap of a key it chose, and every note written afterwards would
 * be under a key the server knows. Pin the account key: keep its `id`
 * (public, safe to store) in the device's secure storage the first time
 * this device holds the key from a source the server can't forge (it
 * made the key, `acceptDeviceGrant` after the QR approval, or the
 * recovery key), and pass it as `expectedAccountKeyId` on every later
 * unwrap of a server-supplied wrap. A wrap that yields another key is
 * then refused with `wrong-key`. `requireSignatureFrom` is the other
 * check, when the app knows which of its own devices made the wrap.
 */
export async function unwrapAccountKeyForDevice(
  wrap: Uint8Array,
  device: DeviceKeys,
  options: AccountContext & {
    /** Refuse the wrap unless it is signed by one of these devices. */
    requireSignatureFrom?: DevicePublicKeys | readonly DevicePublicKeys[];
    /**
     * The pinned `AccountKey.id`: refuse (`wrong-key`) a wrap holding
     * any other key. Strongly recommended for a wrap from the server.
     */
    expectedAccountKeyId?: string;
  },
): Promise<UnwrapResult<AccountKey>> {
  const result = await unwrapFromDevice(
    device,
    WrapPurpose.AccountKeyDevice,
    wrap,
    { accountId: options.accountId },
    options.requireSignatureFrom,
  );
  const key = await AccountKey.fromBytes(result.key);
  checkPinnedAccountKey(key, options.expectedAccountKeyId);
  return {
    key,
    signer: result.signer,
    signingKey: result.signingKey,
  };
}

/**
 * Refuse an account key that isn't the pinned one (`wrong-key`). For
 * code paths that get the key some other way; a no-op when nothing is
 * pinned yet (`undefined` / `null`).
 */
export function checkPinnedAccountKey(
  key: AccountKey,
  expectedId: string | null | undefined,
): void {
  if (expectedId === undefined || expectedId === null) return;
  if (key.id !== expectedId) {
    throw new PoolseCryptoError(
      'wrong-key',
      'This account key is not the one this device has pinned; the wrap may be forged',
    );
  }
}

/** Wrap an item key under the account key — how the owner keeps it. */
export async function wrapItemKey(
  itemKey: ItemKey,
  accountKey: AccountKey,
  options: ItemContext,
): Promise<Uint8Array> {
  return wrapSymmetric(
    secretOf(accountKey),
    WrapPurpose.ItemKey,
    secretOf(itemKey),
    itemKey.version,
    {
      itemId: options.itemId,
    },
  );
}

export async function unwrapItemKey(
  wrap: Uint8Array,
  accountKey: AccountKey,
  options: ItemContext,
): Promise<ItemKey> {
  const { key, keyVersion } = await unwrapSymmetric(
    secretOf(accountKey),
    WrapPurpose.ItemKey,
    wrap,
    {
      itemId: options.itemId,
    },
  );
  return ItemKey.fromBytes(key, keyVersion);
}

/**
 * Share an item: wrap its key to one recipient device, signed by the
 * sharing device. For a person, wrap to each of their devices; for a group,
 * to each member's devices (`shareItemKeyWithDevices`).
 */
export async function shareItemKey(
  itemKey: ItemKey,
  recipient: DevicePublicKeys,
  options: ItemContext & { signer: DeviceKeys },
): Promise<Uint8Array> {
  return wrapToDevice(
    recipient,
    WrapPurpose.ItemKeyShare,
    secretOf(itemKey),
    itemKey.version,
    { itemId: options.itemId },
    options.signer,
  );
}

/** `shareItemKey` for many devices: one wrap per device, keyed by device id. */
export async function shareItemKeyWithDevices(
  itemKey: ItemKey,
  recipients: readonly DevicePublicKeys[],
  options: ItemContext & { signer: DeviceKeys },
): Promise<{ deviceId: string; wrap: Uint8Array }[]> {
  const out: { deviceId: string; wrap: Uint8Array }[] = [];
  for (const recipient of recipients) {
    out.push({ deviceId: recipient.id, wrap: await shareItemKey(itemKey, recipient, options) });
  }
  return out;
}

/**
 * Open a shared item key on the recipient's device. `requireSignatureFrom`
 * is the sharer's devices as the key directory lists them; a wrap signed by
 * anyone else (or unsigned) is refused with `bad-signature`.
 */
export async function openSharedItemKey(
  wrap: Uint8Array,
  device: DeviceKeys,
  options: ItemContext & { requireSignatureFrom: DevicePublicKeys | readonly DevicePublicKeys[] },
): Promise<UnwrapResult<ItemKey>> {
  const result = await unwrapFromDevice(
    device,
    WrapPurpose.ItemKeyShare,
    wrap,
    { itemId: options.itemId },
    options.requireSignatureFrom,
  );
  return {
    key: ItemKey.fromBytes(result.key, result.keyVersion),
    signer: result.signer,
    signingKey: result.signingKey,
  };
}

/**
 * After `rotateItemKey`, wrap the old key under the new one so anyone with
 * the new key can still read the item's older versions (NT8).
 */
export async function wrapPreviousItemKey(
  previous: ItemKey,
  current: ItemKey,
  options: ItemContext,
): Promise<Uint8Array> {
  if (previous.version >= current.version) {
    throw new PoolseCryptoError('malformed', 'The previous key must have a lower version');
  }
  return wrapSymmetric(
    secretOf(current),
    WrapPurpose.PreviousItemKey,
    secretOf(previous),
    previous.version,
    {
      itemId: options.itemId,
      currentVersion: current.version,
    },
  );
}

export async function unwrapPreviousItemKey(
  wrap: Uint8Array,
  current: ItemKey,
  options: ItemContext,
): Promise<ItemKey> {
  const { key, keyVersion } = await unwrapSymmetric(
    secretOf(current),
    WrapPurpose.PreviousItemKey,
    wrap,
    {
      itemId: options.itemId,
      currentVersion: current.version,
    },
  );
  if (keyVersion >= current.version)
    throw new PoolseCryptoError('malformed', 'Invalid previous key version');
  return ItemKey.fromBytes(key, keyVersion);
}
