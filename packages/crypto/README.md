# @poolse/crypto

End-to-end encryption for poolse personal data: personal notes (NT3), shared
notes (NT5, NT15), versions (NT8), devices and recovery (NT10), and encrypted
sync of your own data between your devices (ST6). The desktop and mobile apps
use this one library, so there is one implementation to review.

The server only ever stores ciphertext. Keys are made and kept on the user's
devices.

```bash
npm install @poolse/crypto
```

No dependencies. Every primitive comes from the platform's WebCrypto
(`globalThis.crypto.subtle`): browsers, Tauri webviews, Node 20+, and React
Native with a WebCrypto polyfill (see [React Native](#react-native)).

## Keys

| Key           | What it is                                                                                                                                                        | Where it lives                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `DeviceKeys`  | One per device: a P-256 ECDH pair (others wrap keys to it) and a P-256 ECDSA pair (it signs what it wraps and approves). Made on the device, never sent anywhere. | The OS keychain / Keystore / Secure Enclave-backed item, as the bytes from `export()`.                     |
| `AccountKey`  | The user's notes key: 256 random bits.                                                                                                                            | On the server, only wrapped: once per device (`wrapAccountKeyForDevice`) and once per recovery key.        |
| `ItemKey`     | One per note (or other item): 256 random bits with a version that goes up on every rotation.                                                                      | On the server, only wrapped: under the account key for the owner, and to each recipient device for shares. |
| `RecoveryKey` | 128 random bits the user writes down, shown as `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`.                                                                         | With the user (paper, password manager). The server keeps the account key wrapped under it.                |

```
RecoveryKey ──wraps──┐
DeviceKeys ──wraps──► AccountKey ──wraps──► ItemKey ──encrypts──► title, body, metadata, attachments, versions
                       └──derives──► sync keys (ST6)         ▲
recipient DeviceKeys ◄──signed share wraps────────────────────┘
```

## Usage

### A new account (first device)

```ts
import {
  DeviceKeys,
  AccountKey,
  generateRecoveryKey,
  wrapAccountKeyForDevice,
  wrapAccountKeyWithRecoveryKey,
  encodeDevicePublicKeys,
} from '@poolse/crypto';

const device = await DeviceKeys.generate();
await keychain.set('poolse.device', await device.export()); // the app stores the bytes

const accountKey = await AccountKey.generate();
const recoveryKey = await generateRecoveryKey();
showOnce(recoveryKey.toDisplayString()); // make the user save it

await api.putDevice({
  id: device.id,
  publicKeys: encodeDevicePublicKeys(device.publicKeys), // for the key directory
  accountKeyWrap: await wrapAccountKeyForDevice(accountKey, device.publicKeys, {
    accountId,
    signer: device,
  }),
});
await api.putRecovery({
  id: recoveryKey.id,
  accountKeyWrap: await wrapAccountKeyWithRecoveryKey(accountKey, recoveryKey, { accountId }),
});
```

At every start: `DeviceKeys.import(await keychain.get('poolse.device'))`, then
`unwrapAccountKeyForDevice(wrap, device, { accountId })`.

### Notes

```ts
import { ItemKey, encryptItem, decryptItem, wrapItemKey, unwrapItemKey } from '@poolse/crypto';

const key = ItemKey.generate();
const envelope = await encryptItem(
  key,
  { title: 'Plan', body: editorDoc, metadata: { tags: ['work'] } },
  { itemId: note.id, version: 4 }, // associated data
);
const keyWrap = await wrapItemKey(key, accountKey, { itemId: note.id });

// Later, on any of the user's devices:
const k = await unwrapItemKey(keyWrap, accountKey, { itemId: note.id });
const content = await decryptItem(k, envelope, { itemId: note.id, version: 4 });
```

The associated data is not stored in the envelope; it must be supplied again to
decrypt. Bind every value that says where the ciphertext belongs (item id,
version number), so the server can't swap two notes' ciphertexts or serve an old
version as a new one. `encryptBytes` / `decryptBytes` do the same for small raw
values (an encrypted folder or tag name).

For version history (NT8), encrypt each version with `version` in the
associated data. Use the item key the version was written with:
`inspectEnvelope(envelope).keyVersion` says which.

### Attachments (streamed)

```ts
import { encryptAttachment, decryptAttachment, encryptedAttachmentSize } from '@poolse/crypto';

const ad = { itemId: note.id, attachmentId };
const sealed = encryptAttachment(
  key,
  file /* Blob, ReadableStream, Uint8Array, (async) iterable */,
  ad,
);
await upload(sealed, { contentLength: encryptedAttachmentSize(file.size) });

for await (const chunk of decryptAttachment(key, downloadStream, ad)) write(chunk);
// Only a loop that finishes without throwing proves the file is complete.
```

Files are cut into 64 KiB chunks (`chunkSize` from 16 bytes to 16 MiB), each
authenticated, with the order and the final chunk bound in (STREAM). Truncating,
reordering, dropping or appending chunks fails. `encryptAttachmentBytes` /
`decryptAttachmentBytes` work on whole byte arrays. Encrypted attachments are
opaque to the server, so it can't make previews or thumbnails.

### Sharing and revoking (NT5, NT15)

```ts
import {
  shareItemKeyWithDevices,
  openSharedItemKey,
  rotateItemKey,
  wrapPreviousItemKey,
} from '@poolse/crypto';

// Share: wrap the note key to every device of every recipient, signed by this device.
const wraps = await shareItemKeyWithDevices(key, bobDevices, { itemId: note.id, signer: device });

// Bob's device opens it, checking it was signed by one of the author's devices.
const { key: shared } = await openSharedItemKey(wrap, bobDevice, {
  itemId: note.id,
  requireSignatureFrom: authorDevices, // from the key directory
});

// Revoke (or a share expires): new key, re-encrypt, re-wrap for who's left.
const next = rotateItemKey(key); // version + 1
const envelope2 = await encryptItem(next, content, { itemId: note.id, version: 5 });
const ownerWrap = await wrapItemKey(next, accountKey, { itemId: note.id });
const remaining = await shareItemKeyWithDevices(next, carolDevices, {
  itemId: note.id,
  signer: device,
});
const history = await wrapPreviousItemKey(key, next, { itemId: note.id }); // older versions stay readable
```

Groups are shares to each member's devices. The removed person keeps what they
already decrypted; they can't read anything written after the rotation. The app
should say so ("Ana may have kept a copy of what she has already seen").

### A new device (NT10)

By QR code from a device the user already has:

```ts
import {
  createDeviceRequest,
  readDeviceRequest,
  approveDeviceRequest,
  acceptDeviceGrant,
  deviceFingerprint,
} from '@poolse/crypto';

// New device
const phone = await DeviceKeys.generate();
const { qr, pending } = await createDeviceRequest(phone); // show `qr` as a QR code; keep `pending` in memory

// Existing device, after scanning
const request = await readDeviceRequest(scanned); // checks the signature and age (10 min)
confirm(`Approve this device? ${await deviceFingerprint(request.device)}`);
const grant = await approveDeviceRequest(request, laptop, accountKey, { accountId });
await api.sendDeviceGrant(request.device.id, grant);

// New device, when the grant arrives
const { accountKey, accountKeyWrap } = await acceptDeviceGrant(grant, pending, phone, {
  accountId,
});
```

The QR code carries a 16-byte secret the server never sees, and the grant is
authenticated with it: the server that relays the grant can neither forge one
nor substitute its own keys at either end.

Or with the recovery key:

```ts
const rk = await parseRecoveryKey(typed); // ignores case, spaces, hyphens; O→0, I/L→1; `checksum` error on a typo
const accountKey = await unwrapAccountKeyWithRecoveryKey(recoveryWrap, rk, { accountId });
```

Either way the new device then stores its own `wrapAccountKeyForDevice` wrap.

### Encrypted sync of your own data (ST6)

```ts
import { EncryptedBlobStore } from '@poolse/crypto';

const store = new EncryptedBlobStore({ transport, accountKey, namespace: 'settings', revisions });
await store.putJson('layout', { sidebar: 'collapsed' });
const layout = await store.getJson('layout');

// Read, change, write; retried when another device wrote first.
await store.updateJson<string[]>('pinned', (pins) => [...(pins ?? []), channelId]);
```

- **Names are hidden.** The blob key is an HMAC of the namespace and name under
  a key derived from the account key (`store.blobKey(name)`); the name itself
  travels inside the ciphertext. `list()` pages through blob keys; read each with
  `getByKey`.
- **Conflicts.** Every write is conditional: `If-Match` the version last read or
  written, or `If-None-Match: *` for a new blob. A stale write throws
  `BlobConflictError`; `update` / `updateJson` re-read and retry.
- **Rollback.** Each record carries an authenticated revision that goes up by
  one per write. Pass a persistent `revisions` store (IndexedDB, AsyncStorage, a
  file) and a server serving an older record is refused with `rollback`, also
  across restarts.
- **Deletes** write an authenticated tombstone (`delete`), so the revision keeps
  counting; `purge` removes the blob for real but can't be told apart from a
  server deleting it.

#### The transport

Against a poolse server, use the HTTP transport (plain `fetch`, no
`@poolse/sdk` needed):

```ts
import { createHttpBlobTransport, EncryptedBlobStore } from '@poolse/crypto';

const transport = createHttpBlobTransport({
  apiUrl: 'https://chat.example.com', // the poolse server, without /v1
  getToken: () => client.getToken(), // the signed-in user's token (Bearer)
  // fetch: customFetch,             // defaults to globalThis.fetch
});
const store = new EncryptedBlobStore({
  transport,
  accountKey,
  namespace: 'settings',
  keyPrefix: 'st6.',
});

// Pick up other devices' changes: keep the cursor between runs.
const { changes, cursor } = await store.changes({ cursor: saved });
for (const c of changes) {
  const blob = await store.getByKey(c.key); // null when deleted
}
```

| Call                   | Request                                                                        | Result                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `get(key)`             | `GET /v1/me/blobs/:key`                                                        | bytes and the `ETag` version; `404` → `null`                                                                                  |
| `put(key, data, cond)` | `PUT /v1/me/blobs/:key`, octet-stream, `If-Match: "<v>"` or `If-None-Match: *` | the new version (`ETag`, else the JSON `version`); `412`/`409` → `BlobConflictError`                                          |
| `delete(key, cond)`    | `DELETE /v1/me/blobs/:key`, `If-Match` if given                                | `204`; `412`/`409` → `BlobConflictError`; `404` → done without `If-Match`, `BlobConflictError` with it                        |
| `list(opts)`           | `GET /v1/me/blobs?prefix=&cursor=&limit=`                                      | `{blobs, cursor, limits}` (`cursor` `null` on the last page)                                                                  |
| `changes(opts)`        | `GET /v1/me/blob-changes?cursor=&limit=`                                       | `{changes: [{key, version, size, updatedAt, deleted}], cursor}` oldest first; the cursor comes back even when nothing changed |

Versions are the `ETag` without quotes. Any other failure throws
`BlobTransportError` with a `code`: `too_large` / `quota_exceeded` (413),
`sync_disabled` (403, the workspace turned encrypted sync off), `forbidden`
(other 403), `rate_limited` (429, with `retryAfterMs` from `Retry-After`),
`invalid_key` (422, or refused before sending), `unauthorized` (401 even after
asking `getToken` once more), `not_found`, `server` (5xx), `network` (no
response), `bad_response`, `http`; plus `status`, `serverCode` and
`retryable`. Nothing is retried automatically except that one new token after a 401.

Keys are 1–128 of `a–z 0–9 .`, not starting or ending with `.`, no `..`
(`isValidBlobKey`). The store's keys are 32 lowercase base32 characters plus
your `keyPrefix`, so keep the prefix to those characters too. The server allows
25 MiB per blob, 1 GiB and 10 000 blobs per user by default (`list().limits`).

In a browser or webview on another origin, the server must expose `ETag`
(`Access-Control-Expose-Headers`), or `get` fails with `bad_response`.

Any other backend works too: implement `BlobTransport` (`get`, `put`,
`delete`, `list`, optional `changes`). `MemoryBlobTransport` is an in-memory
one for tests.

## Format

Everything the library writes is a binary envelope (base64url it with
`toBase64Url` for JSON APIs) that starts with the same four bytes:

| Byte | Meaning                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | `0x70` magic                                                                                                                                      |
| 1    | format version, `1`                                                                                                                               |
| 2    | kind: 1 item, 2 key wrap, 3 public-key wrap, 4 attachment, 5 device request, 6 device grant, 7 device public keys, 8 sync record, 9 device secret |
| 3    | algorithm suite: 0 none, 1 AES-256-GCM + HKDF-SHA-256, 2 P-256 (ECDH + HKDF + AES-GCM, ECDSA), 3 HMAC-SHA-256                                     |

The header and every field up to the ciphertext are part of the AES-GCM
associated data, together with the caller's associated data. A newer format
version or an unknown algorithm is refused with `unsupported`, so an old app
fails loudly rather than misreading new data. `inspectEnvelope` reads the
header (kind, key version, recipient, revision) without decrypting.

The layouts are documented at the top of each source file (`item.ts`,
`wrap.ts`, `attachment.ts`, `approval.ts`, `sync.ts`, `keys.ts`).
`test/vectors.ts` holds frozen envelopes of format 1 that every build must
still decrypt.

### Algorithms, and why

- **P-256 ECDH and ECDSA**, not X25519/Ed25519. P-256 is the curve every
  WebCrypto implementation supports: all browsers, Safari and WKWebView
  (Tauri on macOS), WebKitGTK, Node, and the React Native polyfills. X25519
  and Ed25519 arrived in WebCrypto only recently and unevenly. Signatures are
  raw r‖s (64 bytes).
- **Public-key wrapping** is ECIES: a fresh ephemeral P-256 key per wrap, HKDF
  over the shared secret with both public keys as salt and the purpose in the
  info, then AES-256-GCM.
- **AES-256-GCM** with random 96-bit IVs for content and wraps. Each item key
  encrypts only that item's versions, far below GCM's 2³² messages per key.
  Attachments use a fresh HKDF-derived key per file and counter nonces.
- **HKDF-SHA-256** for every derived key, each on its own `poolse-crypto/v1/…`
  label.
- **Key check values**: each envelope stores a 16-byte value derived from the
  key on a separate HKDF branch. It turns "wrong key" into its own error and
  commits the envelope to one key, which AES-GCM on its own doesn't do.
- **Padding**: item and sync plaintexts are padded (Padmé) so stored sizes
  only roughly reflect the content (at most ~12% overhead).
- **Recovery key**: 128 random bits, not a password, so no password KDF
  (PBKDF2/Argon2) is needed: 2¹²⁸ guesses is out of reach at any hashing
  cost. A 32-bit checksum catches typos.

## Security notes

### Threat model

The server, the workspace admin, and anyone who gets a copy of the database
or the backups are treated as adversaries for personal notes and synced data.
They can read, change, delete, replay and reorder anything stored, and decide
what each client receives.

Protected against them:

- **Confidentiality** of titles, bodies, metadata, attachments, versions,
  synced blobs and blob names.
- **Integrity**: any change to a ciphertext, a wrap, a QR code or a grant is
  detected; so is moving a ciphertext to another item, version, attachment,
  account or blob key (associated data).
- **Forged shares**: `openSharedItemKey` requires a signature from one of the
  author's devices.
- **Forged device approvals**: grants are authenticated with a secret that
  only goes through the QR code.
- **Rollback of synced blobs**, when the app keeps a persistent
  `RevisionStore`.

### What the server still sees

- That a user has personal notes or synced data, how many items, blobs,
  attachments and versions, and their approximate sizes (padded, not hidden).
- When each was created, changed or deleted, by which session, from which IP.
- Who shares with whom, how many devices each user has, and when a device was
  added or a share revoked.
- Item ids, attachment ids, key versions and blob keys (opaque, but stable).
- Device public keys and fingerprints.

### What is not protected

- **The key directory is trusted.** A device learns other people's device
  public keys from the server. A malicious server could list a key of its own
  for a recipient (so a share would be wrapped to it) or for an author (so a
  forged share would verify). The app should show device fingerprints
  (`deviceFingerprint`) and let people compare them for sensitive shares, and
  should warn when someone's device list changes. Own devices are added only by
  QR approval or the recovery key, which don't trust the directory.
- **Withholding and forking.** The server can withhold updates, pretend
  something was deleted (`purge`), or show two devices different histories.
  Revisions catch rollback only per blob and only against what a device has
  already seen.
- **Notes item rollback.** For notes, binding the version number into the
  associated data stops one version being served as another, but the app has to
  remember the newest version it has seen to notice an old one being served as
  current.
- **Compromised devices.** Anyone who unlocks a device, or malware on it,
  reads everything that device can. Removing a device from the account doesn't
  erase what it already holds; to protect future data, make a new account key
  and rotate item keys.
- **Revoked recipients** keep everything they already decrypted.
- **Metadata** listed above, and anything the app sends unencrypted next to the
  ciphertext (keep folder names, tags and titles inside the encrypted content).
- **Side channels in JavaScript.** Secret keys are held as bytes in the JS
  heap (non-extractable `CryptoKey`s for device keys after import). JS gives
  no reliable memory wiping. The comparisons this library makes on secrets are
  constant-time; WebCrypto does the rest.
- **Search and agents.** The server can't index personal notes; search runs on
  the device. Dictation sends audio to Soniox before it is encrypted.

### Losing keys

- **Every device and the recovery key lost: the personal notes and synced data
  are gone for good.** Nobody, including the workspace admin and poolse, can
  recover them. The app must say so clearly and nudge the user to save the
  recovery key.
- **One device lost**: approve a new one from another device or with the
  recovery key. Then remove the lost device's wrap, and if the device may be in
  someone else's hands, make a new account key, re-wrap the item keys under it,
  and rotate the items' keys.
- **Recovery key lost (devices fine)**: make a new one and replace the
  server's recovery wrap. The old recovery key no longer works once its wrap is
  deleted — unless someone kept a copy of the old wrap, so rotate the account
  key too if the old recovery key may have leaked.
- **Recovery key leaked**: anyone with it and the server's wrap gets the
  account key. Make a new account key and a new recovery key.

## Errors

Everything throws `PoolseCryptoError` with a `code`: `malformed`,
`unsupported`, `wrong-key`, `tampered`, `bad-signature`, `expired`,
`checksum`, `rollback` or `unavailable`. Decryption failures are deliberately
coarse (`tampered` covers both changed data and wrong associated data).
`BlobConflictError` (not a crypto error) means another device wrote first.

## React Native

React Native has no WebCrypto of its own. Install a polyfill that provides
`crypto.subtle` with ECDH and ECDSA on P-256, HKDF, HMAC, AES-GCM and SHA-256,
and JWK import/export of EC keys — for example
[react-native-quick-crypto](https://github.com/margelo/react-native-quick-crypto)
— before importing this package:

```ts
import { install } from 'react-native-quick-crypto';
install();
```

Then check once at start-up; it tries every operation and lists what's missing:

```ts
import { checkCryptoSupport } from '@poolse/crypto';
const { ok, missing } = await checkCryptoSupport();
```

The library also needs `BigInt` (Hermes has it); it brings its own UTF-8 code
for runtimes without `TextDecoder`. Keep the device-key bytes in the
Keychain/Keystore (e.g. `expo-secure-store`), not in AsyncStorage.

## License

[poolse SDK License](./LICENSE).
