/**
 * Thin wrappers over WebCrypto. This is the only file that touches
 * `crypto.subtle`; every primitive the library uses is listed here:
 *
 *   AES-256-GCM            content and key wrapping (96-bit IV, 128-bit tag)
 *   HKDF-SHA-256           every derived key, domain-separated by `info`
 *   ECDH P-256             key agreement for wrapping to a public key
 *   ECDSA P-256 / SHA-256  signatures (raw r||s, 64 bytes)
 *   HMAC-SHA-256           device-approval MAC, opaque blob names
 *   SHA-256                key ids and fingerprints
 *   getRandomValues        keys, IVs, salts
 */
import { type Bytes, concat, fromBase64Url, toBase64Url, toBytes, utf8 } from './bytes';
import { PoolseCryptoError } from './errors';

function cryptoObject(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || !c.subtle || typeof c.getRandomValues !== 'function') {
    throw new PoolseCryptoError(
      'unavailable',
      'WebCrypto is not available: globalThis.crypto.subtle is missing. ' +
        'On React Native install a polyfill such as react-native-quick-crypto first.',
    );
  }
  return c;
}

export function subtle(): SubtleCrypto {
  return cryptoObject().subtle;
}

export function randomBytes(length: number): Bytes {
  const out = new Uint8Array(length);
  // getRandomValues is limited to 65536 bytes per call.
  for (let offset = 0; offset < length; offset += 65536) {
    cryptoObject().getRandomValues(out.subarray(offset, Math.min(length, offset + 65536)));
  }
  return out;
}

export async function sha256(data: Uint8Array): Promise<Bytes> {
  return new Uint8Array(await subtle().digest('SHA-256', toBytes(data)));
}

/** HKDF-SHA-256 (RFC 5869): `length` bytes from `ikm`. */
export async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length = 32,
): Promise<Bytes> {
  const base = await subtle().importKey('raw', toBytes(ikm), 'HKDF', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: toBytes(salt), info: toBytes(info) },
    base,
    length * 8,
  );
  return new Uint8Array(bits);
}

// ---------------------------------------------------------------------------
// AES-256-GCM

export const IV_LENGTH = 12;
export const TAG_LENGTH = 16;

export async function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) throw new PoolseCryptoError('malformed', 'AES keys are 32 bytes');
  return subtle().importKey('raw', toBytes(raw), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function aesEncrypt(
  key: CryptoKey,
  iv: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<Bytes> {
  const out = await subtle().encrypt(
    { name: 'AES-GCM', iv: toBytes(iv), additionalData: toBytes(aad), tagLength: 128 },
    key,
    toBytes(plaintext),
  );
  return new Uint8Array(out);
}

/** Throws `PoolseCryptoError('tampered')` when the tag doesn't verify. */
export async function aesDecrypt(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Promise<Bytes> {
  if (ciphertext.length < TAG_LENGTH)
    throw new PoolseCryptoError('malformed', 'Ciphertext is too short');
  try {
    const out = await subtle().decrypt(
      { name: 'AES-GCM', iv: toBytes(iv), additionalData: toBytes(aad), tagLength: 128 },
      key,
      toBytes(ciphertext),
    );
    return new Uint8Array(out);
  } catch {
    throw new PoolseCryptoError(
      'tampered',
      'Decryption failed: the data or its associated data was changed',
    );
  }
}

// ---------------------------------------------------------------------------
// HMAC-SHA-256

async function hmacKey(raw: Uint8Array, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return subtle().importKey('raw', toBytes(raw), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

export async function hmac(key: Uint8Array, data: Uint8Array): Promise<Bytes> {
  return new Uint8Array(await subtle().sign('HMAC', await hmacKey(key, 'sign'), toBytes(data)));
}

/** Constant-time verification (done by WebCrypto). */
export async function hmacVerify(
  key: Uint8Array,
  data: Uint8Array,
  mac: Uint8Array,
): Promise<boolean> {
  return subtle().verify('HMAC', await hmacKey(key, 'verify'), toBytes(mac), toBytes(data));
}

// ---------------------------------------------------------------------------
// P-256 (ECDH and ECDSA)

/** Uncompressed SEC1 point: 0x04 || X(32) || Y(32). */
export const P256_PUBLIC_LENGTH = 65;
export const P256_SCALAR_LENGTH = 32;
export const ECDSA_SIGNATURE_LENGTH = 64;

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ECDSA_SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;

export type CurveUse = 'ecdh' | 'ecdsa';

export async function generateP256(use: CurveUse): Promise<CryptoKeyPair> {
  return use === 'ecdh'
    ? subtle().generateKey(ECDH, true, ['deriveBits'])
    : subtle().generateKey(ECDSA, true, ['sign', 'verify']);
}

/** Import an uncompressed public point. WebCrypto rejects points off the curve. */
export async function importP256Public(use: CurveUse, raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== P256_PUBLIC_LENGTH || raw[0] !== 0x04) {
    throw new PoolseCryptoError('malformed', 'Expected an uncompressed P-256 public key');
  }
  try {
    return use === 'ecdh'
      ? await subtle().importKey('raw', toBytes(raw), ECDH, true, [])
      : await subtle().importKey('raw', toBytes(raw), ECDSA, true, ['verify']);
  } catch {
    throw new PoolseCryptoError('malformed', 'Invalid P-256 public key');
  }
}

export async function exportP256Public(key: CryptoKey): Promise<Bytes> {
  return new Uint8Array(await subtle().exportKey('raw', key));
}

/**
 * Private keys travel as their 32-byte scalar plus the public point, and are
 * imported through JWK — the one EC private-key format every WebCrypto
 * implementation (including the React Native polyfills) accepts.
 */
export async function exportP256Private(key: CryptoKey): Promise<Bytes> {
  const jwk = await subtle().exportKey('jwk', key);
  if (!jwk.d) throw new PoolseCryptoError('malformed', 'Not a private key');
  const d = fromBase64Url(jwk.d);
  if (d.length !== P256_SCALAR_LENGTH)
    throw new PoolseCryptoError('malformed', 'Invalid P-256 scalar');
  return d;
}

export async function importP256Private(
  use: CurveUse,
  scalar: Uint8Array,
  publicRaw: Uint8Array,
  extractable: boolean,
): Promise<CryptoKey> {
  if (scalar.length !== P256_SCALAR_LENGTH || publicRaw.length !== P256_PUBLIC_LENGTH) {
    throw new PoolseCryptoError('malformed', 'Invalid P-256 private key');
  }
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: toBase64Url(scalar),
    x: toBase64Url(publicRaw.subarray(1, 33)),
    y: toBase64Url(publicRaw.subarray(33, 65)),
    ext: extractable,
  };
  try {
    return use === 'ecdh'
      ? await subtle().importKey('jwk', jwk, ECDH, extractable, ['deriveBits'])
      : await subtle().importKey('jwk', jwk, ECDSA, extractable, ['sign']);
  } catch {
    throw new PoolseCryptoError('malformed', 'Invalid P-256 private key');
  }
}

/** The 32-byte ECDH shared secret (the X coordinate). */
export async function ecdh(privateKey: CryptoKey, publicKey: CryptoKey): Promise<Bytes> {
  return new Uint8Array(
    await subtle().deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256),
  );
}

export async function ecdsaSign(privateKey: CryptoKey, data: Uint8Array): Promise<Bytes> {
  return new Uint8Array(await subtle().sign(ECDSA_SIGN, privateKey, toBytes(data)));
}

export async function ecdsaVerify(
  publicKey: CryptoKey,
  signature: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  if (signature.length !== ECDSA_SIGNATURE_LENGTH) return false;
  return subtle().verify(ECDSA_SIGN, publicKey, toBytes(signature), toBytes(data));
}

/** Join labelled parts for an HKDF `info` or a hash input. */
export function label(...parts: (string | Uint8Array)[]): Bytes {
  return concat(...parts.map((p) => (typeof p === 'string' ? utf8(p) : p)));
}

/**
 * Check that every algorithm the library needs is present. Useful at app
 * start on React Native, where a missing polyfill otherwise surfaces as a
 * confusing failure much later.
 */
export async function checkCryptoSupport(): Promise<{ ok: boolean; missing: string[] }> {
  const missing: string[] = [];
  const attempt = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch {
      missing.push(name);
    }
  };
  try {
    cryptoObject();
  } catch {
    return { ok: false, missing: ['crypto.subtle'] };
  }
  await attempt('getRandomValues', async () => randomBytes(16));
  await attempt('SHA-256', () => sha256(new Uint8Array(1)));
  await attempt('HKDF', () => hkdf(new Uint8Array(32), new Uint8Array(0), new Uint8Array(0)));
  await attempt('HMAC', () => hmac(new Uint8Array(32), new Uint8Array(1)));
  await attempt('AES-GCM', async () => {
    const key = await aesKey(new Uint8Array(32));
    const iv = new Uint8Array(IV_LENGTH);
    const ct = await aesEncrypt(key, iv, new Uint8Array(1), new Uint8Array(1));
    await aesDecrypt(key, iv, ct, new Uint8Array(1));
  });
  await attempt('ECDH P-256', async () => {
    const a = await generateP256('ecdh');
    const raw = await exportP256Public(a.publicKey);
    const d = await exportP256Private(a.privateKey);
    const priv = await importP256Private('ecdh', d, raw, false);
    await ecdh(priv, await importP256Public('ecdh', raw));
  });
  await attempt('ECDSA P-256', async () => {
    const a = await generateP256('ecdsa');
    const raw = await exportP256Public(a.publicKey);
    const sig = await ecdsaSign(a.privateKey, new Uint8Array(1));
    if (!(await ecdsaVerify(await importP256Public('ecdsa', raw), sig, new Uint8Array(1)))) {
      throw new Error('verify');
    }
  });
  return { ok: missing.length === 0, missing };
}
