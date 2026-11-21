# Changelog

All notable changes to `@poolse/crypto` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org).

## [Unreleased]

### Added

- First release: end-to-end encryption for personal notes (NT3, NT5, NT8,
  NT10, NT15) and encrypted sync of your own data (ST6), on WebCrypto only
  (P-256 ECDH/ECDSA, HKDF-SHA-256, AES-256-GCM, HMAC-SHA-256). No dependencies.
- `DeviceKeys` (`generate`, `export`/`import` for the keychain, optionally
  wrapped with a 32-byte key), `DevicePublicKeys`, `encodeDevicePublicKeys` /
  `decodeDevicePublicKeys`, `deviceFingerprint`, `sameDevice`.
- `AccountKey`, `wrapAccountKeyForDevice` / `unwrapAccountKeyForDevice`
  (optionally signed; `requireSignatureFrom`).
- `ItemKey`, `rotateItemKey`, `wrapItemKey` / `unwrapItemKey`,
  `shareItemKey` / `shareItemKeyWithDevices` / `openSharedItemKey` (signed by
  the sharer), `wrapPreviousItemKey` / `unwrapPreviousItemKey`.
- `encryptItem` / `decryptItem` (title, body, metadata; padded) and
  `encryptBytes` / `decryptBytes`, bound to associated data (item id,
  version, …).
- Chunked attachments: `encryptAttachment` / `decryptAttachment` (streams),
  `encryptAttachmentBytes` / `decryptAttachmentBytes`,
  `encryptedAttachmentSize`.
- Recovery key: `generateRecoveryKey`, `parseRecoveryKey` (checksum),
  `wrapAccountKeyWithRecoveryKey` / `unwrapAccountKeyWithRecoveryKey`.
- QR device approval: `createDeviceRequest`, `readDeviceRequest`,
  `approveDeviceRequest`, `acceptDeviceGrant`.
- `EncryptedBlobStore` over a pluggable `BlobTransport` (`get`, `put`,
  `delete`, `update`, JSON variants, `list`, `getByKey`, tombstones, `purge`),
  with If-Match conflicts (`BlobConflictError`) and rollback detection
  (`RevisionStore`); `MemoryBlobTransport`. `list` passes `prefix`, and
  `changes` reads a change feed (writes and deletions since a cursor).
- `createHttpBlobTransport({ apiUrl, getToken, fetch? })` for the poolse
  server's `/v1/me/blobs` and `/v1/me/blob-changes` (ETag versions, If-Match /
  If-None-Match, 412/409 → `BlobConflictError`); `BlobTransportError` with
  codes `too_large`, `quota_exceeded`, `sync_disabled`, `rate_limited`
  (`retryAfterMs`), `invalid_key`, `unauthorized`, …; `isValidBlobKey`.
- Versioned envelope format 1 with algorithm ids, `inspectEnvelope`,
  `PoolseCryptoError` codes, `checkCryptoSupport`, base64url/base32/hex helpers.
