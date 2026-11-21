// **Experimental** — the live-edit relay for shared documents (channel
// docs, meeting notes). The editor (Yjs or similar) runs in the app; the
// relay only fans out what one editor pushes to the others:
//
//   const doc = poolse.realtime.doc(docId, token);   // token from the Workspace API
//   doc.onUpdate(({ userId, data }) => Y.applyUpdate(ydoc, data, 'remote'));
//   ydoc.on('update', (u, origin) => origin !== 'remote' && doc.sendUpdate(u));
//   doc.onAwareness(({ data }) => applyAwarenessUpdate(awareness, data, 'remote'));
//   …
//   doc.leave();
//
// Assumed protocol (the server side is still being built): join
// `doc:<doc_id>` with `{token}`; push `update` / `awareness` with
// `{data: <base64>}`; the others receive the same events with
// `{user_id, data}`. Kept in this file so a change is a change here.

import type { Channel } from 'phoenix';

import { ChannelReplyError } from '../errors.js';
import type { Unsubscribe } from './types.js';

/** One relayed update or awareness frame. */
export interface DocFrame {
  /** Who sent it (poolse user id); null when the relay leaves it out. */
  userId: string | null;
  data: Uint8Array;
}

/** Largest frame pushed (bytes, before base64). Bigger ones are refused locally. */
export const DOC_FRAME_MAX_BYTES = 512 * 1024;

/**
 * **Experimental.** One open document relay, from
 * `poolse.realtime.doc(docId, token)`. Rejoins on its own after a
 * reconnect (`onJoined` fires again — resend your full state then).
 */
export class DocChannel {
  public readonly docId: string;
  private readonly channel: Channel;
  private readonly updateListeners = new Set<(f: DocFrame) => void>();
  private readonly awarenessListeners = new Set<(f: DocFrame) => void>();
  private readonly joinedListeners = new Set<(reply: unknown) => void>();
  private readonly errorListeners = new Set<(reason: string) => void>();
  private refusedReason: string | null = null;
  private joinedOnce = false;
  private lastReply: unknown = null;
  private _closed = false;

  constructor(docId: string, channel: Channel) {
    this.docId = docId;
    this.channel = channel;
    channel.on('update', (p: unknown) => this.emit(this.updateListeners, p));
    channel.on('awareness', (p: unknown) => this.emit(this.awarenessListeners, p));
    channel.onClose(() => {
      this._closed = true;
    });
  }

  /** True once left or refused. */
  get closed(): boolean {
    return this._closed;
  }

  /** A binary update from another editor. */
  onUpdate(fn: (frame: DocFrame) => void): Unsubscribe {
    this.updateListeners.add(fn);
    return () => {
      this.updateListeners.delete(fn);
    };
  }

  /** Another editor's awareness (cursor, selection, name). */
  onAwareness(fn: (frame: DocFrame) => void): Unsubscribe {
    this.awarenessListeners.add(fn);
    return () => {
      this.awarenessListeners.delete(fn);
    };
  }

  /** Every (re)join, with the join reply. Replayed to late subscribers. */
  onJoined(fn: (reply: unknown) => void): Unsubscribe {
    this.joinedListeners.add(fn);
    if (this.joinedOnce) fn(this.lastReply);
    return () => {
      this.joinedListeners.delete(fn);
    };
  }

  /**
   * The join was refused (`forbidden`, `invalid_token`, `not_found`…);
   * the channel is left, not retried — get a fresh token and open again.
   */
  onError(fn: (reason: string) => void): Unsubscribe {
    this.errorListeners.add(fn);
    if (this.refusedReason) fn(this.refusedReason);
    return () => {
      this.errorListeners.delete(fn);
    };
  }

  /** Send a binary update. Rejects with `ChannelReplyError` (`too_large`, `rate_limited`, `timeout`…). */
  sendUpdate(data: Uint8Array): Promise<void> {
    return this.push('update', data);
  }

  /** Send this editor's awareness frame. */
  sendAwareness(data: Uint8Array): Promise<void> {
    return this.push('awareness', data);
  }

  /** Close the relay. */
  leave(): void {
    if (this._closed) return;
    this._closed = true;
    this.channel.leave();
    this.updateListeners.clear();
    this.awarenessListeners.clear();
    this.joinedListeners.clear();
  }

  /** @internal */
  _join(): void {
    this.channel
      .join()
      .receive('ok', (reply: unknown) => {
        this.joinedOnce = true;
        this.lastReply = reply ?? null;
        this.joinedListeners.forEach((l) => l(this.lastReply));
      })
      .receive('error', (reply: unknown) => {
        const reason =
          reply &&
          typeof reply === 'object' &&
          typeof (reply as { reason?: unknown }).reason === 'string'
            ? (reply as { reason: string }).reason
            : 'error';
        this.refusedReason = reason;
        this.errorListeners.forEach((l) => l(reason));
        this.leave();
      });
  }

  private push(event: 'update' | 'awareness', data: Uint8Array): Promise<void> {
    if (this._closed) {
      return Promise.reject(new ChannelReplyError(event, { reason: 'closed' }));
    }
    if (data.byteLength > DOC_FRAME_MAX_BYTES) {
      return Promise.reject(new ChannelReplyError(event, { reason: 'too_large' }));
    }
    return new Promise((resolve, reject) => {
      this.channel
        .push(event, { data: toBase64(data) })
        .receive('ok', () => resolve())
        .receive('error', (reply: unknown) => reject(new ChannelReplyError(event, reply)))
        .receive('timeout', () => reject(new ChannelReplyError(event, { reason: 'timeout' })));
    });
  }

  private emit(set: Set<(f: DocFrame) => void>, payload: unknown): void {
    const p = (payload ?? {}) as { user_id?: unknown; data?: unknown };
    if (typeof p.data !== 'string') return;
    let data: Uint8Array;
    try {
      data = fromBase64(p.data);
    } catch {
      return;
    }
    const frame: DocFrame = { userId: typeof p.user_id === 'string' ? p.user_id : null, data };
    set.forEach((l) => l(frame));
  }
}

// Plain base64 without `btoa`/`Buffer`, so it runs the same in every
// runtime (browsers, Node, Hermes).
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET.charCodeAt(i)] = i;
  t['-'.charCodeAt(0)] = 62;
  t['_'.charCodeAt(0)] = 63;
  return t;
})();

/** @internal */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out +=
      ALPHABET[n >> 18]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += ALPHABET[n >> 18]! + ALPHABET[(n >> 12) & 63]! + '==';
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += ALPHABET[n >> 18]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + '=';
  }
  return out;
}

/** @internal Accepts standard and URL-safe base64, padded or not. */
export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[\s=]+/g, '');
  if (clean.length % 4 === 1) throw new Error('invalid base64');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean.charCodeAt(i);
    const v = c < 128 ? LOOKUP[c]! : -1;
    if (v < 0) throw new Error('invalid base64');
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}
