import { describe, expect, it, vi } from 'vitest';

import { DocPushError, Poolse } from '../src/index.js';
import { readPeerFrame, writePeerFrame } from '../src/realtime/doc.js';

type Recv = { receive: (status: string, cb: (r?: unknown) => void) => Recv };
type FakeChannel = {
  topic: string;
  params: () => Record<string, unknown>;
  trigger(e: string, p: unknown): void;
  push: (event: string, payload: unknown) => Recv;
};

function open(token = 'tok-1', clientId?: number) {
  const chat = new Poolse({
    apiUrl: 'https://chat.example',
    getToken: () => 'tok',
    fetch: vi.fn() as unknown as typeof globalThis.fetch,
  });
  const doc = chat.realtime.doc('channel:9f1c', token, clientId !== undefined ? { clientId } : {});
  const ch = (doc as unknown as { channel: FakeChannel }).channel;
  const pushes: Array<{ event: string; payload: unknown }> = [];
  // Answer every push with `answer(event)`.
  const answer = vi.fn((_event: string): ['ok' | 'error', unknown] => ['ok', {}]);
  ch.push = (event, payload) => {
    pushes.push({ event, payload });
    const [status, reply] = answer(event);
    const recv: Recv = {
      receive: (s, cb) => {
        if (s === status) cb(reply);
        return recv;
      },
    };
    return recv;
  };
  return { chat, doc, ch, pushes, answer };
}

const bytes = (...b: number[]) => new Uint8Array(b);

describe('doc relay (experimental)', () => {
  it('joins doc:<id> with the token and client id; rejoins with a refreshed token', async () => {
    const { chat, doc, ch, answer } = open('tok-1', 42);
    expect(ch.topic).toBe('doc:channel:9f1c');
    expect(ch.params()).toEqual({ doc_token: 'tok-1', client_id: 42 });
    answer.mockReturnValueOnce(['ok', { rights: 'read', expires_at: '2026-11-21T10:20:00Z' }]);
    expect(await doc.refresh('tok-2')).toEqual({
      rights: 'read',
      expiresAt: '2026-11-21T10:20:00Z',
    });
    expect(ch.params()).toEqual({ doc_token: 'tok-2', client_id: 42 });
    chat.destroy();
  });

  it('sends binary frames and builds the sync_reply peer header', async () => {
    const { chat, doc, pushes, answer } = open();
    await doc.sendUpdate(bytes(1, 2, 3));
    expect(pushes[0]!.event).toBe('update');
    expect(pushes[0]!.payload).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(pushes[0]!.payload as ArrayBuffer)).toEqual(bytes(1, 2, 3));

    // A view into a bigger buffer is copied, not sent whole.
    const big = bytes(9, 9, 7, 8);
    await doc.sendAwareness(big.subarray(2));
    expect(new Uint8Array(pushes[1]!.payload as ArrayBuffer)).toEqual(bytes(7, 8));

    await doc.sendSyncReply('Xk', bytes(5));
    expect(new Uint8Array(pushes[2]!.payload as ArrayBuffer)).toEqual(
      bytes(2, 'X'.charCodeAt(0), 'k'.charCodeAt(0), 5),
    );

    answer.mockReturnValueOnce(['ok', { peer: 'Ab' }]);
    expect(await doc.requestSync(bytes(0))).toEqual({ peer: 'Ab' });
    answer.mockReturnValueOnce(['error', { reason: 'no_peer' }]);
    expect(await doc.requestSync(bytes(0))).toBeNull();

    answer.mockReturnValueOnce(['error', { reason: 'rate_limited', retry_after_ms: 1200 }]);
    const err = await doc.sendUpdate(bytes(1)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DocPushError);
    expect((err as DocPushError).retryAfterMs).toBe(1200);

    await expect(doc.sendAwareness(new Uint8Array(70_000))).rejects.toMatchObject({
      reason: 'too_large',
    });
    chat.destroy();
  });

  it('decodes incoming frames, sync requests, presence and closed', () => {
    const { chat, doc, ch } = open();
    const updates = vi.fn();
    const requests = vi.fn();
    const presence = vi.fn();
    const closed = vi.fn();
    doc.onUpdate(updates);
    doc.onSyncRequest(requests);
    doc.onPresence(presence);
    doc.onClosed(closed);

    ch.trigger('update', bytes(1, 2).buffer);
    ch.trigger('update', { not: 'binary' });
    expect(updates).toHaveBeenCalledOnce();
    expect(updates.mock.calls[0]![0]).toEqual(bytes(1, 2));

    ch.trigger('sync_request', writePeerFrame('Peer01', bytes(7, 7))!.buffer);
    expect(requests).toHaveBeenCalledWith({ fromPeer: 'Peer01', stateVector: bytes(7, 7) });

    ch.trigger('presence_state', {
      u1: { metas: [{ peer: 'p1', rights: 'write', client_id: 5, external_id: 'ana' }] },
    });
    ch.trigger('presence_diff', {
      joins: { u2: { metas: [{ peer: 'p2', rights: 'read' }] } },
      leaves: { u1: { metas: [{ peer: 'p1' }] } },
    });
    expect(doc.presence).toEqual([
      {
        userId: 'u2',
        externalId: null,
        peer: 'p2',
        rights: 'read',
        clientId: null,
        onlineAt: null,
      },
    ]);
    expect(presence).toHaveBeenCalledTimes(2);

    ch.trigger('closed', { reason: 'revoked' });
    expect(closed).toHaveBeenCalledWith('revoked');
    doc.leave();
    expect(doc.closed).toBe(true);
    chat.destroy();
  });

  it('peer frames round-trip and reject bad headers', () => {
    const f = writePeerFrame('Xk3v9QpL0aZw', bytes(1, 2))!;
    expect(readPeerFrame(f)).toEqual({ peer: 'Xk3v9QpL0aZw', rest: bytes(1, 2) });
    expect(readPeerFrame(bytes(5, 1))).toBeNull();
    expect(readPeerFrame(bytes())).toBeNull();
    expect(writePeerFrame('', bytes(1))).toBeNull();
  });
});
