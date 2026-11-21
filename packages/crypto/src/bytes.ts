/**
 * Byte helpers: encodings, a bounds-checked reader and writer for the
 * binary formats, and a constant-time comparison. Nothing in here is a
 * cryptographic primitive — those all come from WebCrypto (`subtle.ts`).
 */
import { PoolseCryptoError } from './errors';

/**
 * A byte array backed by a plain `ArrayBuffer` — what WebCrypto accepts.
 * Every function here returns one, and inputs are copied into one before
 * they reach `subtle`.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

/** Copy any `Uint8Array` (or view of a shared buffer) into a fresh `Bytes`. */
export function toBytes(input: Uint8Array): Bytes {
  return new Uint8Array(input);
}

export function concat(...parts: Uint8Array[]): Bytes {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// TextEncoder/TextDecoder where the platform has them (browsers, Node,
// Hermes from RN 0.74); a small strict fallback otherwise, so React Native
// apps don't need another polyfill just for this.
let encoder: TextEncoder | null | undefined;
let decoder: TextDecoder | null | undefined;

export function utf8(text: string): Bytes {
  if (encoder === undefined) encoder = typeof TextEncoder === 'function' ? new TextEncoder() : null;
  if (encoder) return new Uint8Array(encoder.encode(text));
  const out: number[] = [];
  for (const ch of text) {
    let cp = ch.codePointAt(0) as number;
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd; // lone surrogate, as TextEncoder does
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63),
      );
    }
  }
  return Uint8Array.from(out);
}

export function fromUtf8(bytes: Uint8Array): string {
  if (decoder === undefined) {
    try {
      decoder =
        typeof TextDecoder === 'function' ? new TextDecoder('utf-8', { fatal: true }) : null;
    } catch {
      decoder = null;
    }
  }
  if (decoder) {
    try {
      return decoder.decode(bytes);
    } catch {
      throw new PoolseCryptoError('malformed', 'Decrypted data is not valid UTF-8');
    }
  }
  return decodeUtf8Strict(bytes);
}

/** @internal Strict UTF-8 decoding (no overlongs, surrogates or truncation). */
export function decodeUtf8Strict(bytes: Uint8Array): string {
  const invalid = () => new PoolseCryptoError('malformed', 'Decrypted data is not valid UTF-8');
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i] as number;
    let cp: number;
    let need: number;
    let min: number;
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      i++;
      continue;
    } else if (b0 >= 0xc2 && b0 <= 0xdf) {
      cp = b0 & 0x1f;
      need = 1;
      min = 0x80;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      cp = b0 & 0x0f;
      need = 2;
      min = 0x800;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      cp = b0 & 0x07;
      need = 3;
      min = 0x10000;
    } else {
      throw invalid();
    }
    for (let k = 1; k <= need; k++) {
      const b = bytes[i + k];
      if (b === undefined || (b & 0xc0) !== 0x80) throw invalid();
      cp = (cp << 6) | (b & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) throw invalid();
    out += String.fromCodePoint(cp);
    i += need + 1;
  }
  return out;
}

/**
 * Compare two byte arrays without an early exit, so the time taken doesn't
 * say where the first difference is. Lengths are not secret here.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// base64url (RFC 4648 §5, no padding)

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) B64_LOOKUP[B64.charCodeAt(i)] = i;

/** Encode bytes as base64url without padding — safe in URLs and JSON. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n =
      ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] as number) << 16;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]!;
  }
  return out;
}

/**
 * Decode base64url (padding and the standard `+/` alphabet are accepted
 * too). Throws `PoolseCryptoError('malformed')` on anything else.
 */
export function fromBase64Url(text: string): Bytes {
  const clean = text.replace(/=+$/, '');
  if (clean.length % 4 === 1) throw new PoolseCryptoError('malformed', 'Invalid base64url length');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    let code = clean.charCodeAt(i);
    if (code === 43) code = 45; // '+' -> '-'
    if (code === 47) code = 95; // '/' -> '_'
    const value = code < 128 ? (B64_LOOKUP[code] as number) : -1;
    if (value < 0) throw new PoolseCryptoError('malformed', 'Invalid base64url character');
    buffer = ((buffer << 6) | value) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  // Leftover bits must be zero, so every byte string has one encoding.
  if ((buffer & ((1 << bits) - 1)) !== 0) {
    throw new PoolseCryptoError('malformed', 'Invalid base64url padding bits');
  }
  return out;
}

// ---------------------------------------------------------------------------
// base32 (Crockford alphabet, no padding). Uppercase letters and digits
// only, so it fits a QR code's compact alphanumeric mode and reads aloud
// without ambiguity.

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function toBase32(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += B32[(buffer >> bits) & 31]!;
    }
  }
  if (bits > 0) out += B32[(buffer << (5 - bits)) & 31]!;
  return out;
}

/**
 * Decode Crockford base32. Case-insensitive; `O` reads as `0`, `I` and `L`
 * as `1`; spaces and hyphens are ignored, so grouped keys paste as typed.
 */
export function fromBase32(text: string): Bytes {
  const clean = text.toUpperCase().replace(/[\s-]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 5) / 8));
  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (const raw of clean) {
    const ch = raw === 'O' ? '0' : raw === 'I' || raw === 'L' ? '1' : raw;
    const value = B32.indexOf(ch);
    if (value < 0) throw new PoolseCryptoError('malformed', 'Invalid base32 character');
    buffer = ((buffer << 5) | value) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  if ((buffer & ((1 << bits) - 1)) !== 0) {
    throw new PoolseCryptoError('malformed', 'Invalid base32 padding bits');
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

export function fromHex(hex: string): Bytes {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new PoolseCryptoError('malformed', 'Invalid hex');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ---------------------------------------------------------------------------
// Binary writer / reader for the envelope formats (big-endian integers).

export class ByteWriter {
  private readonly parts: Uint8Array[] = [];

  u8(value: number): this {
    this.parts.push(Uint8Array.of(value & 0xff));
    return this;
  }

  u16(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new PoolseCryptoError('malformed', 'Value does not fit in 16 bits');
    }
    this.parts.push(Uint8Array.of(value >>> 8, value & 0xff));
    return this;
  }

  u32(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new PoolseCryptoError('malformed', 'Value does not fit in 32 bits');
    }
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, value);
    this.parts.push(b);
    return this;
  }

  /** A non-negative safe integer as 8 bytes. */
  u64(value: number): this {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new PoolseCryptoError('malformed', 'Value is not a non-negative safe integer');
    }
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt(value));
    this.parts.push(b);
    return this;
  }

  bytes(value: Uint8Array): this {
    this.parts.push(value);
    return this;
  }

  /** Bytes with a 16-bit length prefix. */
  bytes16(value: Uint8Array): this {
    return this.u16(value.length).bytes(value);
  }

  /** Bytes with a 32-bit length prefix. */
  bytes32(value: Uint8Array): this {
    return this.u32(value.length).bytes(value);
  }

  finish(): Bytes {
    return concat(...this.parts);
  }
}

export class ByteReader {
  offset = 0;

  constructor(readonly data: Uint8Array) {}

  private take(length: number): Bytes {
    if (this.offset + length > this.data.length) {
      throw new PoolseCryptoError('malformed', 'Data is truncated');
    }
    const out = new Uint8Array(this.data.subarray(this.offset, this.offset + length));
    this.offset += length;
    return out;
  }

  u8(): number {
    return this.take(1)[0] as number;
  }

  u16(): number {
    const b = this.take(2);
    return ((b[0] as number) << 8) | (b[1] as number);
  }

  u32(): number {
    return new DataView(this.take(4).buffer).getUint32(0);
  }

  u64(): number {
    const value = new DataView(this.take(8).buffer).getBigUint64(0);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new PoolseCryptoError('malformed', 'Integer is out of range');
    }
    return Number(value);
  }

  bytes(length: number): Bytes {
    return this.take(length);
  }

  bytes16(): Bytes {
    return this.take(this.u16());
  }

  bytes32(): Bytes {
    return this.take(this.u32());
  }

  /** Everything from the start up to the current position. */
  consumed(): Bytes {
    return new Uint8Array(this.data.subarray(0, this.offset));
  }

  rest(): Bytes {
    return this.take(this.data.length - this.offset);
  }

  remaining(): number {
    return this.data.length - this.offset;
  }

  /** Refuse trailing bytes: every envelope has exactly one valid length. */
  end(): void {
    if (this.offset !== this.data.length) {
      throw new PoolseCryptoError('malformed', 'Unexpected trailing data');
    }
  }
}
