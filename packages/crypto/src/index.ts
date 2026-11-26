/**
 * @poolse/crypto — end-to-end encryption for personal data (Notes NT3,
 * encrypted sync ST6), on WebCrypto only. See the README for the design and
 * the threat model.
 */
export { PoolseCryptoError, type PoolseCryptoErrorCode, BlobConflictError } from './errors';

export {
  toBase64Url,
  fromBase64Url,
  toBase32,
  fromBase32,
  toHex,
  fromHex,
  constantTimeEqual,
} from './bytes';

export { checkCryptoSupport } from './subtle';

export {
  FORMAT_VERSION,
  Kind,
  Alg,
  type EnvelopeKind,
  type AlgorithmId,
  type AssociatedData,
  type EnvelopeInfo,
  encodeAssociatedData,
  padmeLength,
} from './format';

export { inspectEnvelope } from './inspect';

export {
  AccountKey,
  ItemKey,
  DeviceKeys,
  type DevicePublicKeys,
  type ExportDeviceKeysOptions,
  type ImportDeviceKeysOptions,
  rotateItemKey,
  devicePublicKeys,
  encodeDevicePublicKeys,
  decodeDevicePublicKeys,
  deviceFingerprint,
  sameDevice,
} from './keys';

export {
  WrapPurpose,
  type WrapPurposeId,
  type UnwrapResult,
  type AccountContext,
  type ItemContext,
  wrapAccountKeyForDevice,
  unwrapAccountKeyForDevice,
  checkPinnedAccountKey,
  wrapItemKey,
  unwrapItemKey,
  shareItemKey,
  shareItemKeyWithDevices,
  openSharedItemKey,
  wrapPreviousItemKey,
  unwrapPreviousItemKey,
} from './wrap';

export {
  type JsonValue,
  type ItemContent,
  type ItemAssociatedData,
  encryptItem,
  decryptItem,
  encryptBytes,
  decryptBytes,
} from './item';

export {
  DEFAULT_CHUNK_SIZE,
  MIN_CHUNK_SIZE,
  MAX_CHUNK_SIZE,
  ATTACHMENT_HEADER_LENGTH,
  type ByteSource,
  type AttachmentAssociatedData,
  type EncryptAttachmentOptions,
  encryptAttachment,
  decryptAttachment,
  encryptAttachmentBytes,
  decryptAttachmentBytes,
  encryptedAttachmentSize,
} from './attachment';

export {
  RecoveryKey,
  generateRecoveryKey,
  parseRecoveryKey,
  wrapAccountKeyWithRecoveryKey,
  unwrapAccountKeyWithRecoveryKey,
} from './recovery';

export {
  DEFAULT_REQUEST_MAX_AGE_MS,
  type PendingDeviceRequest,
  type DeviceRequest,
  type AcceptedDeviceGrant,
  createDeviceRequest,
  readDeviceRequest,
  approveDeviceRequest,
  acceptDeviceGrant,
} from './approval';

export {
  type BlobInfo,
  type BlobChange,
  type BlobLimits,
  type BlobListOptions,
  type BlobListPage,
  type BlobChangesPage,
  type BlobPrecondition,
  type BlobTransport,
  type RevisionStore,
  type EncryptedBlobStoreOptions,
  type SyncedBlob,
  type PutOptions,
  MemoryBlobTransport,
  EncryptedBlobStore,
} from './sync';

export {
  type BlobTransportErrorCode,
  type HttpBlobTransportOptions,
  BlobTransportError,
  createHttpBlobTransport,
  isValidBlobKey,
} from './http';

export {
  type NoteContent,
  type SealedNote,
  type NoteRecipient,
  type NoteShareWrap,
  type RotatedNote,
  noteAssociatedData,
  noteAttachmentAssociatedData,
  folderAssociatedData,
  sealNote,
  openNoteMeta,
  openNoteContent,
  envelopeKeyVersion,
  noteKeyForVersion,
  sealFolder,
  openFolderName,
  shareWrapsFor,
  rotateNoteKey,
  shareExpired,
  recoveryAuth,
  signForServer,
  deviceApprovalMessage,
  recoveryReplaceMessage,
  signedDeviceGrant,
  noteAsDocument,
} from './notes';

export { type SearchDocument, type SearchHit, NoteSearchIndex, searchWords } from './search';

export {
  type OutboxEntry,
  type OutboxStorage,
  type OutboxSendResult,
  type FlushOptions,
  type FlushResult,
  NoteOutbox,
  MemoryOutboxStorage,
} from './outbox';
