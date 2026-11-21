/**
 * Approving a new device from one the user already has (NT10).
 *
 * 1. The new device makes its keys and shows a QR code
 *    (`createDeviceRequest`): its public keys, the time, and a random
 *    16-byte secret, signed with its own signing key. Kind 5:
 *
 *      header(4) | createdAt u32 (unix s) | secret(16) |
 *      encryptionPublic(65) | signingPublic(65) | signature(64)
 *
 * 2. The existing device scans it (`readDeviceRequest`), shows the new
 *    device's fingerprint, and on approval wraps the account key to it and
 *    authenticates the result with the secret (`approveDeviceRequest`). The
 *    grant goes through the server. Kind 6:
 *
 *      header(4) | requestHash(32) | approverEncryption(65) |
 *      approverSigning(65) | u16 len | accountKeyWrap | hmac(32)
 *
 * 3. The new device checks the grant against the secret it kept in memory
 *    and unwraps the account key (`acceptDeviceGrant`).
 *
 * The secret only ever travels through the QR code, from screen to camera.
 * So the server, which carries the grant, can't forge one (it would need the
 * secret) and can't swap in its own keys at either end: the existing device
 * learns the new one's keys from the QR code, and the new device learns the
 * approver's keys from the authenticated grant.
 */
import {
  type Bytes,
  ByteReader,
  ByteWriter,
  concat,
  constantTimeEqual,
  fromBase32,
  toBase32,
} from './bytes';
import { PoolseCryptoError } from './errors';
import { Alg, DOMAIN, Kind, encodeAssociatedData, readHeader, writeHeader } from './format';
import {
  type AccountKey,
  type DeviceKeys,
  type DevicePublicKeys,
  devicePrivate,
  devicePublicKeys,
  sameDevice,
} from './keys';
import {
  ECDSA_SIGNATURE_LENGTH,
  P256_PUBLIC_LENGTH,
  ecdsaSign,
  ecdsaVerify,
  hkdf,
  hmac,
  hmacVerify,
  importP256Public,
  label,
  randomBytes,
  sha256,
} from './subtle';
import { type AccountContext, unwrapAccountKeyForDevice, wrapAccountKeyForDevice } from './wrap';

const SECRET_LENGTH = 16;
const HASH_LENGTH = 32;
const MAC_LENGTH = 32;
/** Requests older than this are refused (and ones further than 2 min in the future). */
export const DEFAULT_REQUEST_MAX_AGE_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 2 * 60 * 1000;

const requestSecrets = new WeakMap<object, { secret: Bytes; hash: Bytes }>();

/** Kept in memory on the new device until the grant arrives. Never persist or send it. */
export interface PendingDeviceRequest {
  readonly device: DevicePublicKeys;
  readonly createdAt: Date;
}

/** What the approving device learns from the QR code. */
export interface DeviceRequest {
  readonly device: DevicePublicKeys;
  readonly createdAt: Date;
}

function signatureInput(body: Uint8Array): Bytes {
  return concat(label(DOMAIN, 'sig/device-request'), body);
}

async function grantMacKey(secret: Uint8Array, requestHash: Uint8Array): Promise<Bytes> {
  return hkdf(secret, requestHash, label(DOMAIN, 'key/device-grant'));
}

function checkAge(createdAtMs: number, now: number, maxAgeMs: number): void {
  if (createdAtMs > now + CLOCK_SKEW_MS || now - createdAtMs > maxAgeMs) {
    throw new PoolseCryptoError('expired', 'This device request has expired; make a new QR code');
  }
}

/**
 * On the new device: the QR code text (uppercase base32, which fits a QR
 * code's alphanumeric mode, ~350 characters) and the pending request to keep
 * in memory.
 */
export async function createDeviceRequest(
  device: DeviceKeys,
  options: { now?: number } = {},
): Promise<{ qr: string; pending: PendingDeviceRequest }> {
  const createdAt = Math.floor((options.now ?? Date.now()) / 1000);
  const secret = randomBytes(SECRET_LENGTH);
  const body = writeHeader(new ByteWriter(), Kind.DeviceRequest, Alg.P256)
    .u32(createdAt)
    .bytes(secret)
    .bytes(device.publicKeys.encryption)
    .bytes(device.publicKeys.signing)
    .finish();
  const signature = await ecdsaSign(devicePrivate(device).signing, signatureInput(body));
  const request = concat(body, signature);
  const pending: PendingDeviceRequest = {
    device: device.publicKeys,
    createdAt: new Date(createdAt * 1000),
  };
  requestSecrets.set(pending, { secret, hash: await sha256(request) });
  return { qr: toBase32(request), pending };
}

/**
 * On the existing device: read and check a scanned QR code. Show
 * `deviceFingerprint(request.device)` and ask the user before approving.
 */
export async function readDeviceRequest(
  qr: string,
  options: { now?: number; maxAgeMs?: number } = {},
): Promise<DeviceRequest> {
  const bytes = fromBase32(qr.trim());
  const r = new ByteReader(bytes);
  readHeader(r, Kind.DeviceRequest, [Alg.P256]);
  const createdAt = r.u32();
  const secret = r.bytes(SECRET_LENGTH);
  const encryption = r.bytes(P256_PUBLIC_LENGTH);
  const signing = r.bytes(P256_PUBLIC_LENGTH);
  const body = r.consumed();
  const signature = r.bytes(ECDSA_SIGNATURE_LENGTH);
  r.end();
  const verifier = await importP256Public('ecdsa', signing);
  if (!(await ecdsaVerify(verifier, signature, signatureInput(body)))) {
    throw new PoolseCryptoError('bad-signature', 'The device request signature is invalid');
  }
  checkAge(
    createdAt * 1000,
    options.now ?? Date.now(),
    options.maxAgeMs ?? DEFAULT_REQUEST_MAX_AGE_MS,
  );
  const request: DeviceRequest = {
    device: await devicePublicKeys(encryption, signing),
    createdAt: new Date(createdAt * 1000),
  };
  requestSecrets.set(request, { secret, hash: await sha256(bytes) });
  return request;
}

/**
 * On the existing device, after the user approved: the grant to send to the
 * new device through the server.
 */
export async function approveDeviceRequest(
  request: DeviceRequest,
  approver: DeviceKeys,
  accountKey: AccountKey,
  options: AccountContext,
): Promise<Uint8Array> {
  const state = requestSecrets.get(request);
  if (!state)
    throw new PoolseCryptoError('malformed', 'Pass the request returned by readDeviceRequest');
  if (sameDevice(request.device, approver.publicKeys)) {
    throw new PoolseCryptoError('malformed', 'A device cannot approve itself');
  }
  const wrap = await wrapAccountKeyForDevice(accountKey, request.device, {
    accountId: options.accountId,
    signer: approver,
  });
  const body = writeHeader(new ByteWriter(), Kind.DeviceGrant, Alg.HmacSha256)
    .bytes(state.hash)
    .bytes(approver.publicKeys.encryption)
    .bytes(approver.publicKeys.signing)
    .bytes16(wrap)
    .finish();
  const mac = await hmac(
    await grantMacKey(state.secret, state.hash),
    macInput(body, options.accountId),
  );
  return concat(body, mac);
}

function macInput(body: Uint8Array, accountId: string): Bytes {
  return concat(
    label(DOMAIN, 'mac/device-grant'),
    body,
    encodeAssociatedData('device-grant', { accountId }),
  );
}

export interface AcceptedDeviceGrant {
  accountKey: AccountKey;
  /** The device that approved this one. */
  approver: DevicePublicKeys;
  /** This device's own wrap of the account key — store it to unwrap at the next start. */
  accountKeyWrap: Uint8Array;
}

/** On the new device: check the grant and recover the account key. */
export async function acceptDeviceGrant(
  grant: Uint8Array,
  pending: PendingDeviceRequest,
  device: DeviceKeys,
  options: AccountContext & { now?: number; maxAgeMs?: number },
): Promise<AcceptedDeviceGrant> {
  const state = requestSecrets.get(pending);
  if (!state)
    throw new PoolseCryptoError('malformed', 'Pass the pending request from createDeviceRequest');
  if (!sameDevice(pending.device, device.publicKeys)) {
    throw new PoolseCryptoError('wrong-key', 'This request was made by a different device');
  }
  checkAge(
    pending.createdAt.getTime(),
    options.now ?? Date.now(),
    options.maxAgeMs ?? DEFAULT_REQUEST_MAX_AGE_MS,
  );
  const r = new ByteReader(grant);
  readHeader(r, Kind.DeviceGrant, [Alg.HmacSha256]);
  const requestHash = r.bytes(HASH_LENGTH);
  const approverEncryption = r.bytes(P256_PUBLIC_LENGTH);
  const approverSigning = r.bytes(P256_PUBLIC_LENGTH);
  const wrap = r.bytes16();
  const body = r.consumed();
  const mac = r.bytes(MAC_LENGTH);
  r.end();
  if (!constantTimeEqual(requestHash, state.hash)) {
    throw new PoolseCryptoError('tampered', 'This grant answers a different request');
  }
  const macKey = await grantMacKey(state.secret, state.hash);
  if (!(await hmacVerify(macKey, macInput(body, options.accountId), mac))) {
    throw new PoolseCryptoError('tampered', 'The device grant is not authentic');
  }
  const approver = await devicePublicKeys(approverEncryption, approverSigning);
  const { key } = await unwrapAccountKeyForDevice(wrap, device, {
    accountId: options.accountId,
    requireSignatureFrom: approver,
  });
  return { accountKey: key, approver, accountKeyWrap: wrap };
}
