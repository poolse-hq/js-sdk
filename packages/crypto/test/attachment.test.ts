import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_HEADER_LENGTH,
  ItemKey,
  MAX_CHUNK_SIZE,
  decryptAttachment,
  decryptAttachmentBytes,
  encryptAttachment,
  encryptAttachmentBytes,
  encryptedAttachmentSize,
  inspectEnvelope,
} from '../src';
import { expectCryptoError, expectEveryBitFlipRejected } from './helpers';

const ad = { itemId: 'note-1', attachmentId: 'att-1' };
const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 131 + 17) & 0xff);

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for await (const part of stream) out.push(part);
  return out;
}

function join(parts: Uint8Array[]): Uint8Array {
  return new Uint8Array(Buffer.concat(parts));
}

describe('attachments', () => {
  it('round-trip at and around chunk boundaries, including empty files', async () => {
    const key = ItemKey.generate();
    const chunkSize = 64;
    for (const n of [0, 1, 63, 64, 65, 127, 128, 129, 1000]) {
      const plain = bytes(n);
      const sealed = await encryptAttachmentBytes(key, plain, ad, { chunkSize });
      expect(sealed.length).toBe(encryptedAttachmentSize(n, chunkSize));
      expect(await decryptAttachmentBytes(key, sealed, ad)).toEqual(plain);
    }
  });

  it('streams: input pieces of any size, output one piece per chunk', async () => {
    const key = ItemKey.generate();
    const plain = bytes(10_000);
    async function* pieces() {
      for (let i = 0; i < plain.length; i += 333) yield plain.subarray(i, i + 333);
    }
    const parts = await collect(encryptAttachment(key, pieces(), ad, { chunkSize: 1024 }));
    expect(parts[0]!.length).toBe(ATTACHMENT_HEADER_LENGTH);
    expect(parts.length).toBe(1 + Math.ceil(10_000 / 1024));
    // Decrypt from a stream cut at odd places too.
    const sealed = join(parts);
    async function* odd() {
      for (let i = 0; i < sealed.length; i += 777) yield sealed.subarray(i, i + 777);
    }
    const out = await collect(decryptAttachment(key, odd(), ad));
    expect(join(out)).toEqual(plain);
    expect(out.length).toBe(Math.ceil(10_000 / 1024));
  });

  it('accepts a ReadableStream and a Blob', async () => {
    const key = ItemKey.generate();
    const plain = bytes(5000);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(plain.subarray(0, 2500));
        controller.enqueue(plain.subarray(2500));
        controller.close();
      },
    });
    const sealed = await encryptAttachmentBytes(key, stream, ad, { chunkSize: 1000 });
    expect(await decryptAttachmentBytes(key, new Blob([new Uint8Array(sealed)]), ad)).toEqual(
      plain,
    );
  });

  it('uses the default 64 KiB chunks for large files', async () => {
    const key = ItemKey.generate();
    const plain = crypto.getRandomValues(new Uint8Array(65536)).slice();
    const big = new Uint8Array(3 * 65536 + 5);
    for (let i = 0; i < 3; i++) big.set(plain, i * 65536);
    const sealed = await encryptAttachmentBytes(key, big, ad);
    expect(sealed.length).toBe(encryptedAttachmentSize(big.length));
    expect(await decryptAttachmentBytes(key, sealed, ad)).toEqual(big);
  });

  it('rejects every single-bit change', async () => {
    const key = ItemKey.generate();
    const sealed = await encryptAttachmentBytes(key, bytes(40), ad, { chunkSize: 16 });
    await expectEveryBitFlipRejected(sealed, (s) => decryptAttachmentBytes(key, s, ad));
  });

  it('rejects truncation at a chunk boundary, dropped, reordered and appended chunks', async () => {
    const key = ItemKey.generate();
    const parts = await collect(encryptAttachment(key, bytes(48), ad, { chunkSize: 16 }));
    // header + 3 full chunks, the last one final.
    expect(parts.length).toBe(4);
    const [header, c0, c1, c2] = parts as [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
    await expectCryptoError(decryptAttachmentBytes(key, join([header, c0, c1]), ad), 'tampered');
    await expectCryptoError(decryptAttachmentBytes(key, join([header, c0, c2]), ad), 'tampered');
    await expectCryptoError(
      decryptAttachmentBytes(key, join([header, c1, c0, c2]), ad),
      'tampered',
    );
    await expectCryptoError(
      decryptAttachmentBytes(key, join([header, c0, c1, c2, c2]), ad),
      'tampered',
    );
    await expectCryptoError(
      decryptAttachmentBytes(key, join([header, c0, c1, c2, Uint8Array.of(0)]), ad),
    );
    await expectCryptoError(decryptAttachmentBytes(key, header, ad), 'malformed');
    await expectCryptoError(decryptAttachmentBytes(key, header.subarray(0, 30), ad), 'malformed');
  });

  it('does not mix chunks from two files under the same item key', async () => {
    const key = ItemKey.generate();
    const a = await collect(encryptAttachment(key, bytes(32), ad, { chunkSize: 16 }));
    const b = await collect(encryptAttachment(key, bytes(32), ad, { chunkSize: 16 }));
    await expectCryptoError(
      decryptAttachmentBytes(key, join([a[0]!, b[1]!, b[2]!]), ad),
      'tampered',
    );
  });

  it('is bound to the item and attachment ids, and to the key', async () => {
    const key = ItemKey.generate();
    const sealed = await encryptAttachmentBytes(key, bytes(100), ad, { chunkSize: 32 });
    await expectCryptoError(
      decryptAttachmentBytes(key, sealed, { ...ad, attachmentId: 'att-2' }),
      'tampered',
    );
    await expectCryptoError(
      decryptAttachmentBytes(key, sealed, { ...ad, itemId: 'note-2' }),
      'tampered',
    );
    await expectCryptoError(decryptAttachmentBytes(ItemKey.generate(), sealed, ad), 'wrong-key');
    expect(inspectEnvelope(sealed)).toMatchObject({ kind: 'attachment', keyVersion: 1 });
  });

  it('validates chunk sizes', async () => {
    const key = ItemKey.generate();
    await expectCryptoError(
      encryptAttachmentBytes(key, bytes(1), ad, { chunkSize: 8 }),
      'malformed',
    );
    await expectCryptoError(
      encryptAttachmentBytes(key, bytes(1), ad, { chunkSize: MAX_CHUNK_SIZE + 1 }),
      'malformed',
    );
    expect(() => encryptedAttachmentSize(10, 0)).toThrow();
    expect(encryptedAttachmentSize(0, 16)).toBe(ATTACHMENT_HEADER_LENGTH + 16);
  });
});
