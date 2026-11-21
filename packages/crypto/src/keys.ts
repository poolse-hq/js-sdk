/**
 * Key types.
 *
 *   DeviceKeys   one per device, made on it and never sent anywhere: a P-256
 *                ECDH pair (others wrap keys to it) and a P-256 ECDSA pair
 *                (it signs what it wraps and approves). The app keeps the
 *                exported bytes in the OS keychain / Keystore.
 *   AccountKey   the user's "notes key": 256 random bits, wrapped for each of
 *                their devices and for their recovery key. Item keys are
 *                wrapped under it, and ST6 sync derives its keys from it.
 *   ItemKey      one per note (or other item), 256 random bits with a
 *                version number that goes up on every rotation.
 *
 * Secret bytes are held in module-private WeakMaps rather than properties,
 * so they don't show up in logs, `JSON.stringify` or devtools previews.
 */
import {
  type Bytes,
  ByteReader,
  ByteWriter,
  constantTimeEqual,
  fromBase64Url,
  toBase32,
  toBase64Url,
  toBytes,
} from './bytes';
import { PoolseCryptoError } from './errors';
import {
  Alg,
  CHECK_LENGTH,
  DOMAIN,
  Kind,
  deriveAesKey,
  keyCheck,
  keyId,
  readHeader,
  verifyKeyCheck,
  writeHeader,
} from './format';
import {
  IV_LENGTH,
  P256_PUBLIC_LENGTH,
  P256_SCALAR_LENGTH,
  aesDecrypt,
  aesEncrypt,
  exportP256Private,
  exportP256Public,
  generateP256,
  importP256Private,
  importP256Public,
  label,
  randomBytes,
  sha256,
} from './subtle';

const secrets = new WeakMap<object, Bytes>();

/** @internal The raw bytes of an AccountKey, ItemKey or RecoveryKey. */
export function secretOf(key: object): Bytes {
  const raw = secrets.get(key);
  if (!raw) throw new PoolseCryptoError('malformed', 'Not a key created by @poolse/crypto');
  return raw;
}

/** @internal */
export function setSecret(key: object, raw: Bytes): void {
  secrets.set(key, raw);
}

const SYMMETRIC_LENGTH = 32;

function checkLength(bytes: Uint8Array): Bytes {
  if (bytes.length !== SYMMETRIC_LENGTH) {
    throw new PoolseCryptoError('malformed', `Expected a ${SYMMETRIC_LENGTH}-byte key`);
  }
  return toBytes(bytes);
}

// ---------------------------------------------------------------------------
// AccountKey

export class AccountKey {
  /** Public identifier (base64url) — safe to store next to wraps of this key. */
  readonly id: string;

  private constructor(raw: Bytes, id: string) {
    this.id = id;
    setSecret(this, raw);
  }

  static async generate(): Promise<AccountKey> {
    return AccountKey.fromBytes(randomBytes(SYMMETRIC_LENGTH));
  }

  /**
   * From raw bytes, e.g. a copy the app cached in the keychain. Prefer
   * keeping only the device-wrapped copy and unwrapping it at start.
   */
  static async fromBytes(bytes: Uint8Array): Promise<AccountKey> {
    const raw = checkLength(bytes);
    return new AccountKey(raw, toBase64Url(await keyId(raw, 'account')));
  }

  /** A copy of the 32 secret bytes. Handle with care. */
  toBytes(): Uint8Array {
    return toBytes(secretOf(this));
  }

  toJSON(): { id: string } {
    return { id: this.id };
  }
}

// ---------------------------------------------------------------------------
// ItemKey

export class ItemKey {
  /** Starts at 1 and goes up by one on every `rotateItemKey`. */
  readonly version: number;

  private constructor(raw: Bytes, version: number) {
    this.version = version;
    setSecret(this, raw);
  }

  static generate(version = 1): ItemKey {
    return ItemKey.fromBytes(randomBytes(SYMMETRIC_LENGTH), version);
  }

  static fromBytes(bytes: Uint8Array, version: number): ItemKey {
    if (!Number.isInteger(version) || version < 1 || version > 0xffffffff) {
      throw new PoolseCryptoError('malformed', 'Item key version must be an integer from 1');
    }
    return new ItemKey(checkLength(bytes), version);
  }

  /** A copy of the 32 secret bytes. Handle with care. */
  toBytes(): Uint8Array {
    return toBytes(secretOf(this));
  }

  toJSON(): { version: number } {
    return { version: this.version };
  }
}

/**
 * A fresh key with the next version number. Use it when a share is revoked
 * (or expires): re-encrypt the item with the new key and wrap it again for
 * the people who still have access. The removed person keeps whatever they
 * already decrypted; they just can't read anything written from now on.
 */
export function rotateItemKey(previous: ItemKey): ItemKey {
  return ItemKey.generate(previous.version + 1);
}

// ---------------------------------------------------------------------------
// Device keys

/** What other devices and the server's directory know about a device. */
export interface DevicePublicKeys {
  /** 16-byte id (base64url) derived from both public keys. */
  readonly id: string;
  /** ECDH P-256 public key, uncompressed (65 bytes). */
  readonly encryption: Uint8Array;
  /** ECDSA P-256 public key, uncompressed (65 bytes). */
  readonly signing: Uint8Array;
}

async function deviceIdBytes(encryption: Uint8Array, signing: Uint8Array): Promise<Bytes> {
  return (await sha256(label(DOMAIN, 'device-id', encryption, signing))).slice(0, 16);
}

/** Build (and validate) a DevicePublicKeys from its two raw public keys. */
export async function devicePublicKeys(
  encryption: Uint8Array,
  signing: Uint8Array,
): Promise<DevicePublicKeys> {
  await importP256Public('ecdh', encryption);
  await importP256Public('ecdsa', signing);
  return {
    id: toBase64Url(await deviceIdBytes(encryption, signing)),
    encryption: toBytes(encryption),
    signing: toBytes(signing),
  };
}

/** Serialise a device's public keys for the Workspace API's key directory. */
export function encodeDevicePublicKeys(keys: DevicePublicKeys): string {
  const w = writeHeader(new ByteWriter(), Kind.DevicePublicKeys, Alg.P256);
  return toBase64Url(w.bytes(keys.encryption).bytes(keys.signing).finish());
}

export async function decodeDevicePublicKeys(text: string): Promise<DevicePublicKeys> {
  const r = new ByteReader(fromBase64Url(text));
  readHeader(r, Kind.DevicePublicKeys, [Alg.P256]);
  const encryption = r.bytes(P256_PUBLIC_LENGTH);
  const signing = r.bytes(P256_PUBLIC_LENGTH);
  r.end();
  return devicePublicKeys(encryption, signing);
}

/** True when both describe the same device (compares the keys themselves). */
export function sameDevice(a: DevicePublicKeys, b: DevicePublicKeys): boolean {
  return constantTimeEqual(a.encryption, b.encryption) && constantTimeEqual(a.signing, b.signing);
}

/**
 * A short code people can compare on two screens: 32 base32 characters
 * (160 bits of SHA-256) in groups of four.
 */
export async function deviceFingerprint(keys: DevicePublicKeys): Promise<string> {
  const digest = await sha256(label(DOMAIN, 'fingerprint', keys.encryption, keys.signing));
  return (toBase32(digest.slice(0, 20)).match(/.{4}/g) ?? []).join(' ');
}

const privateParts = new WeakMap<
  DeviceKeys,
  { encryption: CryptoKey; signing: CryptoKey; extractable: boolean }
>();

/** @internal */
export function devicePrivate(device: DeviceKeys): { encryption: CryptoKey; signing: CryptoKey } {
  const parts = privateParts.get(device);
  if (!parts) throw new PoolseCryptoError('malformed', 'Not device keys created by @poolse/crypto');
  return parts;
}

export interface ExportDeviceKeysOptions {
  /**
   * 32 bytes to encrypt the export with (AES-256-GCM), e.g. a key the OS
   * keeps in the Secure Enclave or a random value in a second keychain item.
   * Without it the export is plain bytes and relies on the keychain alone.
   */
  wrappingKey?: Uint8Array;
}

export interface ImportDeviceKeysOptions extends ExportDeviceKeysOptions {
  /** Allow `export()` on the imported keys. Default `false`. */
  extractable?: boolean;
}

export class DeviceKeys {
  readonly publicKeys: DevicePublicKeys;

  private constructor(
    publicKeys: DevicePublicKeys,
    encryption: CryptoKey,
    signing: CryptoKey,
    extractable: boolean,
  ) {
    this.publicKeys = publicKeys;
    privateParts.set(this, { encryption, signing, extractable });
  }

  get id(): string {
    return this.publicKeys.id;
  }

  /**
   * New key pairs for this device. They are extractable so the app can
   * `export()` them once into the keychain; later loads with `import()` are
   * non-extractable by default.
   */
  static async generate(): Promise<DeviceKeys> {
    const enc = await generateP256('ecdh');
    const sig = await generateP256('ecdsa');
    const publicKeys = await devicePublicKeys(
      await exportP256Public(enc.publicKey),
      await exportP256Public(sig.publicKey),
    );
    return new DeviceKeys(publicKeys, enc.privateKey, sig.privateKey, true);
  }

  /** Bytes for the OS keychain. Only works on keys from `generate()` or an extractable import. */
  async export(options: ExportDeviceKeysOptions = {}): Promise<Uint8Array> {
    const parts = privateParts.get(this)!;
    if (!parts.extractable) {
      throw new PoolseCryptoError(
        'malformed',
        'These device keys were imported as non-extractable',
      );
    }
    const body = new ByteWriter()
      .bytes(this.publicKeys.encryption)
      .bytes(await exportP256Private(parts.encryption))
      .bytes(this.publicKeys.signing)
      .bytes(await exportP256Private(parts.signing))
      .finish();
    if (!options.wrappingKey) {
      const w = writeHeader(new ByteWriter(), Kind.DeviceSecret, Alg.None);
      // A checksum so a corrupted keychain entry fails clearly on import.
      return w
        .bytes(body)
        .bytes((await sha256(body)).slice(0, 16))
        .finish();
    }
    const wrappingKey = checkLength(options.wrappingKey);
    const iv = randomBytes(IV_LENGTH);
    const prefix = writeHeader(new ByteWriter(), Kind.DeviceSecret, Alg.Aes256GcmHkdfSha256)
      .bytes(await keyCheck(wrappingKey, 'device-secret'))
      .bytes(iv)
      .finish();
    const key = await deriveAesKey(wrappingKey, 'device-secret');
    return new ByteWriter()
      .bytes(prefix)
      .bytes(await aesEncrypt(key, iv, body, prefix))
      .finish();
  }

  static async import(
    bytes: Uint8Array,
    options: ImportDeviceKeysOptions = {},
  ): Promise<DeviceKeys> {
    const r = new ByteReader(bytes);
    const alg = readHeader(r, Kind.DeviceSecret, [Alg.None, Alg.Aes256GcmHkdfSha256]);
    const bodyLength = 2 * (P256_PUBLIC_LENGTH + P256_SCALAR_LENGTH);
    let body: Bytes;
    if (alg === Alg.None) {
      if (options.wrappingKey) {
        throw new PoolseCryptoError(
          'malformed',
          'These device keys were exported without a wrapping key',
        );
      }
      body = r.bytes(bodyLength);
      const checksum = r.bytes(16);
      r.end();
      if (!constantTimeEqual((await sha256(body)).slice(0, 16), checksum)) {
        throw new PoolseCryptoError('tampered', 'Device key export is corrupted');
      }
    } else {
      if (!options.wrappingKey) {
        throw new PoolseCryptoError('wrong-key', 'These device keys need their wrapping key');
      }
      const wrappingKey = checkLength(options.wrappingKey);
      await verifyKeyCheck(wrappingKey, 'device-secret', r.bytes(CHECK_LENGTH));
      const iv = r.bytes(IV_LENGTH);
      const prefix = r.consumed();
      const ct = r.rest();
      body = await aesDecrypt(await deriveAesKey(wrappingKey, 'device-secret'), iv, ct, prefix);
      if (body.length !== bodyLength)
        throw new PoolseCryptoError('malformed', 'Device key export is invalid');
    }
    const b = new ByteReader(body);
    const encPublic = b.bytes(P256_PUBLIC_LENGTH);
    const encPrivate = b.bytes(P256_SCALAR_LENGTH);
    const sigPublic = b.bytes(P256_PUBLIC_LENGTH);
    const sigPrivate = b.bytes(P256_SCALAR_LENGTH);
    const extractable = options.extractable ?? false;
    return new DeviceKeys(
      await devicePublicKeys(encPublic, sigPublic),
      await importP256Private('ecdh', encPrivate, encPublic, extractable),
      await importP256Private('ecdsa', sigPrivate, sigPublic, extractable),
      extractable,
    );
  }

  toJSON(): { id: string } {
    return { id: this.id };
  }
}

/** @internal Device id as raw bytes. */
export function deviceIdRaw(keys: DevicePublicKeys): Bytes {
  return fromBase64Url(keys.id);
}
