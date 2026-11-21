import { describe, expect, it } from 'vitest';
import {
  AccountKey,
  DeviceKeys,
  ItemKey,
  acceptDeviceGrant,
  approveDeviceRequest,
  createDeviceRequest,
  decryptItem,
  deviceFingerprint,
  encryptItem,
  fromBase32,
  generateRecoveryKey,
  parseRecoveryKey,
  readDeviceRequest,
  toBase32,
  unwrapAccountKeyForDevice,
  unwrapAccountKeyWithRecoveryKey,
  unwrapItemKey,
  wrapAccountKeyWithRecoveryKey,
  wrapItemKey,
} from '../src';
import { expectCryptoError, expectEveryBitFlipRejected } from './helpers';

const account = { accountId: 'acct-1' };

describe('recovery key', () => {
  it('displays as 8 groups of 4 and parses back however it is typed', async () => {
    const rk = await generateRecoveryKey();
    const shown = rk.toDisplayString();
    expect(shown).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    expect((await parseRecoveryKey(shown)).id).toBe(rk.id);
    expect((await parseRecoveryKey(shown.toLowerCase().replace(/-/g, ' '))).id).toBe(rk.id);
    expect((await parseRecoveryKey(`  ${shown.replace(/-/g, '')}\n`)).id).toBe(rk.id);
    const withLookalikes = shown.replace(/0/g, 'O').replace(/1/g, 'l');
    expect((await parseRecoveryKey(withLookalikes)).id).toBe(rk.id);
  });

  it('never prints the secret by accident', async () => {
    const rk = await generateRecoveryKey();
    expect(String(rk)).not.toContain(rk.toDisplayString().slice(0, 9));
    expect(JSON.stringify(rk)).toBe(JSON.stringify({ id: rk.id }));
  });

  it('catches any single-character typo with the checksum', async () => {
    const shown = (await generateRecoveryKey()).toDisplayString().replace(/-/g, '');
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    for (let i = 0; i < shown.length; i++) {
      const other = alphabet[(alphabet.indexOf(shown[i]!) + 1) % 32]!;
      const typo = shown.slice(0, i) + other + shown.slice(i + 1);
      await expectCryptoError(parseRecoveryKey(typo), 'checksum');
    }
    await expectCryptoError(parseRecoveryKey(shown.slice(1)), 'malformed');
    await expectCryptoError(parseRecoveryKey(shown.slice(0, -1) + 'U'), 'malformed');
  });

  it('unwraps the account key after losing every device', async () => {
    const ak = await AccountKey.generate();
    const rk = await generateRecoveryKey();
    const wrap = await wrapAccountKeyWithRecoveryKey(ak, rk, account);
    const note = ItemKey.generate();
    const noteWrap = await wrapItemKey(note, ak, { itemId: 'n1' });
    const sealed = await encryptItem(note, { title: 'Diary', body: 'secret' }, { itemId: 'n1' });

    // A new device, the user types the key in.
    const typed = await parseRecoveryKey(rk.toDisplayString());
    const recovered = await unwrapAccountKeyWithRecoveryKey(wrap, typed, account);
    expect(recovered.id).toBe(ak.id);
    const key = await unwrapItemKey(noteWrap, recovered, { itemId: 'n1' });
    expect((await decryptItem(key, sealed, { itemId: 'n1' })).body).toBe('secret');
  });

  it('refuses the wrong recovery key, another account, and any change', async () => {
    const ak = await AccountKey.generate();
    const rk = await generateRecoveryKey();
    const wrap = await wrapAccountKeyWithRecoveryKey(ak, rk, account);
    await expectCryptoError(
      unwrapAccountKeyWithRecoveryKey(wrap, await generateRecoveryKey(), account),
      'wrong-key',
    );
    await expectCryptoError(
      unwrapAccountKeyWithRecoveryKey(wrap, rk, { accountId: 'acct-2' }),
      'tampered',
    );
    await expectEveryBitFlipRejected(wrap, (w) => unwrapAccountKeyWithRecoveryKey(w, rk, account));
  });
});

describe('device approval by QR', () => {
  async function setup() {
    const ak = await AccountKey.generate();
    const laptop = await DeviceKeys.generate(); // already has the account key
    const phone = await DeviceKeys.generate(); // new
    return { ak, laptop, phone };
  }

  it('approves a new device end to end', async () => {
    const { ak, laptop, phone } = await setup();
    const { qr, pending } = await createDeviceRequest(phone);
    expect(qr).toMatch(/^[0-9A-Z]+$/); // QR alphanumeric mode
    expect(qr.length).toBeLessThan(360);

    const request = await readDeviceRequest(qr);
    expect(request.device.id).toBe(phone.id);
    expect(await deviceFingerprint(request.device)).toBe(await deviceFingerprint(phone.publicKeys));

    const grant = await approveDeviceRequest(request, laptop, ak, account);
    const accepted = await acceptDeviceGrant(grant, pending, phone, account);
    expect(accepted.accountKey.id).toBe(ak.id);
    expect(accepted.approver.id).toBe(laptop.id);
    // The wrap the phone keeps works on its own later.
    const later = await unwrapAccountKeyForDevice(accepted.accountKeyWrap, phone, {
      ...account,
      requireSignatureFrom: accepted.approver,
    });
    expect(later.key.id).toBe(ak.id);
  });

  it('rejects any change to the QR code', async () => {
    const { phone } = await setup();
    const { qr } = await createDeviceRequest(phone);
    const bytes = fromBase32(qr);
    await expectEveryBitFlipRejected(bytes, (b) => readDeviceRequest(toBase32(b)));
  });

  it('rejects expired and future requests', async () => {
    const { phone } = await setup();
    const now = Date.UTC(2026, 10, 21, 12, 0, 0);
    const { qr } = await createDeviceRequest(phone, { now });
    await expect(readDeviceRequest(qr, { now: now + 60_000 })).resolves.toBeTruthy();
    await expectCryptoError(readDeviceRequest(qr, { now: now + 11 * 60_000 }), 'expired');
    await expectCryptoError(readDeviceRequest(qr, { now: now - 5 * 60_000 }), 'expired');
    await expect(
      readDeviceRequest(qr, { now: now + 30 * 60_000, maxAgeMs: 3_600_000 }),
    ).resolves.toBeTruthy();
  });

  it('rejects any change to the grant', async () => {
    const { ak, laptop, phone } = await setup();
    const { qr, pending } = await createDeviceRequest(phone);
    const grant = await approveDeviceRequest(await readDeviceRequest(qr), laptop, ak, account);
    await expectEveryBitFlipRejected(grant, (g) => acceptDeviceGrant(g, pending, phone, account));
  });

  it('a server that never saw the QR code cannot forge a grant', async () => {
    const { phone } = await setup();
    const { pending } = await createDeviceRequest(phone);
    // The server knows the phone's public keys (from its directory) and makes
    // its own request-shaped approval with a key it controls.
    const serverDevice = await DeviceKeys.generate();
    const serverKey = await AccountKey.generate();
    const { qr: fakeQr } = await createDeviceRequest(phone);
    const forged = await approveDeviceRequest(
      await readDeviceRequest(fakeQr),
      serverDevice,
      serverKey,
      account,
    );
    await expectCryptoError(acceptDeviceGrant(forged, pending, phone, account), 'tampered');
  });

  it('a grant is bound to the account', async () => {
    const { ak, laptop, phone } = await setup();
    const { qr, pending } = await createDeviceRequest(phone);
    const grant = await approveDeviceRequest(await readDeviceRequest(qr), laptop, ak, account);
    await expectCryptoError(
      acceptDeviceGrant(grant, pending, phone, { accountId: 'acct-2' }),
      'tampered',
    );
  });

  it('a stale pending request is refused', async () => {
    const { ak, laptop, phone } = await setup();
    const now = Date.now();
    const { qr, pending } = await createDeviceRequest(phone, { now });
    const grant = await approveDeviceRequest(
      await readDeviceRequest(qr, { now }),
      laptop,
      ak,
      account,
    );
    await expectCryptoError(
      acceptDeviceGrant(grant, pending, phone, { ...account, now: now + 20 * 60_000 }),
      'expired',
    );
  });

  it('only the requesting device can accept, and a device cannot approve itself', async () => {
    const { ak, laptop, phone } = await setup();
    const { qr, pending } = await createDeviceRequest(phone);
    const request = await readDeviceRequest(qr);
    const grant = await approveDeviceRequest(request, laptop, ak, account);
    await expectCryptoError(acceptDeviceGrant(grant, pending, laptop, account), 'wrong-key');
    await expectCryptoError(approveDeviceRequest(request, phone, ak, account), 'malformed');
  });
});
