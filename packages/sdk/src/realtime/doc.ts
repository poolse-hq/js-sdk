// **Experimental** — the live-docs relay (the server's docs/DOCS_RELAY.md),
// for channel docs, meeting notes and notes. A thin transport: the
// editor (a Yjs provider in the app's editor package) sits on top.
//
//   const doc = poolse.realtime.doc(docId, docToken, { clientId: ydoc.clientID });
//   doc.onJoined(({ rights }) => doc.requestSync(Y.encodeStateVector(ydoc)));   // every (re)join
//   doc.onUpdate((u) => Y.applyUpdate(ydoc, u, provider));
//   doc.onSyncRequest(({ fromPeer, stateVector }) =>
//     doc.sendSyncReply(fromPeer, Y.encodeStateAsUpdate(ydoc, stateVector)));
//   doc.onSyncReply((u) => Y.applyUpdate(ydoc, u, provider));
//   ydoc.on('update', (u, origin) => origin !== provider && doc.sendUpdate(u));
//   …
//   await doc.refresh(newToken);   // at ~80 % of the token's lifetime
//   doc.leave();
//
// Every payload except `refresh` is a binary Phoenix frame (ArrayBuffer);
// the relay never looks inside, except the 1-byte-length peer header of
// the two sync messages, which is built and read here.

import type { Channel, Socket } from 'phoenix';

import { ChannelReplyError } from '../errors.js';
import type { Unsubscribe } from './types.js';

export type DocRights = 'read' | 'write';

/** The relay's limits, from the join reply (bytes; rates per `windowMs`). */
export interface DocLimits {
  maxUpdateBytes: number;
  maxAwarenessBytes: number;
  maxSyncRequestBytes: number;
  maxSyncReplyBytes: number;
  windowMs: number;
  updateMsgs: number;
  updateBytes: number;
  awarenessMsgs: number;
  controlMsgs: number;
}

/** What a (re)join answered. A new `peer` every time. */
export interface DocJoinInfo {
  /** This connection's id in the doc (12 characters). */
  peer: string;
  rights: DocRights;
  /** When the doc token runs out — `refresh` before then. */
  expiresAt: string | null;
  limits: DocLimits;
}

/** One open editor of the doc (a user with two tabs is two). */
export interface DocEditor {
  userId: string;
  externalId: string | null;
  peer: string;
  rights: DocRights;
  /** The editor's Yjs awareness clientID, if it sent one. */
  clientId: number | null;
  onlineAt: string | null;
}

/** Why the server ended the channel (`closed`). */
export type DocClosedReason = 'token_expired' | 'revoked' | 'slow_consumer' | (string & {});

/**
 * A refused push: `reason` is `read_only`, `too_large`, `rate_limited`
 * (with `retryAfterMs`), `binary_required`, `bad_frame`, `no_peer`,
 * `invalid_token`, `token_expired`, `forbidden`, `timeout` or `closed`.
 */
export class DocPushError extends ChannelReplyError {
  public override readonly name: string = 'DocPushError';
  /** `rate_limited`: when the window resets. */
  public readonly retryAfterMs: number | null;

  constructor(event: string, response: unknown) {
    super(event, response);
    const ms = this.response['retry_after_ms'];
    this.retryAfterMs = typeof ms === 'number' ? ms : null;
  }
}

/** The limits a server documents, used until the join reply says otherwise. */
export const DEFAULT_DOC_LIMITS: DocLimits = {
  maxUpdateBytes: 1_048_576,
  maxAwarenessBytes: 65_536,
  maxSyncRequestBytes: 65_536,
  maxSyncReplyBytes: 4_194_304,
  windowMs: 10_000,
  updateMsgs: 200,
  updateBytes: 4_194_304,
  awarenessMsgs: 150,
  controlMsgs: 30,
};

/**
 * Open `doc:<docId>` on the client's socket. Join params: `{doc_token,
 * client_id?}`. Prefer `poolse.realtime.doc(…)`; exported for a socket
 * of your own (e.g. the docs-only `/docs/socket?doc_token=…`, where the
 * token may be left out).
 */
export function openDocChannel(
  socket: Socket,
  docId: string,
  docToken: string | null,
  opts: { clientId?: number } = {},
): DocChannel {
  const handle = new DocChannel(docId, socket, docToken, opts.clientId ?? null);
  handle._join();
  return handle;
}

/**
 * **Experimental.** One open doc relay, from
 * `poolse.realtime.doc(docId, docToken)`. Phoenix rejoins by itself
 * after a dropped socket: `onJoined` fires again (a new `peer`) — sync
 * again then (DOCS_RELAY.md §6).
 */
export class DocChannel {
  public readonly docId: string;
  private readonly channel: Channel;
  private token: string | null;
  private readonly clientId: number | null;
  private info: DocJoinInfo | null = null;
  private editors = new Map<string, DocEditor[]>();
  private refusedReason: string | null = null;
  private closedReason: string | null = null;
  private _closed = false;
  private readonly sets = {
    update: new Set<(data: Uint8Array) => void>(),
    awareness: new Set<(data: Uint8Array) => void>(),
    syncReply: new Set<(data: Uint8Array) => void>(),
    syncRequest: new Set<(req: { fromPeer: string; stateVector: Uint8Array }) => void>(),
    joined: new Set<(info: DocJoinInfo) => void>(),
    error: new Set<(reason: string) => void>(),
    closed: new Set<(reason: DocClosedReason) => void>(),
    presence: new Set<(editors: DocEditor[]) => void>(),
  };

  /** @internal */
  constructor(docId: string, socket: Socket, docToken: string | null, clientId: number | null) {
    this.docId = docId;
    this.token = docToken;
    this.clientId = clientId;
    // A function, so a rejoin sends the latest token from `refresh`.
    this.channel = socket.channel(`doc:${docId}`, () => ({
      ...(this.token ? { doc_token: this.token } : {}),
      ...(this.clientId !== null ? { client_id: this.clientId } : {}),
    }));
    const ch = this.channel;
    ch.on('update', (p: unknown) => emitBytes(this.sets.update, p));
    ch.on('awareness', (p: unknown) => emitBytes(this.sets.awareness, p));
    ch.on('sync_reply', (p: unknown) => emitBytes(this.sets.syncReply, p));
    ch.on('sync_request', (p: unknown) => {
      const bytes = toBytes(p);
      const frame = bytes ? readPeerFrame(bytes) : null;
      if (!frame) return;
      this.sets.syncRequest.forEach((l) => l({ fromPeer: frame.peer, stateVector: frame.rest }));
    });
    ch.on('presence_state', (p: unknown) => {
      this.editors = new Map();
      mergePresence(this.editors, p, 'join');
      this.emitPresence();
    });
    ch.on('presence_diff', (p: unknown) => {
      const d = (p ?? {}) as { joins?: unknown; leaves?: unknown };
      mergePresence(this.editors, d.leaves, 'leave');
      mergePresence(this.editors, d.joins, 'join');
      this.emitPresence();
    });
    ch.on('closed', (p: unknown) => {
      const r = (p as { reason?: unknown } | null)?.reason;
      this.closedReason = typeof r === 'string' ? r : 'closed';
      const reason = this.closedReason;
      this.sets.closed.forEach((l) => l(reason));
    });
    ch.onClose(() => {
      this._closed = true;
    });
  }

  /** True once left, refused, or ended by the server. */
  get closed(): boolean {
    return this._closed;
  }

  /** The latest join's answer; null until joined. */
  get joinInfo(): DocJoinInfo | null {
    return this.info;
  }

  /** `write` or `read`; null until joined. */
  get rights(): DocRights | null {
    return this.info?.rights ?? null;
  }

  /** Everyone editing now (this connection included), from presence. */
  get presence(): DocEditor[] {
    return [...this.editors.values()].flat();
  }

  /** Every (re)join. Replayed to a late subscriber when already joined. */
  onJoined(fn: (info: DocJoinInfo) => void): Unsubscribe {
    return this.add(this.sets.joined, fn, this.info);
  }

  /**
   * The join was refused — `not_found`, `invalid_token`,
   * `token_expired`, `forbidden`, `rate_limited`, `doc_full`. The
   * channel is left, not retried: mint a token and open the doc again.
   */
  onError(fn: (reason: string) => void): Unsubscribe {
    return this.add(this.sets.error, fn, this.refusedReason);
  }

  /** The server is ending the channel: `token_expired`, `revoked` or `slow_consumer`. */
  onClosed(fn: (reason: DocClosedReason) => void): Unsubscribe {
    return this.add(this.sets.closed, fn, this.closedReason);
  }

  /** A Yjs update from another editor or the doc's owner. */
  onUpdate(fn: (update: Uint8Array) => void): Unsubscribe {
    return this.add(this.sets.update, fn, null);
  }

  /** Another editor's y-protocols awareness update. */
  onAwareness(fn: (update: Uint8Array) => void): Unsubscribe {
    return this.add(this.sets.awareness, fn, null);
  }

  /** Someone asks you (a writer) for what they miss: answer with `sendSyncReply`. */
  onSyncRequest(fn: (req: { fromPeer: string; stateVector: Uint8Array }) => void): Unsubscribe {
    return this.add(this.sets.syncRequest, fn, null);
  }

  /** The answer to your `requestSync`: an update to apply. */
  onSyncReply(fn: (update: Uint8Array) => void): Unsubscribe {
    return this.add(this.sets.syncReply, fn, null);
  }

  /** Who is editing, on every presence change. Replayed when known. */
  onPresence(fn: (editors: DocEditor[]) => void): Unsubscribe {
    const off = this.add(this.sets.presence, fn, null);
    if (this.editors.size > 0) fn(this.presence);
    return off;
  }

  /** Push a Yjs update (write rights; ≤ `maxUpdateBytes` — split bigger ones). */
  sendUpdate(update: Uint8Array): Promise<void> {
    return this.pushBinary('update', update, this.limits.maxUpdateBytes).then(() => undefined);
  }

  /** Push this editor's awareness update. */
  sendAwareness(update: Uint8Array): Promise<void> {
    return this.pushBinary('awareness', update, this.limits.maxAwarenessBytes).then(
      () => undefined,
    );
  }

  /**
   * Ask one other writer for what you miss (`Y.encodeStateVector(doc)`).
   * Resolves with the peer that will answer (through `onSyncReply`), or
   * null when nobody else can (`no_peer`: the owner's snapshot is current).
   */
  async requestSync(stateVector: Uint8Array): Promise<{ peer: string } | null> {
    try {
      const reply = await this.pushBinary(
        'sync_request',
        stateVector,
        this.limits.maxSyncRequestBytes,
      );
      const peer = (reply as { peer?: unknown } | null)?.peer;
      return { peer: typeof peer === 'string' ? peer : '' };
    } catch (err) {
      if (err instanceof DocPushError && err.reason === 'no_peer') return null;
      throw err;
    }
  }

  /** Answer `fromPeer`'s sync request (write rights): `Y.encodeStateAsUpdate(doc, theirStateVector)`. */
  sendSyncReply(toPeer: string, update: Uint8Array): Promise<void> {
    const frame = writePeerFrame(toPeer, update);
    if (!frame) return Promise.reject(new DocPushError('sync_reply', { reason: 'bad_frame' }));
    return this.pushBinary('sync_reply', frame, this.limits.maxSyncReplyBytes + 256).then(
      () => undefined,
    );
  }

  /**
   * Swap in a fresh doc token (same user and doc) before this one runs
   * out; rights may change. Later rejoins use it too.
   */
  async refresh(docToken: string): Promise<{ rights: DocRights; expiresAt: string | null }> {
    const reply = (await this.push('refresh', { doc_token: docToken })) as {
      rights?: unknown;
      expires_at?: unknown;
    } | null;
    this.token = docToken;
    const rights: DocRights = reply?.rights === 'write' ? 'write' : 'read';
    const expiresAt = typeof reply?.expires_at === 'string' ? reply.expires_at : null;
    if (this.info) this.info = { ...this.info, rights, expiresAt };
    return { rights, expiresAt };
  }

  /** Close the relay. */
  leave(): void {
    if (this._closed) return;
    this._closed = true;
    this.channel.leave();
    for (const set of Object.values(this.sets)) set.clear();
  }

  /** @internal */
  _join(): void {
    this.channel
      .join()
      .receive('ok', (reply: unknown) => {
        this.info = joinInfoFromWire(reply);
        const info = this.info;
        this.sets.joined.forEach((l) => l(info));
      })
      .receive('error', (reply: unknown) => {
        const r = (reply as { reason?: unknown } | null)?.reason;
        const reason = typeof r === 'string' ? r : 'error';
        // Phoenix would rejoin forever; a refusal doesn't change by retrying.
        this.refusedReason = reason;
        this.sets.error.forEach((l) => l(reason));
        this.leave();
      });
  }

  private get limits(): DocLimits {
    return this.info?.limits ?? DEFAULT_DOC_LIMITS;
  }

  private pushBinary(event: string, data: Uint8Array, max: number): Promise<unknown> {
    if (data.byteLength > max) {
      return Promise.reject(new DocPushError(event, { reason: 'too_large' }));
    }
    return this.push(event, toArrayBuffer(data));
  }

  private push(event: string, payload: object): Promise<unknown> {
    if (this._closed) return Promise.reject(new DocPushError(event, { reason: 'closed' }));
    return new Promise((resolve, reject) => {
      this.channel
        .push(event, payload)
        .receive('ok', (reply: unknown) => resolve(reply))
        .receive('error', (reply: unknown) => reject(new DocPushError(event, reply)))
        .receive('timeout', () => reject(new DocPushError(event, { reason: 'timeout' })));
    });
  }

  private add<T>(set: Set<(v: T) => void>, fn: (v: T) => void, replay: T | null): Unsubscribe {
    set.add(fn);
    if (replay !== null) fn(replay);
    return () => {
      set.delete(fn);
    };
  }

  private emitPresence(): void {
    const list = this.presence;
    this.sets.presence.forEach((l) => l(list));
  }
}

// ── wire helpers ─────────────────────────────────────────────────────────

function joinInfoFromWire(raw: unknown): DocJoinInfo {
  const r = (raw ?? {}) as Record<string, unknown>;
  const l = (r.limits ?? {}) as Record<string, unknown>;
  const n = (k: string, d: number) =>
    typeof l[k] === 'number' && Number.isFinite(l[k]) ? (l[k] as number) : d;
  const D = DEFAULT_DOC_LIMITS;
  return {
    peer: typeof r.peer === 'string' ? r.peer : '',
    rights: r.rights === 'write' ? 'write' : 'read',
    expiresAt: typeof r.expires_at === 'string' ? r.expires_at : null,
    limits: {
      maxUpdateBytes: n('max_update_bytes', D.maxUpdateBytes),
      maxAwarenessBytes: n('max_awareness_bytes', D.maxAwarenessBytes),
      maxSyncRequestBytes: n('max_sync_request_bytes', D.maxSyncRequestBytes),
      maxSyncReplyBytes: n('max_sync_reply_bytes', D.maxSyncReplyBytes),
      windowMs: n('window_ms', D.windowMs),
      updateMsgs: n('update_msgs', D.updateMsgs),
      updateBytes: n('update_bytes', D.updateBytes),
      awarenessMsgs: n('awareness_msgs', D.awarenessMsgs),
      controlMsgs: n('control_msgs', D.controlMsgs),
    },
  };
}

/** Phoenix presence `{user_id: {metas: [...]}}` folded in or out. */
function mergePresence(map: Map<string, DocEditor[]>, raw: unknown, mode: 'join' | 'leave'): void {
  if (!raw || typeof raw !== 'object') return;
  for (const [userId, entry] of Object.entries(raw as Record<string, unknown>)) {
    const metas = (entry as { metas?: unknown } | null)?.metas;
    if (!Array.isArray(metas)) continue;
    const current = map.get(userId) ?? [];
    if (mode === 'leave') {
      const gone = new Set(metas.map((m) => (m as { peer?: unknown })?.peer));
      const left = current.filter((e) => !gone.has(e.peer));
      if (left.length) map.set(userId, left);
      else map.delete(userId);
      continue;
    }
    const next = [...current];
    for (const m of metas) {
      const meta = (m ?? {}) as Record<string, unknown>;
      if (typeof meta.peer !== 'string') continue;
      if (next.some((e) => e.peer === meta.peer)) continue;
      next.push({
        userId,
        externalId: typeof meta.external_id === 'string' ? meta.external_id : null,
        peer: meta.peer,
        rights: meta.rights === 'write' ? 'write' : 'read',
        clientId: typeof meta.client_id === 'number' ? meta.client_id : null,
        onlineAt:
          typeof meta.online_at === 'string'
            ? meta.online_at
            : typeof meta.online_at === 'number'
              ? new Date(meta.online_at).toISOString()
              : null,
      });
    }
    map.set(userId, next);
  }
}

function toBytes(p: unknown): Uint8Array | null {
  if (p instanceof ArrayBuffer) return new Uint8Array(p);
  if (p instanceof Uint8Array) return p;
  if (ArrayBuffer.isView(p)) return new Uint8Array(p.buffer, p.byteOffset, p.byteLength);
  return null;
}

function emitBytes(set: Set<(d: Uint8Array) => void>, p: unknown): void {
  const bytes = toBytes(p);
  if (bytes) set.forEach((l) => l(bytes));
}

/** phoenix.js sends binary only for an exact `ArrayBuffer`. */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
    return data.buffer as ArrayBuffer;
  }
  return data.slice().buffer as ArrayBuffer;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** @internal `<<len:u8, peer, rest>>` → parts; null on a bad header. */
export function readPeerFrame(bytes: Uint8Array): { peer: string; rest: Uint8Array } | null {
  if (bytes.length < 1) return null;
  const len = bytes[0]!;
  if (len === 0 || bytes.length < 1 + len) return null;
  return { peer: decoder.decode(bytes.subarray(1, 1 + len)), rest: bytes.subarray(1 + len) };
}

/** @internal parts → `<<len:u8, peer, rest>>`; null for an empty or over-long peer. */
export function writePeerFrame(peer: string, rest: Uint8Array): Uint8Array | null {
  const p = encoder.encode(peer);
  if (p.length === 0 || p.length > 255) return null;
  const out = new Uint8Array(1 + p.length + rest.length);
  out[0] = p.length;
  out.set(p, 1);
  out.set(rest, 1 + p.length);
  return out;
}
