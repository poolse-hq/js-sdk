import { describe, expect, it } from 'vitest';
import {
  AccountKey,
  DeviceKeys,
  ItemKey,
  decodeDevicePublicKeys,
  decryptItem,
  deviceFingerprint,
  encodeDevicePublicKeys,
  encryptItem,
  inspectEnvelope,
  openSharedItemKey,
  rotateItemKey,
  sameDevice,
  shareItemKey,
  shareItemKeyWithDevices,
  toBase64Url,
  unwrapAccountKeyForDevice,
  unwrapItemKey,
  unwrapPreviousItemKey,
  wrapAccountKeyForDevice,
  wrapItemKey,
  wrapPreviousItemKey,
} from '../src';
import { expectCryptoError, expectEveryBitFlipRejected } from './helpers';

const account = { accountId: 'acct-1' };

describe('device keys', () => {
  it('export and import (plain) keep the same keys', async () => {
    const device = await DeviceKeys.generate();
    const bytes = await device.export();
    const again = await DeviceKeys.import(bytes);
    expect(again.id).toBe(device.id);
    expect(sameDevice(again.publicKeys, device.publicKeys)).toBe(true);
    // The imported keys work: unwrap something wrapped to the original.
    const ak = await AccountKey.generate();
    const wrap = await wrapAccountKeyForDevice(ak, device.publicKeys, account);
    expect((await unwrapAccountKeyForDevice(wrap, again, account)).key.id).toBe(ak.id);
  });

  it('imports non-extractable by default', async () => {
    const again = await DeviceKeys.import(await (await DeviceKeys.generate()).export());
    await expectCryptoError(again.export(), 'malformed');
    const extractable = await DeviceKeys.import(await (await DeviceKeys.generate()).export(), {
      extractable: true,
    });
    await expect(extractable.export()).resolves.toBeInstanceOf(Uint8Array);
  });

  it('export wrapped with a keychain key, and refuses the wrong one', async () => {
    const device = await DeviceKeys.generate();
    const wrappingKey = crypto.getRandomValues(new Uint8Array(32));
    const bytes = await device.export({ wrappingKey });
    expect((await DeviceKeys.import(bytes, { wrappingKey })).id).toBe(device.id);
    await expectCryptoError(
      DeviceKeys.import(bytes, { wrappingKey: crypto.getRandomValues(new Uint8Array(32)) }),
      'wrong-key',
    );
    await expectCryptoError(DeviceKeys.import(bytes), 'wrong-key');
    await expectEveryBitFlipRejected(bytes, (b) => DeviceKeys.import(b, { wrappingKey }));
  });

  it('a corrupted plain export fails clearly', async () => {
    const bytes = await (await DeviceKeys.generate()).export();
    await expectEveryBitFlipRejected(bytes, (b) => DeviceKeys.import(b));
  });

  it('public keys encode for the directory and decode back', async () => {
    const device = await DeviceKeys.generate();
    const text = encodeDevicePublicKeys(device.publicKeys);
    const decoded = await decodeDevicePublicKeys(text);
    expect(decoded.id).toBe(device.id);
    expect(sameDevice(decoded, device.publicKeys)).toBe(true);
    expect(inspectEnvelope(new Uint8Array(Buffer.from(text, 'base64url'))).kind).toBe(
      'device-public-keys',
    );
    // A point off the curve is refused.
    const bad = Buffer.from(text, 'base64url');
    bad[10] = (bad[10] as number) ^ 1;
    await expectCryptoError(decodeDevicePublicKeys(bad.toString('base64url')), 'malformed');
  });

  it('fingerprints are 8 groups of 4 and differ per device', async () => {
    const a = await deviceFingerprint((await DeviceKeys.generate()).publicKeys);
    const b = await deviceFingerprint((await DeviceKeys.generate()).publicKeys);
    expect(a).toMatch(/^([0-9A-Z]{4} ){7}[0-9A-Z]{4}$/);
    expect(a).not.toBe(b);
  });

  it('do not leak private keys through JSON', async () => {
    const device = await DeviceKeys.generate();
    expect(JSON.stringify(device)).toBe(JSON.stringify({ id: device.id }));
  });
});

describe('account key', () => {
  it('has a stable public id that does not reveal the key', async () => {
    const ak = await AccountKey.generate();
    const again = await AccountKey.fromBytes(ak.toBytes());
    expect(again.id).toBe(ak.id);
    expect(ak.id).not.toBe(toBase64Url(ak.toBytes()).slice(0, 22));
    expect(JSON.stringify(ak)).toBe(JSON.stringify({ id: ak.id }));
  });

  it('wraps to a device, signed or not', async () => {
    const ak = await AccountKey.generate();
    const phone = await DeviceKeys.generate();
    const laptop = await DeviceKeys.generate();
    const unsigned = await wrapAccountKeyForDevice(ak, phone.publicKeys, account);
    const r1 = await unwrapAccountKeyForDevice(unsigned, phone, account);
    expect(r1.key.id).toBe(ak.id);
    expect(r1.signingKey).toBeNull();

    const signed = await wrapAccountKeyForDevice(ak, phone.publicKeys, {
      ...account,
      signer: laptop,
    });
    const r2 = await unwrapAccountKeyForDevice(signed, phone, {
      ...account,
      requireSignatureFrom: [laptop.publicKeys],
    });
    expect(r2.key.id).toBe(ak.id);
    expect(r2.signer?.id).toBe(laptop.id);
  });

  it('refuses unsigned or wrongly signed wraps when a signer is required', async () => {
    const ak = await AccountKey.generate();
    const phone = await DeviceKeys.generate();
    const laptop = await DeviceKeys.generate();
    const mallory = await DeviceKeys.generate();
    const unsigned = await wrapAccountKeyForDevice(ak, phone.publicKeys, account);
    await expectCryptoError(
      unwrapAccountKeyForDevice(unsigned, phone, {
        ...account,
        requireSignatureFrom: laptop.publicKeys,
      }),
      'bad-signature',
    );
    const forged = await wrapAccountKeyForDevice(ak, phone.publicKeys, {
      ...account,
      signer: mallory,
    });
    await expectCryptoError(
      unwrapAccountKeyForDevice(forged, phone, {
        ...account,
        requireSignatureFrom: laptop.publicKeys,
      }),
      'bad-signature',
    );
  });

  it('only the recipient device can unwrap', async () => {
    const ak = await AccountKey.generate();
    const phone = await DeviceKeys.generate();
    const wrap = await wrapAccountKeyForDevice(ak, phone.publicKeys, account);
    await expectCryptoError(
      unwrapAccountKeyForDevice(wrap, await DeviceKeys.generate(), account),
      'wrong-key',
    );
  });

  it('is bound to the account id', async () => {
    const ak = await AccountKey.generate();
    const phone = await DeviceKeys.generate();
    const wrap = await wrapAccountKeyForDevice(ak, phone.publicKeys, account);
    await expectCryptoError(
      unwrapAccountKeyForDevice(wrap, phone, { accountId: 'acct-2' }),
      'tampered',
    );
  });

  it('device wraps reject every single-bit change (signed)', async () => {
    const ak = await AccountKey.generate();
    const phone = await DeviceKeys.generate();
    const laptop = await DeviceKeys.generate();
    const wrap = await wrapAccountKeyForDevice(ak, phone.publicKeys, {
      ...account,
      signer: laptop,
    });
    const codes = await expectEveryBitFlipRejected(wrap, (w) =>
      unwrapAccountKeyForDevice(w, phone, account),
    );
    expect(codes).toContain('bad-signature');
  });
});

describe('item keys', () => {
  it('wrap under the account key, bound to the item', async () => {
    const ak = await AccountKey.generate();
    const key = ItemKey.generate();
    const wrap = await wrapItemKey(key, ak, { itemId: 'n1' });
    const back = await unwrapItemKey(wrap, ak, { itemId: 'n1' });
    expect(back.toBytes()).toEqual(key.toBytes());
    expect(back.version).toBe(1);
    await expectCryptoError(unwrapItemKey(wrap, ak, { itemId: 'n2' }), 'tampered');
    await expectCryptoError(
      unwrapItemKey(wrap, await AccountKey.generate(), { itemId: 'n1' }),
      'wrong-key',
    );
    await expectEveryBitFlipRejected(wrap, (w) => unwrapItemKey(w, ak, { itemId: 'n1' }));
  });

  it('keeps the key version through wrapping', async () => {
    const ak = await AccountKey.generate();
    const v3 = rotateItemKey(rotateItemKey(ItemKey.generate()));
    expect(v3.version).toBe(3);
    const back = await unwrapItemKey(await wrapItemKey(v3, ak, { itemId: 'n1' }), ak, {
      itemId: 'n1',
    });
    expect(back.version).toBe(3);
  });

  it('cannot be passed off as another kind of wrap', async () => {
    const ak = await AccountKey.generate();
    const key = ItemKey.generate();
    const wrap = await wrapItemKey(key, ak, { itemId: 'n1' });
    // The same KEK bytes used as an item key: purpose mismatch is caught.
    const asPrevious = ItemKey.fromBytes(ak.toBytes(), 2);
    await expectCryptoError(unwrapPreviousItemKey(wrap, asPrevious, { itemId: 'n1' }), 'malformed');
  });
});

describe('sharing and revocation', () => {
  it('shares to every device of a recipient, signed by the sharer', async () => {
    const author = await DeviceKeys.generate();
    const bobPhone = await DeviceKeys.generate();
    const bobLaptop = await DeviceKeys.generate();
    const key = ItemKey.generate();
    const wraps = await shareItemKeyWithDevices(key, [bobPhone.publicKeys, bobLaptop.publicKeys], {
      itemId: 'n1',
      signer: author,
    });
    expect(wraps.map((w) => w.deviceId)).toEqual([bobPhone.id, bobLaptop.id]);
    for (const [device, { wrap }] of [
      [bobPhone, wraps[0]!],
      [bobLaptop, wraps[1]!],
    ] as const) {
      const opened = await openSharedItemKey(wrap, device, {
        itemId: 'n1',
        requireSignatureFrom: [author.publicKeys],
      });
      expect(opened.key.toBytes()).toEqual(key.toBytes());
      expect(opened.signer?.id).toBe(author.id);
    }
    expect(inspectEnvelope(wraps[0]!.wrap)).toMatchObject({
      kind: 'public-key-wrap',
      keyVersion: 1,
      recipientId: bobPhone.id,
    });
  });

  it('refuses a share signed by someone other than the author', async () => {
    const author = await DeviceKeys.generate();
    const server = await DeviceKeys.generate(); // e.g. a key the server made up
    const bob = await DeviceKeys.generate();
    const wrap = await shareItemKey(ItemKey.generate(), bob.publicKeys, {
      itemId: 'n1',
      signer: server,
    });
    await expectCryptoError(
      openSharedItemKey(wrap, bob, { itemId: 'n1', requireSignatureFrom: author.publicKeys }),
      'bad-signature',
    );
  });

  it('a share is bound to its item', async () => {
    const author = await DeviceKeys.generate();
    const bob = await DeviceKeys.generate();
    const wrap = await shareItemKey(ItemKey.generate(), bob.publicKeys, {
      itemId: 'n1',
      signer: author,
    });
    await expectCryptoError(
      openSharedItemKey(wrap, bob, { itemId: 'n2', requireSignatureFrom: author.publicKeys }),
      ['tampered', 'bad-signature'],
    );
  });

  it('a share rejects every single-bit change', async () => {
    const author = await DeviceKeys.generate();
    const bob = await DeviceKeys.generate();
    const wrap = await shareItemKey(ItemKey.generate(), bob.publicKeys, {
      itemId: 'n1',
      signer: author,
    });
    await expectEveryBitFlipRejected(wrap, (w) =>
      openSharedItemKey(w, bob, { itemId: 'n1', requireSignatureFrom: author.publicKeys }),
    );
  });

  it('revoking rotates the key: the removed person cannot read new edits, history stays readable', async () => {
    const ak = await AccountKey.generate();
    const author = await DeviceKeys.generate();
    const bob = await DeviceKeys.generate();
    const carol = await DeviceKeys.generate();
    const itemId = 'n1';

    // v1 shared with Bob and Carol.
    const k1 = ItemKey.generate();
    const version1 = await encryptItem(k1, { title: 'Plan', body: 'v1' }, { itemId, version: 1 });
    const bobWrap1 = await shareItemKey(k1, bob.publicKeys, { itemId, signer: author });
    const bobKey1 = (
      await openSharedItemKey(bobWrap1, bob, { itemId, requireSignatureFrom: author.publicKeys })
    ).key;
    expect((await decryptItem(bobKey1, version1, { itemId, version: 1 })).body).toBe('v1');

    // Bob is revoked: new key, re-wrapped for the owner and Carol only.
    const k2 = rotateItemKey(k1);
    const ownerWrap2 = await wrapItemKey(k2, ak, { itemId });
    const carolWrap2 = await shareItemKey(k2, carol.publicKeys, { itemId, signer: author });
    const previous = await wrapPreviousItemKey(k1, k2, { itemId });
    const version2 = await encryptItem(
      k2,
      { title: 'Plan', body: 'v2 secret' },
      { itemId, version: 2 },
    );

    // Bob's old key doesn't open the new version.
    await expectCryptoError(decryptItem(bobKey1, version2, { itemId, version: 2 }), 'wrong-key');
    // Carol reads the new version and, through the previous-key wrap, the old one.
    const carolKey2 = (
      await openSharedItemKey(carolWrap2, carol, {
        itemId,
        requireSignatureFrom: author.publicKeys,
      })
    ).key;
    expect(carolKey2.version).toBe(2);
    expect((await decryptItem(carolKey2, version2, { itemId, version: 2 })).body).toBe('v2 secret');
    const carolKey1 = await unwrapPreviousItemKey(previous, carolKey2, { itemId });
    expect((await decryptItem(carolKey1, version1, { itemId, version: 1 })).body).toBe('v1');
    // The owner gets k2 back from the account key.
    expect((await unwrapItemKey(ownerWrap2, ak, { itemId })).version).toBe(2);
    await expectEveryBitFlipRejected(previous, (w) => unwrapPreviousItemKey(w, k2, { itemId }));
  });

  it('a previous-key wrap only goes downwards', async () => {
    const k1 = ItemKey.generate();
    const k2 = rotateItemKey(k1);
    await expectCryptoError(wrapPreviousItemKey(k2, k1, { itemId: 'n1' }), 'malformed');
  });
});
