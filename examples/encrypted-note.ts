// @poolse/crypto: a personal note on the Workspace notes API
// (apps/workspace/NOTES.md). `ws` is your app's Workspace client.

import {
  AccountKey,
  DeviceKeys,
  ItemKey,
  NoteSearchIndex,
  decodeDevicePublicKeys,
  fromBase64Url,
  openNoteContent,
  rotateNoteKey,
  sealNote,
  shareWrapsFor,
  toBase64Url,
  wrapItemKey,
} from '@poolse/crypto';

declare const ws: {
  put(path: string, body: unknown): Promise<{ note: { revision: number } }>;
  post(
    path: string,
    body: unknown,
  ): Promise<{ members: { member_id: string; devices: { public_keys: string }[] }[] }>;
};
declare const device: DeviceKeys; // from the keychain
declare const accountKey: AccountKey; // unwrapped at start

const noteId = crypto.randomUUID();
const key = ItemKey.generate();
const note = {
  title: 'Pricing',
  body: '# Options\n\n- Seats\n- Usage',
  metadata: { tags: ['work'] },
};

// Create (base_revision 0 → revision 1).
const sealed = await sealNote(key, note, { noteId, revision: 1 });
await ws.put(`/workspace/v1/notes/${noteId}`, {
  kind: 'personal',
  base_revision: 0,
  meta: sealed.meta,
  content: sealed.content,
  key_wrap: toBase64Url(await wrapItemKey(key, accountKey, { itemId: noteId })),
});

// Share with Ana's devices, signed by this device.
const { members } = await ws.post('/workspace/v1/notes/keys/lookup', {
  member_ids: ['ana-member-id'],
});
const recipients = await Promise.all(
  members.map(async (m) => ({
    memberId: m.member_id,
    devices: await Promise.all(m.devices.map((d) => decodeDevicePublicKeys(d.public_keys))),
  })),
);
await ws.post(`/workspace/v1/notes/${noteId}/shares`, {
  member_ids: ['ana-member-id'],
  wraps: await shareWrapsFor(key, recipients, { noteId, signer: device }),
});

// Revoked (notes:rotate): a new key; nobody left to share with.
const r = await rotateNoteKey(key, note, {
  noteId,
  revision: 2,
  accountKey,
  signer: device,
  remaining: [],
});
await ws.put(`/workspace/v1/notes/${noteId}`, {
  base_revision: 1,
  meta: r.meta,
  content: r.content,
  key_wrap: r.key_wrap,
  key_history: r.key_history,
  share_wraps: r.share_wraps,
});

// Search on the device.
const index = new NoteSearchIndex();
const opened = await openNoteContent(r.key, r.content, { noteId, revision: 2 });
index.put(noteId, { title: opened.title, text: String(opened.body) });
console.log(index.search('pric'), fromBase64Url(r.meta).length);
