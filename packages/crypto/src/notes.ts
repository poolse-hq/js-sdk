/**
 * Workspace notes (apps/workspace/NOTES.md) on top of the primitives: the
 * associated data every note ciphertext binds, sealing and opening a note's
 * `meta` and `content`, folder names, share wraps for recipients' devices,
 * key rotation on revoke or expiry (NT5, NT15), walking `key_history` for
 * versions (NT8), the recovery-key auth and the device signatures the server
 * checks (NT10), and the plain document handed to an agent (NT12).
 *
 * Everything here returns base64url strings in the field names the
 * Workspace API uses, so a result can go straight into a request body.
 */
import { type Bytes, concat, fromBase64Url, toBase64Url, utf8 } from './bytes';
import { PoolseCryptoError } from './errors';
import { DOMAIN } from './format';
import { inspectEnvelope } from './inspect';
import {
  type AccountKey,
  type DeviceKeys,
  type DevicePublicKeys,
  ItemKey,
  devicePrivate,
  rotateItemKey,
  secretOf,
} from './keys';
import { type ItemContent, type JsonValue, decryptItem, encryptItem } from './item';
import type { RecoveryKey } from './recovery';
import { ecdsaSign, hkdf, label, sha256 } from './subtle';
import { shareItemKey, unwrapPreviousItemKey, wrapItemKey, wrapPreviousItemKey } from './wrap';

// ---------------------------------------------------------------------------
// Associated data (NOTES.md "Associated data")

/** `{itemId: note.id, version: revision, slot: "meta" | "content"}`. */
export function noteAssociatedData(noteId: string, revision: number, slot: 'meta' | 'content') {
  return { itemId: noteId, version: revision, slot } as const;
}

/** `{itemId: note.id, attachmentId}` for `encryptAttachment` / `decryptAttachment`. */
export function noteAttachmentAssociatedData(noteId: string, attachmentId: string) {
  return { itemId: noteId, attachmentId } as const;
}

/** `{itemId: folder.id, slot: "folder"}`. */
export function folderAssociatedData(folderId: string) {
  return { itemId: folderId, slot: 'folder' } as const;
}

// ---------------------------------------------------------------------------
// Sealing a note

/** What a note holds: title, body and metadata (tags, pinned, attachment names…). */
export type NoteContent = ItemContent;

/** The encrypted fields of an e2e note write. */
export interface SealedNote {
  /** `{title, body: null, metadata}` — what lists show. */
  meta: string;
  /** The whole note. */
  content: string;
  key_version: number;
}

/**
 * Encrypt a note for the revision this write creates (`base_revision + 1`).
 * `meta` carries the title and metadata without the body, so lists can show
 * a title and tags without fetching the content.
 */
export async function sealNote(
  key: ItemKey,
  note: NoteContent,
  options: { noteId: string; revision: number },
): Promise<SealedNote> {
  checkRevision(options.revision);
  const meta: ItemContent = { title: note.title, body: null, metadata: note.metadata ?? {} };
  return {
    meta: toBase64Url(
      await encryptItem(key, meta, noteAssociatedData(options.noteId, options.revision, 'meta')),
    ),
    content: toBase64Url(
      await encryptItem(
        key,
        { title: note.title, body: note.body, metadata: note.metadata ?? {} },
        noteAssociatedData(options.noteId, options.revision, 'content'),
      ),
    ),
    key_version: key.version,
  };
}

/** Decrypt a note's `meta` (listing form): title and metadata. */
export async function openNoteMeta(
  key: ItemKey,
  meta: string,
  options: { noteId: string; revision: number },
): Promise<{ title: string; metadata: { [key: string]: JsonValue } }> {
  const m = await decryptItem(
    key,
    fromBase64Url(meta),
    noteAssociatedData(options.noteId, options.revision, 'meta'),
  );
  return { title: m.title, metadata: m.metadata ?? {} };
}

/**
 * Decrypt a note's `content` — the note itself, or one of its versions
 * (NT8: pass the version's own `revision`, and the key for its
 * `key_version` from `noteKeyForVersion`).
 */
export async function openNoteContent(
  key: ItemKey,
  content: string,
  options: { noteId: string; revision: number },
): Promise<NoteContent> {
  return decryptItem(
    key,
    fromBase64Url(content),
    noteAssociatedData(options.noteId, options.revision, 'content'),
  );
}

/** The key version an envelope (`meta`, `content`, a version) was written with. */
export function envelopeKeyVersion(envelope: string): number {
  const info = inspectEnvelope(fromBase64Url(envelope));
  if (info.keyVersion === undefined) {
    throw new PoolseCryptoError('malformed', 'Not an item envelope');
  }
  return info.keyVersion;
}

/**
 * The key a version was written with (NT8): `current` when the versions
 * match, else unwrap `key_history` back one step at a time
 * (`key_history[v]` is key `v` wrapped under key `v + 1`).
 */
export async function noteKeyForVersion(
  current: ItemKey,
  keyHistory: Readonly<Record<string, string>>,
  version: number,
  options: { noteId: string },
): Promise<ItemKey> {
  if (version > current.version) {
    throw new PoolseCryptoError('wrong-key', `Key version ${version} is newer than the note's`);
  }
  let key = current;
  while (key.version > version) {
    const wrap = keyHistory[String(key.version - 1)];
    if (!wrap) {
      throw new PoolseCryptoError('wrong-key', `key_history has no key ${key.version - 1}`);
    }
    key = await unwrapPreviousItemKey(fromBase64Url(wrap), key, { itemId: options.noteId });
  }
  return key;
}

// ---------------------------------------------------------------------------
// Folders (NT7)

/** A new folder key, its name envelope and its key wrap under the account key. */
export async function sealFolder(
  name: string,
  accountKey: AccountKey,
  options: { folderId: string; key?: ItemKey },
): Promise<{ key: ItemKey; name_envelope: string; key_wrap: string }> {
  const key = options.key ?? ItemKey.generate();
  return {
    key,
    name_envelope: toBase64Url(
      await encryptItem(key, { title: name, body: null }, folderAssociatedData(options.folderId)),
    ),
    key_wrap: toBase64Url(await wrapItemKey(key, accountKey, { itemId: options.folderId })),
  };
}

export async function openFolderName(
  key: ItemKey,
  nameEnvelope: string,
  options: { folderId: string },
): Promise<string> {
  const item = await decryptItem(
    key,
    fromBase64Url(nameEnvelope),
    folderAssociatedData(options.folderId),
  );
  return item.title;
}

// ---------------------------------------------------------------------------
// Shares (NT5, NT15, NT16)

/** A recipient from `POST /notes/keys/lookup`: their approved devices. */
export interface NoteRecipient {
  memberId: string;
  devices: readonly DevicePublicKeys[];
}

/** One entry of `wraps` / `share_wraps`. */
export interface NoteShareWrap {
  member_id: string;
  device_id: string;
  wrap: string;
}

/**
 * The note key wrapped to every device of every recipient, signed by this
 * device — the `wraps` of `POST /notes/:id/shares` and `POST /notes/:id/wraps`.
 * Viewers and editors (NT16) get the same wrap: an editor writes content
 * with the same key, and the server enforces who may write.
 */
export async function shareWrapsFor(
  key: ItemKey,
  recipients: readonly NoteRecipient[],
  options: { noteId: string; signer: DeviceKeys },
): Promise<NoteShareWrap[]> {
  const out: NoteShareWrap[] = [];
  for (const r of recipients) {
    for (const device of r.devices) {
      const wrap = await shareItemKey(key, device, {
        itemId: options.noteId,
        signer: options.signer,
      });
      out.push({ member_id: r.memberId, device_id: device.id, wrap: toBase64Url(wrap) });
    }
  }
  return out;
}

/** The fields of a `PUT /notes/:id` that rotates the key. */
export interface RotatedNote extends SealedNote {
  key: ItemKey;
  key_wrap: string;
  key_history: Record<string, string>;
  share_wraps: NoteShareWrap[];
}

/**
 * Rotate a note's key after a revoke or an expired share (`notes:rotate`):
 * a new key one version up, the note re-encrypted for `revision`, the new
 * key wrapped for the owner, the old key kept readable under the new one
 * (`key_history`), and wraps for the people who keep access. Send it with
 * the note's current `base_revision`; nothing written after this is
 * readable with the old key.
 */
export async function rotateNoteKey(
  previous: ItemKey,
  note: NoteContent,
  options: {
    noteId: string;
    revision: number;
    accountKey: AccountKey;
    signer: DeviceKeys;
    /** Everyone still shared with, with their devices. */
    remaining: readonly NoteRecipient[];
  },
): Promise<RotatedNote> {
  const key = rotateItemKey(previous);
  const sealed = await sealNote(key, note, options);
  return {
    ...sealed,
    key,
    key_wrap: toBase64Url(await wrapItemKey(key, options.accountKey, { itemId: options.noteId })),
    key_history: {
      [String(previous.version)]: toBase64Url(
        await wrapPreviousItemKey(previous, key, { itemId: options.noteId }),
      ),
    },
    share_wraps: await shareWrapsFor(key, options.remaining, options),
  };
}

/** Whether a share has ended by `now` (NT15): the owner then rotates like on a revoke. */
export function shareExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t <= now;
}

// ---------------------------------------------------------------------------
// Devices and recovery: what the server checks (NT10)

const RECOVERY_AUTH_LABEL = 'recovery-auth';

/**
 * 32 bytes the server keeps the SHA-256 of, proving a device holds the
 * recovery key without revealing it: HKDF-SHA-256 of the key's secret
 * (empty salt, info `poolse-crypto/v1/recovery-auth`). Send as
 * `recovery.auth` / `recovery_auth` (base64url).
 */
export async function recoveryAuth(recoveryKey: RecoveryKey): Promise<Uint8Array> {
  return hkdf(secretOf(recoveryKey), new Uint8Array(0), label(DOMAIN, RECOVERY_AUTH_LABEL), 32);
}

/** Raw ECDSA P-256 / SHA-256 signature (`r‖s`, 64 bytes) by this device's signing key. */
export async function signForServer(device: DeviceKeys, message: Uint8Array): Promise<Uint8Array> {
  return ecdsaSign(devicePrivate(device).signing, message);
}

const SEP = new Uint8Array([0]);

/**
 * `"poolse-notes/v1/approve" ‖ 0 ‖ member_id ‖ 0 ‖ new device_id ‖ 0 ‖ SHA-256(grant)` —
 * what the approving device signs for `POST …/devices/:id/grant`.
 */
export async function deviceApprovalMessage(
  memberId: string,
  newDeviceId: string,
  grant: Uint8Array,
): Promise<Bytes> {
  return concat(
    utf8('poolse-notes/v1/approve'),
    SEP,
    utf8(memberId),
    SEP,
    utf8(newDeviceId),
    SEP,
    await sha256(grant),
  );
}

/**
 * `"poolse-notes/v1/recovery" ‖ 0 ‖ member_id ‖ 0 ‖ key_id ‖ 0 ‖ SHA-256(wrap) ‖ SHA-256(auth)` —
 * what an approved device signs for `PUT /notes/keys/me/recovery`.
 */
export async function recoveryReplaceMessage(
  memberId: string,
  keyId: string,
  wrap: Uint8Array,
  auth: Uint8Array,
): Promise<Bytes> {
  return concat(
    utf8('poolse-notes/v1/recovery'),
    SEP,
    utf8(memberId),
    SEP,
    utf8(keyId),
    SEP,
    await sha256(wrap),
    await sha256(auth),
  );
}

/** The body of `POST …/devices/:id/grant`, signed by `approver`. */
export async function signedDeviceGrant(
  grant: Uint8Array,
  options: { memberId: string; newDeviceId: string; approver: DeviceKeys },
): Promise<{ grant: string; approver_device_id: string; signature: string }> {
  const msg = await deviceApprovalMessage(options.memberId, options.newDeviceId, grant);
  return {
    grant: toBase64Url(grant),
    approver_device_id: options.approver.id,
    signature: toBase64Url(await signForServer(options.approver, msg)),
  };
}

// ---------------------------------------------------------------------------
// Handing one note to an agent (NT12)

/**
 * A decrypted note as a plain Markdown document for one agent task. Only
 * this note leaves the device, decrypted; call it only after the member
 * explicitly chose to hand it over. A body that isn't a string (an editor
 * document tree) needs `toMarkdown`.
 */
export function noteAsDocument(
  note: NoteContent,
  toMarkdown?: (body: JsonValue) => string,
): { title: string; markdown: string } {
  const body =
    typeof note.body === 'string'
      ? note.body
      : note.body === null
        ? ''
        : toMarkdown
          ? toMarkdown(note.body)
          : (() => {
              throw new PoolseCryptoError('malformed', 'Pass toMarkdown for a structured body');
            })();
  const title = note.title.trim() || 'Untitled note';
  return { title, markdown: `# ${title}\n\n${body}`.trimEnd() + '\n' };
}

function checkRevision(revision: number): void {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new PoolseCryptoError('malformed', 'revision is the revision the write creates (≥ 1)');
  }
}
