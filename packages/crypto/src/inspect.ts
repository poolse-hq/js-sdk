/**
 * Read an envelope's header without decrypting it — to route it, pick the
 * right key version, or tell the user an update is needed.
 */
import { ByteReader, toBase64Url } from './bytes';
import { PoolseCryptoError } from './errors';
import { type EnvelopeInfo, FORMAT_VERSION, Kind, MAGIC } from './format';

const NAMES: Record<number, EnvelopeInfo['kind']> = {
  [Kind.Item]: 'item',
  [Kind.KeyWrap]: 'key-wrap',
  [Kind.PublicKeyWrap]: 'public-key-wrap',
  [Kind.Attachment]: 'attachment',
  [Kind.DeviceRequest]: 'device-request',
  [Kind.DeviceGrant]: 'device-grant',
  [Kind.DevicePublicKeys]: 'device-public-keys',
  [Kind.SyncRecord]: 'sync-record',
  [Kind.DeviceSecret]: 'device-secret',
};

/**
 * Throws `malformed` for data this library didn't write and `unsupported`
 * for a newer format version. The values returned are unauthenticated until
 * the envelope is actually decrypted.
 */
export function inspectEnvelope(data: Uint8Array): EnvelopeInfo {
  const r = new ByteReader(data);
  if (r.remaining() < 4 || r.u8() !== MAGIC) {
    throw new PoolseCryptoError('malformed', 'Not poolse-crypto data');
  }
  const formatVersion = r.u8();
  if (formatVersion > FORMAT_VERSION) {
    throw new PoolseCryptoError(
      'unsupported',
      `Format version ${formatVersion} is newer than this library`,
    );
  }
  const kindByte = r.u8();
  const kind = NAMES[kindByte];
  if (!kind) throw new PoolseCryptoError('malformed', `Unknown kind ${kindByte}`);
  const info: EnvelopeInfo = { formatVersion, kind, alg: r.u8() };
  switch (kindByte) {
    case Kind.Item:
    case Kind.Attachment:
      info.keyVersion = r.u32();
      break;
    case Kind.KeyWrap:
      r.u8();
      info.keyVersion = r.u32();
      break;
    case Kind.PublicKeyWrap:
      r.u8();
      r.u8();
      info.keyVersion = r.u32();
      info.recipientId = toBase64Url(r.bytes(16));
      break;
    case Kind.SyncRecord:
      info.revision = r.u64();
      break;
  }
  return info;
}
