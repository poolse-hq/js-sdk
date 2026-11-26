import { describe, expect, it } from 'vitest';
import {
  AccountKey,
  DeviceKeys,
  ItemKey,
  MemoryOutboxStorage,
  NoteOutbox,
  NoteSearchIndex,
  approveDeviceRequest,
  createDeviceRequest,
  deviceApprovalMessage,
  envelopeKeyVersion,
  fromBase64Url,
  fromHex,
  generateRecoveryKey,
  noteAsDocument,
  noteKeyForVersion,
  openFolderName,
  openNoteContent,
  openNoteMeta,
  openSharedItemKey,
  parseRecoveryKey,
  readDeviceRequest,
  recoveryAuth,
  recoveryReplaceMessage,
  rotateNoteKey,
  sealFolder,
  sealNote,
  searchWords,
  shareExpired,
  shareWrapsFor,
  signForServer,
  signedDeviceGrant,
  toBase64Url,
  toHex,
  unwrapItemKey,
  unwrapPreviousItemKey,
  type OutboxEntry,
} from '../src';
import { expectCryptoError } from './helpers';
import { NOTES_V1, V1 } from './vectors';

const itemKey = () => ItemKey.fromBytes(fromHex('00'.repeat(31) + '01'), 3);
const accountKey = () => AccountKey.fromBytes(fromHex('11'.repeat(32)));

async function verify(device: DeviceKeys, sig: Uint8Array, msg: Uint8Array) {
  const raw = new Uint8Array(device.publicKeys.signing);
  const key = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new Uint8Array(sig),
    new Uint8Array(msg),
  );
}

describe('notes: frozen vectors', () => {
  it('decrypts the frozen meta and content', async () => {
    const meta = toBase64Url(fromHex(NOTES_V1.meta));
    const content = toBase64Url(fromHex(NOTES_V1.content));
    const at = { noteId: 'note-1', revision: 2 };
    expect(await openNoteMeta(itemKey(), meta, at)).toEqual({
      title: 'Plan',
      metadata: { tags: ['work'] },
    });
    expect(await openNoteContent(itemKey(), content, at)).toEqual({
      title: 'Plan',
      body: 'Hello',
      metadata: { tags: ['work'] },
    });
    expect(envelopeKeyVersion(content)).toBe(3);
    // Wrong revision, slot swap: refused.
    await expectCryptoError(
      openNoteContent(itemKey(), content, { ...at, revision: 3 }),
      'tampered',
    );
    await expectCryptoError(openNoteContent(itemKey(), meta, at), 'tampered');
  });

  it('derives the frozen recovery auth and approval message', async () => {
    const rk = await parseRecoveryKey(V1.recovery);
    expect(toHex(await recoveryAuth(rk))).toBe(NOTES_V1.recoveryAuth);
    expect(toHex(await deviceApprovalMessage('m-1', 'dev-2', new Uint8Array([1, 2, 3])))).toBe(
      NOTES_V1.approvalMessage,
    );
    expect((await recoveryAuth(await generateRecoveryKey())).length).toBe(32);
  });

  it('opens the frozen search index', async () => {
    const idx = await NoteSearchIndex.open(fromHex(NOTES_V1.searchIndex), await accountKey());
    expect(idx.search('cafe').map((h) => h.id)).toEqual(['n1']);
  });
});

describe('notes: sealing and keys', () => {
  it('round-trips a note and refuses a bad revision', async () => {
    const key = ItemKey.generate();
    const s = await sealNote(key, { title: 'T', body: { doc: [] } }, { noteId: 'n', revision: 1 });
    expect(s.key_version).toBe(1);
    expect((await openNoteContent(key, s.content, { noteId: 'n', revision: 1 })).body).toEqual({
      doc: [],
    });
    await expectCryptoError(
      sealNote(key, { title: 'T', body: '' }, { noteId: 'n', revision: 0 }),
      'malformed',
    );
  });

  it('folders keep their name encrypted', async () => {
    const ak = await AccountKey.generate();
    const f = await sealFolder('Ideas', ak, { folderId: 'f1' });
    const key = await unwrapItemKey(fromBase64Url(f.key_wrap), ak, { itemId: 'f1' });
    expect(await openFolderName(key, f.name_envelope, { folderId: 'f1' })).toBe('Ideas');
    await expectCryptoError(openFolderName(key, f.name_envelope, { folderId: 'f2' }), 'tampered');
  });

  it('shares to every device, rotates on revoke, and walks key history', async () => {
    const owner = await DeviceKeys.generate();
    const bob = await DeviceKeys.generate();
    const bobPhone = await DeviceKeys.generate();
    const carol = await DeviceKeys.generate();
    const ak = await AccountKey.generate();
    const k1 = ItemKey.generate();
    const wraps = await shareWrapsFor(
      k1,
      [
        { memberId: 'bob', devices: [bob.publicKeys, bobPhone.publicKeys] },
        { memberId: 'carol', devices: [carol.publicKeys] },
      ],
      { noteId: 'n', signer: owner },
    );
    expect(wraps.map((w) => [w.member_id, w.device_id])).toEqual([
      ['bob', bob.id],
      ['bob', bobPhone.id],
      ['carol', carol.id],
    ]);
    const opened = await openSharedItemKey(fromBase64Url(wraps[1]!.wrap), bobPhone, {
      itemId: 'n',
      requireSignatureFrom: owner.publicKeys,
    });
    expect(toHex(opened.key.toBytes())).toBe(toHex(k1.toBytes()));

    // Bob revoked: rotate, Carol keeps access.
    const r = await rotateNoteKey(
      k1,
      { title: 'T', body: 'v2' },
      {
        noteId: 'n',
        revision: 5,
        accountKey: ak,
        signer: owner,
        remaining: [{ memberId: 'carol', devices: [carol.publicKeys] }],
      },
    );
    expect(r.key.version).toBe(2);
    expect(r.key_version).toBe(2);
    expect(r.share_wraps.map((w) => w.member_id)).toEqual(['carol']);
    expect(Object.keys(r.key_history)).toEqual(['1']);
    const ownerKey = await unwrapItemKey(fromBase64Url(r.key_wrap), ak, { itemId: 'n' });
    expect((await openNoteContent(ownerKey, r.content, { noteId: 'n', revision: 5 })).body).toBe(
      'v2',
    );
    // The old key can't read the new content.
    await expectCryptoError(
      openNoteContent(k1, r.content, { noteId: 'n', revision: 5 }),
      'wrong-key',
    );
    // Older versions stay readable through key_history.
    const old = await noteKeyForVersion(ownerKey, r.key_history, 1, { noteId: 'n' });
    expect(toHex(old.toBytes())).toBe(toHex(k1.toBytes()));
    expect(
      toHex(
        (
          await unwrapPreviousItemKey(fromBase64Url(r.key_history['1']!), ownerKey, { itemId: 'n' })
        ).toBytes(),
      ),
    ).toBe(toHex(k1.toBytes()));
    await expectCryptoError(noteKeyForVersion(ownerKey, {}, 1, { noteId: 'n' }), 'wrong-key');
    await expectCryptoError(noteKeyForVersion(ownerKey, {}, 3, { noteId: 'n' }), 'wrong-key');
  });

  it('knows when a share has expired', () => {
    expect(shareExpired(null)).toBe(false);
    expect(shareExpired('2026-01-01T00:00:00Z', Date.parse('2026-01-02T00:00:00Z'))).toBe(true);
    expect(shareExpired('2026-01-03T00:00:00Z', Date.parse('2026-01-02T00:00:00Z'))).toBe(false);
  });

  it('signs what the server verifies', async () => {
    const laptop = await DeviceKeys.generate();
    const phone = await DeviceKeys.generate();
    const ak = await AccountKey.generate();
    const { qr } = await createDeviceRequest(phone);
    const req = await readDeviceRequest(qr);
    const grant = await approveDeviceRequest(req, laptop, ak, { accountId: 'm-1' });
    const body = await signedDeviceGrant(grant, {
      memberId: 'm-1',
      newDeviceId: phone.id,
      approver: laptop,
    });
    expect(body.approver_device_id).toBe(laptop.id);
    const msg = await deviceApprovalMessage('m-1', phone.id, grant);
    expect(await verify(laptop, fromBase64Url(body.signature), msg)).toBe(true);
    expect(await verify(phone, fromBase64Url(body.signature), msg)).toBe(false);

    const rmsg = await recoveryReplaceMessage(
      'm-1',
      'rk-1',
      new Uint8Array([9]),
      new Uint8Array([8]),
    );
    const sig = await signForServer(laptop, rmsg);
    expect(sig.length).toBe(64);
    expect(await verify(laptop, sig, rmsg)).toBe(true);
    expect(
      toHex(await recoveryReplaceMessage('m-1', 'rk-1', new Uint8Array([9]), new Uint8Array([7]))),
    ).not.toBe(toHex(rmsg));
  });

  it('turns a note into a document for an agent', () => {
    expect(noteAsDocument({ title: ' Plan ', body: 'Do it' })).toEqual({
      title: 'Plan',
      markdown: '# Plan\n\nDo it\n',
    });
    expect(noteAsDocument({ title: '', body: null }).title).toBe('Untitled note');
    expect(noteAsDocument({ title: 'x', body: { a: 1 } }, () => 'tree').markdown).toBe(
      '# x\n\ntree\n',
    );
    expect(() => noteAsDocument({ title: 'x', body: { a: 1 } })).toThrow();
  });
});

describe('on-device search (NT7)', () => {
  it('tokenizes without case or accents', () => {
    expect(searchWords('Café-Plan: Ünïcode 42x')).toEqual(['cafe', 'plan', 'unicode', '42x']);
  });

  it('needs every word, ranks title and whole words first', () => {
    const idx = new NoteSearchIndex();
    idx.put('a', { title: 'Budget review', text: 'numbers for q3', updatedAt: 1 });
    idx.put('b', { title: 'Notes', text: 'the budget is reviewed', updatedAt: 2 });
    idx.put('c', { title: 'Other', text: 'nothing here', updatedAt: 3 });
    expect(idx.search('budget rev').map((h) => h.id)).toEqual(['a', 'b']);
    expect(idx.search('budget q3').map((h) => h.id)).toEqual(['a']);
    expect(idx.search('   ')).toEqual([]);
    idx.remove('a');
    expect(idx.search('budget').map((h) => h.id)).toEqual(['b']);
  });

  it('seals under the account key only', async () => {
    const ak = await AccountKey.generate();
    const idx = new NoteSearchIndex();
    idx.put('n', { title: 'Secret plan', text: 'launch' });
    const sealed = await idx.seal(ak);
    expect(new TextDecoder().decode(sealed).includes('secret')).toBe(false);
    expect((await NoteSearchIndex.open(sealed, ak)).search('launch')).toHaveLength(1);
    await expectCryptoError(NoteSearchIndex.open(sealed, await AccountKey.generate()), 'wrong-key');
    await expectCryptoError(NoteSearchIndex.open(sealed, ak, 'other'), 'tampered');
  });
});

describe('offline outbox (NT9)', () => {
  type Draft = { body: string };
  it('collapses edits, persists encrypted, and sends in order', async () => {
    const ak = await AccountKey.generate();
    const storage = new MemoryOutboxStorage();
    const ob = await NoteOutbox.load<Draft>({ storage, accountKey: ak });
    await ob.put('n1', 4, { body: 'a' });
    await ob.put('n2', 0, { body: 'new' });
    await ob.put('n1', 5, { body: 'b' });
    expect(ob.entries.map((e) => [e.noteId, e.baseRevision, e.data?.body])).toEqual([
      ['n1', 4, 'b'],
      ['n2', 0, 'new'],
    ]);
    expect(new TextDecoder().decode(storage.data!).includes('new')).toBe(false);

    const again = await NoteOutbox.load<Draft>({ storage, accountKey: ak });
    expect(again.isPending('n2')).toBe(true);
    const sent: string[] = [];
    const res = await again.flush({
      send: async (e) => {
        sent.push(`${e.noteId}@${e.baseRevision}`);
        return { status: 'ok', revision: e.baseRevision + 1 };
      },
    });
    expect(sent).toEqual(['n1@4', 'n2@0']);
    expect(res).toEqual({ written: ['n1', 'n2'], dropped: [], pending: 0 });
    expect((await NoteOutbox.load({ storage, accountKey: ak })).entries).toHaveLength(0);
  });

  it('can start empty over a queue it cannot read (corrupt, or another account)', async () => {
    const ak = await AccountKey.generate();
    const storage = new MemoryOutboxStorage();
    const ob = await NoteOutbox.load<Draft>({ storage, accountKey: ak });
    await ob.put('n1', 1, { body: 'a' });
    const other = await AccountKey.generate();
    await expectCryptoError(NoteOutbox.load({ storage, accountKey: other }));
    const fresh = await NoteOutbox.load<Draft>({
      storage,
      accountKey: other,
      ifUnreadable: 'discard',
    });
    expect(fresh.entries).toHaveLength(0);
    expect(fresh.discardedUnreadable).toBe(true);
    await fresh.put('n2', 0, { body: 'b' });
    expect((await NoteOutbox.load({ storage, accountKey: other })).entries).toHaveLength(1);
  });

  it('resolves conflicts on the server revision and keeps entries on network errors', async () => {
    const ak = await AccountKey.generate();
    const storage = new MemoryOutboxStorage();
    const ob = await NoteOutbox.load<Draft>({ storage, accountKey: ak });
    await ob.put('n1', 1, { body: 'mine' });
    await ob.put('n2', 1, { body: 'later' });
    let fail = true;
    const calls: OutboxEntry<Draft>[] = [];
    const send = async (e: OutboxEntry<Draft>) => {
      calls.push(e);
      if (e.noteId === 'n2' && fail) throw new Error('offline');
      if (e.baseRevision === 1 && e.noteId === 'n1')
        return { status: 'conflict' as const, revision: 3, current: { body: 'theirs' } };
      return { status: 'ok' as const, revision: e.baseRevision + 1 };
    };
    const r1 = await ob.flush({
      send,
      resolve: (local, current) => ({ body: `${current?.body}+${local?.body}` }),
    });
    expect(r1.written).toEqual(['n1']);
    expect(r1.pending).toBe(1);
    expect(calls[1]).toMatchObject({
      noteId: 'n1',
      baseRevision: 3,
      data: { body: 'theirs+mine' },
    });
    expect(ob.entries[0]).toMatchObject({ noteId: 'n2', attempts: 1 });
    fail = false;
    expect((await ob.flush({ send })).written).toEqual(['n2']);
  });

  it('keeps an edit made while the previous one is being sent', async () => {
    const ak = await AccountKey.generate();
    const ob = await NoteOutbox.load<Draft>({ storage: new MemoryOutboxStorage(), accountKey: ak });
    await ob.put('n1', 4, { body: 'first' });
    const sent: string[] = [];
    let release!: () => void;
    const first = new Promise<void>((r) => (release = r));
    const flushing = ob.flush({
      send: async (e) => {
        sent.push(`${e.data?.body}@${e.baseRevision}`);
        if (sent.length === 1) await first;
        return { status: 'ok', revision: e.baseRevision + 1 };
      },
    });
    // The user types again while "first" is on the wire.
    await Promise.resolve();
    await ob.put('n1', 4, { body: 'second' });
    release();
    const res = await flushing;
    // "second" was not dropped: it went out next, on revision 5.
    expect(sent).toEqual(['first@4', 'second@5']);
    expect(res.written).toEqual(['n1', 'n1']);
    expect(ob.isPending('n1')).toBe(false);
  });

  it('deletes for real a new note deleted while its first send is out', async () => {
    const ak = await AccountKey.generate();
    const ob = await NoteOutbox.load<Draft>({ storage: new MemoryOutboxStorage(), accountKey: ak });
    await ob.put('tmp', 0, { body: 'x' });
    const ops: string[] = [];
    let release!: () => void;
    const first = new Promise<void>((r) => (release = r));
    const flushing = ob.flush({
      send: async (e) => {
        ops.push(`${e.op}@${e.baseRevision}`);
        if (ops.length === 1) await first;
        return { status: 'ok', revision: e.baseRevision + 1 };
      },
    });
    await Promise.resolve();
    await ob.delete('tmp', 0);
    release();
    await flushing;
    expect(ops).toEqual(['put@0', 'delete@1']);
    expect(ob.entries).toHaveLength(0);
  });

  it('drops a note made and deleted offline, and gone notes', async () => {
    const ak = await AccountKey.generate();
    const ob = await NoteOutbox.load<Draft>({ storage: new MemoryOutboxStorage(), accountKey: ak });
    await ob.put('tmp', 0, { body: 'x' });
    await ob.delete('tmp', 0);
    expect(ob.entries).toHaveLength(0);
    await ob.delete('old', 7);
    const r = await ob.flush({ send: async () => ({ status: 'gone' }) });
    expect(r.dropped).toEqual(['old']);
  });
});
