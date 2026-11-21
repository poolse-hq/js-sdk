import { describe, expect, it } from 'vitest';
import {
  AccountKey,
  DeviceKeys,
  ItemKey,
  decryptAttachmentBytes,
  decryptBytes,
  decryptItem,
  fromHex,
  inspectEnvelope,
  openSharedItemKey,
  parseRecoveryKey,
  toHex,
  unwrapAccountKeyForDevice,
  unwrapAccountKeyWithRecoveryKey,
  unwrapItemKey,
} from '../src';
import { V1 } from './vectors';

// Known-answer tests: the keys below and the envelopes in vectors.ts were
// fixed when format version 1 was released.
const itemKey = () => ItemKey.fromBytes(fromHex('00'.repeat(31) + '01'), 3);
const accountKey = () => AccountKey.fromBytes(fromHex('11'.repeat(32)));

describe('format version 1 known answers', () => {
  it('decrypts a frozen item', async () => {
    const item = fromHex(V1.item);
    expect(toHex(item.subarray(0, 8))).toBe('7001010100000003'); // magic, v1, item, AES-GCM, key v3
    expect(await decryptItem(itemKey(), item, { itemId: 'note-1', version: 7 })).toEqual({
      title: 'Ünïcode title',
      body: 'Hello',
      metadata: { tags: ['a'] },
    });
  });

  it('decrypts frozen bytes', async () => {
    expect(toHex(await decryptBytes(itemKey(), fromHex(V1.bytes), { itemId: 'note-1' }))).toBe(
      'deadbeef',
    );
  });

  it('unwraps a frozen item key under the account key', async () => {
    const wrap = fromHex(V1.itemKeyWrap);
    expect(toHex(wrap.subarray(0, 9))).toBe('700102010200000003'); // key wrap, purpose item-key, v3
    const key = await unwrapItemKey(wrap, await accountKey(), { itemId: 'note-1' });
    expect(key.version).toBe(3);
    expect(key.toBytes()).toEqual(itemKey().toBytes());
  });

  it('imports frozen device keys and opens a frozen signed share', async () => {
    const device = await DeviceKeys.import(fromHex(V1.deviceExport));
    const sender = await DeviceKeys.import(fromHex(V1.senderExport));
    const share = fromHex(V1.share);
    expect(inspectEnvelope(share)).toEqual({
      formatVersion: 1,
      kind: 'public-key-wrap',
      alg: 2,
      keyVersion: 3,
      recipientId: device.id,
    });
    const opened = await openSharedItemKey(share, device, {
      itemId: 'note-1',
      requireSignatureFrom: sender.publicKeys,
    });
    expect(opened.key.toBytes()).toEqual(itemKey().toBytes());
  });

  it('unwraps a frozen account-key device wrap', async () => {
    const device = await DeviceKeys.import(fromHex(V1.deviceExport));
    const { key } = await unwrapAccountKeyForDevice(fromHex(V1.accountWrap), device, {
      accountId: 'acct-1',
    });
    expect(key.id).toBe((await accountKey()).id);
  });

  it('unwraps a frozen recovery wrap with the frozen recovery key', async () => {
    const rk = await parseRecoveryKey(V1.recovery);
    const key = await unwrapAccountKeyWithRecoveryKey(fromHex(V1.recoveryWrap), rk, {
      accountId: 'acct-1',
    });
    expect(key.toBytes()).toEqual((await accountKey()).toBytes());
  });

  it('decrypts a frozen chunked attachment', async () => {
    const sealed = fromHex(V1.attachment);
    // 18 bytes in 16-byte chunks: header + one full chunk + a 2-byte final one.
    expect(sealed.length).toBe(60 + 16 + 16 + 2 + 16);
    const plain = await decryptAttachmentBytes(itemKey(), sealed, {
      itemId: 'note-1',
      attachmentId: 'att-1',
    });
    expect(toHex(plain)).toBe('00112233445566778899aabbccddeeff0011');
  });
});
