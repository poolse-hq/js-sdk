import { describe, expect, it } from 'vitest';
import {
  PoolseCryptoError,
  checkCryptoSupport,
  constantTimeEqual,
  encodeAssociatedData,
  fromBase32,
  fromBase64Url,
  fromHex,
  padmeLength,
  toBase32,
  toBase64Url,
  toHex,
} from '../src';
import { decodeUtf8Strict } from '../src/bytes';
import { pad, unpad } from '../src/format';
import { hkdf } from '../src/subtle';

const utf8 = (s: string) => new TextEncoder().encode(s);

describe('encodings', () => {
  it('base64url matches RFC 4648 vectors and round-trips every length', () => {
    expect(toBase64Url(utf8(''))).toBe('');
    expect(toBase64Url(utf8('f'))).toBe('Zg');
    expect(toBase64Url(utf8('fo'))).toBe('Zm8');
    expect(toBase64Url(utf8('foo'))).toBe('Zm9v');
    expect(toBase64Url(utf8('foobar'))).toBe('Zm9vYmFy');
    expect(toBase64Url(Uint8Array.of(0xfb, 0xff, 0xbf))).toBe('-_-_');
    expect(fromBase64Url('+/+/')).toEqual(Uint8Array.of(0xfb, 0xff, 0xbf));
    expect(fromBase64Url('Zm8=')).toEqual(utf8('fo'));
    for (let n = 0; n < 70; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    }
  });

  it('base64url refuses bad input', () => {
    expect(() => fromBase64Url('Zm9v!')).toThrow(PoolseCryptoError);
    expect(() => fromBase64Url('Z')).toThrow(PoolseCryptoError);
    expect(() => fromBase64Url('Zh')).toThrow(PoolseCryptoError); // non-zero padding bits
  });

  it('base32 is Crockford and forgiving on input', () => {
    expect(toBase32(utf8('foobar'))).toBe('CSQPYRK1E8');
    expect(fromBase32('csqp-yrk1 e8')).toEqual(utf8('foobar'));
    expect(fromBase32('CSQPYRKIE8')).toEqual(utf8('foobar')); // I reads as 1
    expect(fromBase32('0O')).toEqual(fromBase32('00'));
    expect(() => fromBase32('CSQPU')).toThrow(PoolseCryptoError); // U is not in the alphabet
    for (let n = 0; n < 40; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 91 + 7) & 0xff);
      expect(fromBase32(toBase32(bytes))).toEqual(bytes);
    }
  });

  it('hex round-trips', () => {
    expect(toHex(Uint8Array.of(0, 15, 255))).toBe('000fff');
    expect(fromHex('000fff')).toEqual(Uint8Array.of(0, 15, 255));
    expect(() => fromHex('0g')).toThrow(PoolseCryptoError);
  });

  it('constantTimeEqual', () => {
    expect(constantTimeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2))).toBe(true);
    expect(constantTimeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false);
    expect(constantTimeEqual(Uint8Array.of(1), Uint8Array.of(1, 2))).toBe(false);
  });
});

describe('WebCrypto', () => {
  it('has every algorithm the library uses', async () => {
    expect(await checkCryptoSupport()).toEqual({ ok: true, missing: [] });
  });

  it('HKDF-SHA-256 matches RFC 5869 test case 1', async () => {
    const okm = await hkdf(
      fromHex('0b'.repeat(22)),
      fromHex('000102030405060708090a0b0c'),
      fromHex('f0f1f2f3f4f5f6f7f8f9'),
      42,
    );
    expect(toHex(okm)).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
  });
});

describe('associated data', () => {
  it('is canonical: key order does not matter, types do', () => {
    const a = encodeAssociatedData('x', { itemId: 'n1', version: 2 });
    const b = encodeAssociatedData('x', { version: 2, itemId: 'n1' });
    expect(a).toEqual(b);
    expect(encodeAssociatedData('x', { itemId: 'n1', version: '2' })).not.toEqual(a);
    expect(encodeAssociatedData('y', { itemId: 'n1', version: 2 })).not.toEqual(a);
  });

  it('cannot be confused by concatenation', () => {
    expect(encodeAssociatedData('x', { a: 'bc' })).not.toEqual(
      encodeAssociatedData('x', { ab: 'c' }),
    );
  });

  it('reserves @ keys', () => {
    expect(() => encodeAssociatedData('x', { '@type': 'item' })).toThrow(PoolseCryptoError);
  });
});

describe('padding', () => {
  it('Padmé lengths grow at most ~12% and hide small differences', () => {
    for (let n = 1; n < 100_000; n = Math.ceil(n * 1.07) + 1) {
      const p = padmeLength(n);
      expect(p).toBeGreaterThanOrEqual(n);
      expect(p / n).toBeLessThan(1.13);
    }
    expect(padmeLength(1000)).toBe(padmeLength(1001));
  });

  it('round-trips and rejects non-zero padding', () => {
    for (const n of [0, 1, 27, 28, 29, 500, 4096]) {
      const data = Uint8Array.from({ length: n }, (_, i) => i & 0xff);
      const padded = pad(data);
      expect(padded.length).toBeGreaterThanOrEqual(32);
      expect(unpad(padded)).toEqual(data);
    }
    const padded = pad(Uint8Array.of(1, 2, 3));
    padded[padded.length - 1] = 1;
    expect(() => unpad(padded)).toThrow(PoolseCryptoError);
  });
});

describe('UTF-8 fallback (for runtimes without TextDecoder)', () => {
  it('matches TextDecoder on valid input', () => {
    for (const text of ['', 'ascii', 'Ünïcode', '日本語', '🚀 emoji', 'mixed ✓ 𝄞 end']) {
      expect(decodeUtf8Strict(new TextEncoder().encode(text))).toBe(text);
    }
  });

  it('refuses overlongs, surrogates, stray continuations and truncation', () => {
    for (const bad of [
      [0xc0, 0x80],
      [0xe0, 0x80, 0x80],
      [0xed, 0xa0, 0x80],
      [0x80],
      [0xe2, 0x82],
      [0xf4, 0x90, 0x80, 0x80],
      [0xff],
    ]) {
      expect(() => decodeUtf8Strict(Uint8Array.from(bad))).toThrow(PoolseCryptoError);
    }
  });
});
