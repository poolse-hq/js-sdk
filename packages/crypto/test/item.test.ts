import { describe, expect, it } from 'vitest';
import {
  FORMAT_VERSION,
  ItemKey,
  decryptBytes,
  decryptItem,
  encryptBytes,
  encryptItem,
  inspectEnvelope,
  rotateItemKey,
  type ItemContent,
} from '../src';
import { expectCryptoError, expectEveryBitFlipRejected } from './helpers';

const content: ItemContent = {
  title: 'Quarterly plan — 🚀',
  body: { type: 'doc', content: [{ type: 'paragraph', text: 'Ship Notes' }] },
  metadata: { tags: ['work'], pinned: true, folder: null },
};
const ad = { itemId: 'note-1', version: 3 };

describe('items', () => {
  it('round-trips title, body and metadata', async () => {
    const key = ItemKey.generate();
    const envelope = await encryptItem(key, content, ad);
    expect(await decryptItem(key, envelope, ad)).toEqual(content);
  });

  it('never repeats a ciphertext and never shows the plaintext', async () => {
    const key = ItemKey.generate();
    const a = await encryptItem(key, content, ad);
    const b = await encryptItem(key, content, ad);
    expect(a).not.toEqual(b);
    const text = new TextDecoder('latin1').decode(a);
    expect(text).not.toContain('Quarterly');
    expect(text).not.toContain('work');
  });

  it('pads, so small edits do not change the size', async () => {
    const key = ItemKey.generate();
    const sizes = new Set<number>();
    for (let n = 1000; n < 1010; n++) {
      sizes.add((await encryptItem(key, { title: 't', body: 'x'.repeat(n) }, ad)).length);
    }
    expect(sizes.size).toBe(1);
  });

  it('rejects every single-bit change', async () => {
    const key = ItemKey.generate();
    const envelope = await encryptItem(key, { title: 'short', body: '' }, ad);
    const codes = await expectEveryBitFlipRejected(envelope, (e) => decryptItem(key, e, ad));
    // Header bits give malformed/unsupported; the key version and check give wrong-key; the rest tampered.
    expect(codes).toContain('tampered');
    expect(codes).toContain('wrong-key');
    expect(codes).toContain('malformed');
  });

  it('rejects truncation and trailing data', async () => {
    const key = ItemKey.generate();
    const envelope = await encryptItem(key, content, ad);
    await expectCryptoError(decryptItem(key, envelope.subarray(0, envelope.length - 1), ad));
    await expectCryptoError(decryptItem(key, envelope.subarray(0, 20), ad), 'malformed');
    const longer = new Uint8Array(envelope.length + 1);
    longer.set(envelope);
    await expectCryptoError(decryptItem(key, longer, ad), 'tampered');
  });

  it('rejects the wrong key', async () => {
    const envelope = await encryptItem(ItemKey.generate(), content, ad);
    await expectCryptoError(decryptItem(ItemKey.generate(), envelope, ad), 'wrong-key');
  });

  it('rejects a key of another version', async () => {
    const key = ItemKey.generate();
    const envelope = await encryptItem(key, content, ad);
    const sameBytesOtherVersion = ItemKey.fromBytes(key.toBytes(), 2);
    await expectCryptoError(decryptItem(sameBytesOtherVersion, envelope, ad), 'wrong-key');
  });

  it('is bound to its item id and version', async () => {
    const key = ItemKey.generate();
    const envelope = await encryptItem(key, content, ad);
    await expectCryptoError(
      decryptItem(key, envelope, { itemId: 'note-2', version: 3 }),
      'tampered',
    );
    await expectCryptoError(
      decryptItem(key, envelope, { itemId: 'note-1', version: 2 }),
      'tampered',
    );
    await expectCryptoError(
      decryptItem(key, envelope, { itemId: 'note-1', version: '3' }),
      'tampered',
    );
    await expectCryptoError(decryptItem(key, envelope, { itemId: 'note-1' }), 'tampered');
    await expectCryptoError(decryptItem(key, envelope, { ...ad, extra: 'x' }), 'tampered');
  });

  it('keeps items and raw bytes apart', async () => {
    const key = ItemKey.generate();
    const bytes = await encryptBytes(key, Uint8Array.of(1, 2, 3), ad);
    expect(await decryptBytes(key, bytes, ad)).toEqual(Uint8Array.of(1, 2, 3));
    await expectCryptoError(decryptItem(key, bytes, ad), 'tampered');
    const item = await encryptItem(key, content, ad);
    await expectCryptoError(decryptBytes(key, item, ad), 'tampered');
  });

  it('requires an item id', async () => {
    await expectCryptoError(encryptItem(ItemKey.generate(), content, { itemId: '' }), 'malformed');
  });

  it('refuses a newer format version and unknown algorithms as unsupported', async () => {
    const key = ItemKey.generate();
    const envelope = await encryptItem(key, content, ad);
    const newer = new Uint8Array(envelope);
    newer[1] = FORMAT_VERSION + 1;
    await expectCryptoError(decryptItem(key, newer, ad), 'unsupported');
    expect(() => inspectEnvelope(newer)).toThrow(/newer/);
    const otherAlg = new Uint8Array(envelope);
    otherAlg[3] = 99;
    await expectCryptoError(decryptItem(key, otherAlg, ad), 'unsupported');
  });

  it('can be inspected without the key', async () => {
    const key = rotateItemKey(ItemKey.generate());
    const envelope = await encryptItem(key, content, ad);
    expect(inspectEnvelope(envelope)).toEqual({
      formatVersion: 1,
      kind: 'item',
      alg: 1,
      keyVersion: 2,
    });
  });

  it('does not leak key bytes through JSON or logs', () => {
    const key = ItemKey.generate();
    expect(JSON.stringify({ key })).toBe('{"key":{"version":1}}');
    expect(Object.keys(key)).toEqual(['version']);
  });
});
