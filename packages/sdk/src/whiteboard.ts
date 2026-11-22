// A shared whiteboard for a call (CL12): strokes, shapes, text and an
// eraser, kept in a Yjs document synced over the doc relay
// (docs/DOCS_RELAY.md) and saved with the meeting by the server.
//
//   import * as Y from 'yjs';
//   const access = await poolse.live.whiteboard(callId);
//   const board = openWhiteboard(poolse, Y, access);
//   board.subscribe((items) => render(items));
//   board.add({ kind: 'stroke', points: [10, 10, 40, 60], color: '#1f6feb', width: 3 });
//   board.eraseAt(25, 35);
//   board.undo();
//   board.close();
//
// Yjs is passed in, never imported, for the same reason livekit-client is
// (see voice/livekit-types.ts): it stays an optional peer, and only an app
// that shows a board pays for it.

import type { DocChannel } from './realtime/doc.js';
import type { WhiteboardAccess } from './meetings-live.js';

// ── structural Yjs ───────────────────────────────────────────────────────

/** The slice of a `Y.Map` the board uses. */
export interface YMapLike {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
  delete(key: string): void;
  has(key: string): boolean;
  forEach(fn: (value: unknown, key: string) => void): void;
  observe(fn: () => void): void;
  unobserve(fn: () => void): void;
}

/** The slice of a `Y.Doc` the board uses. */
export interface YDocLike {
  clientID: number;
  getMap(name: string): YMapLike;
  transact(fn: () => void, origin?: unknown): void;
  on(event: 'update', fn: (update: Uint8Array, origin: unknown) => void): void;
  off(event: 'update', fn: (update: Uint8Array, origin: unknown) => void): void;
  destroy(): void;
}

export interface YUndoManagerLike {
  undo(): unknown;
  redo(): unknown;
  canUndo?(): boolean;
  canRedo?(): boolean;
  destroy(): void;
}

/**
 * `yjs`, imported by your app (`import * as Y from 'yjs'`). Loose on
 * purpose — see `LiveKitModule` for why a precise signature would refuse
 * the real module.
 */
export interface YjsModule {
  Doc: new (...args: never[]) => unknown;
  UndoManager?: new (...args: never[]) => unknown;
  applyUpdate(doc: never, update: Uint8Array, origin?: unknown): void;
  encodeStateAsUpdate(doc: never, stateVector?: Uint8Array): Uint8Array;
  encodeStateVector(doc: never): Uint8Array;
}

// ── the board's items ────────────────────────────────────────────────────

/** Board coordinates: a 1600 × 900 canvas; anything outside still draws. */
export const WHITEBOARD_SIZE = { width: 1600, height: 900 } as const;

export const WHITEBOARD_LIMITS = {
  items: 5000,
  pointsPerStroke: 4000,
  textLength: 500,
} as const;

export type WhiteboardShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow';

interface ItemBase {
  id: string;
  /** Stacking order: later on top. */
  z: number;
  color: string;
  /** The user who drew it. */
  by: string | null;
}

export interface WhiteboardStroke extends ItemBase {
  kind: 'stroke';
  /** Flat `[x0, y0, x1, y1, …]` in board coordinates. */
  points: number[];
  width: number;
}

export interface WhiteboardShape extends ItemBase {
  kind: WhiteboardShapeKind;
  /** For lines and arrows: from (x, y) to (x + w, y + h); w and h may be negative. */
  x: number;
  y: number;
  w: number;
  h: number;
  width: number;
  fill: string | null;
}

export interface WhiteboardText extends ItemBase {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  /** Font size in board units. */
  size: number;
}

export type WhiteboardItem = WhiteboardStroke | WhiteboardShape | WhiteboardText;

/** What `add` takes: an item without the fields the board fills in. */
export type NewWhiteboardItem =
  | Omit<WhiteboardStroke, 'id' | 'z' | 'by'>
  | (Omit<WhiteboardShape, 'id' | 'z' | 'by' | 'fill'> & { fill?: string | null })
  | Omit<WhiteboardText, 'id' | 'z' | 'by'>;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const color = (c: unknown): string =>
  typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : '#1f2328';

/** One stored value → an item, or null for anything malformed (never trusted). */
export function whiteboardItemOf(id: string, raw: unknown): WhiteboardItem | null {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!o) return null;
  const base = {
    id,
    z: finite(o.z) ? o.z : 0,
    color: color(o.color),
    by: typeof o.by === 'string' ? o.by : null,
  };
  switch (o.kind) {
    case 'stroke': {
      const points = Array.isArray(o.points) ? o.points.filter(finite) : [];
      if (points.length < 2) return null;
      return {
        ...base,
        kind: 'stroke',
        points: points.slice(0, WHITEBOARD_LIMITS.pointsPerStroke * 2 - (points.length % 2)),
        width: finite(o.width) ? Math.min(64, Math.max(1, o.width)) : 3,
      };
    }
    case 'rect':
    case 'ellipse':
    case 'line':
    case 'arrow':
      if (!finite(o.x) || !finite(o.y) || !finite(o.w) || !finite(o.h)) return null;
      return {
        ...base,
        kind: o.kind,
        x: o.x,
        y: o.y,
        w: o.w,
        h: o.h,
        width: finite(o.width) ? Math.min(64, Math.max(1, o.width)) : 3,
        fill: typeof o.fill === 'string' && o.fill ? color(o.fill) : null,
      };
    case 'text':
      if (!finite(o.x) || !finite(o.y) || typeof o.text !== 'string' || !o.text.trim()) return null;
      return {
        ...base,
        kind: 'text',
        x: o.x,
        y: o.y,
        text: o.text.slice(0, WHITEBOARD_LIMITS.textLength),
        size: finite(o.size) ? Math.min(200, Math.max(8, o.size)) : 28,
      };
    default:
      return null;
  }
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Whether a point (with `radius` of slack) touches an item — the eraser's test. */
export function whiteboardHit(item: WhiteboardItem, x: number, y: number, radius = 8): boolean {
  switch (item.kind) {
    case 'stroke': {
      const p = item.points;
      const r = radius + item.width / 2;
      if (p.length === 2) return Math.hypot(x - p[0]!, y - p[1]!) <= r;
      for (let i = 0; i + 3 < p.length; i += 2) {
        if (distToSegment(x, y, p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!) <= r) return true;
      }
      return false;
    }
    case 'line':
    case 'arrow':
      return (
        distToSegment(x, y, item.x, item.y, item.x + item.w, item.y + item.h) <=
        radius + item.width / 2
      );
    case 'rect':
    case 'ellipse': {
      const x0 = Math.min(item.x, item.x + item.w) - radius;
      const y0 = Math.min(item.y, item.y + item.h) - radius;
      const x1 = Math.max(item.x, item.x + item.w) + radius;
      const y1 = Math.max(item.y, item.y + item.h) + radius;
      return x >= x0 && x <= x1 && y >= y0 && y <= y1;
    }
    case 'text': {
      const w = item.text.length * item.size * 0.6;
      return (
        x >= item.x - radius &&
        x <= item.x + w + radius &&
        y >= item.y - item.size - radius &&
        y <= item.y + radius
      );
    }
  }
}

// ── the model ────────────────────────────────────────────────────────────

const LOCAL = Symbol('whiteboard-local');

/**
 * The board over a Y.Doc: items live in the `items` map, keyed by id,
 * each a plain JSON value (edits replace the whole item — last writer
 * wins per item). Works on any Y.Doc; {@link openWhiteboard} also syncs
 * it over the relay.
 */
export class WhiteboardModel {
  private readonly items: YMapLike;
  private readonly undoManager: YUndoManagerLike | null;
  private readonly listeners = new Set<(items: WhiteboardItem[]) => void>();
  private cache: WhiteboardItem[] = [];
  private readonly onChange = () => {
    this.cache = this.read();
    for (const fn of this.listeners) fn(this.cache);
  };
  private zTop = 0;

  constructor(
    Y: YjsModule,
    public readonly doc: YDocLike,
    private readonly selfUserId: string | null = null,
  ) {
    this.items = doc.getMap('items');
    const UM = Y.UndoManager as
      | (new (type: YMapLike, opts: { trackedOrigins: Set<unknown> }) => YUndoManagerLike)
      | undefined;
    // Undo only what this person did, never someone else's lines.
    this.undoManager = UM ? new UM(this.items, { trackedOrigins: new Set([LOCAL]) }) : null;
    this.items.observe(this.onChange);
    this.cache = this.read();
  }

  /** Every item, bottom to top. */
  getItems(): WhiteboardItem[] {
    return this.cache;
  }

  subscribe(fn: (items: WhiteboardItem[]) => void): () => void {
    this.listeners.add(fn);
    fn(this.cache);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Add an item; returns its id, or null when the board is full or the item is malformed. */
  add(item: NewWhiteboardItem): string | null {
    let size = 0;
    this.items.forEach(() => size++);
    if (size >= WHITEBOARD_LIMITS.items) return null;
    const id = `${this.doc.clientID.toString(36)}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const value = { ...item, z: ++this.zTop, by: this.selfUserId };
    if (!whiteboardItemOf(id, value)) return null;
    this.doc.transact(() => this.items.set(id, value), LOCAL);
    return id;
  }

  /** Replace an item's fields (a stroke growing as it is drawn, text being edited). */
  update(id: string, patch: Partial<NewWhiteboardItem>): void {
    const current = this.items.get(id);
    if (!current || typeof current !== 'object') return;
    const next = { ...(current as object), ...patch };
    if (!whiteboardItemOf(id, next)) return;
    this.doc.transact(() => this.items.set(id, next), LOCAL);
  }

  remove(ids: string | readonly string[]): void {
    const list = typeof ids === 'string' ? [ids] : ids;
    this.doc.transact(() => {
      for (const id of list) if (this.items.has(id)) this.items.delete(id);
    }, LOCAL);
  }

  /** Erase whatever is under (x, y): the top-most item hit, or all hit with `all`. */
  eraseAt(x: number, y: number, opts: { radius?: number; all?: boolean } = {}): string[] {
    const hit = this.cache.filter((i) => whiteboardHit(i, x, y, opts.radius ?? 8));
    if (hit.length === 0) return [];
    const ids = opts.all ? hit.map((i) => i.id) : [hit[hit.length - 1]!.id];
    this.remove(ids);
    return ids;
  }

  /** Remove everything (one undo step). */
  clear(): void {
    this.remove(this.cache.map((i) => i.id));
  }

  undo(): void {
    this.undoManager?.undo();
  }

  redo(): void {
    this.undoManager?.redo();
  }

  destroy(): void {
    this.items.unobserve(this.onChange);
    this.undoManager?.destroy();
    this.listeners.clear();
  }

  private read(): WhiteboardItem[] {
    const out: WhiteboardItem[] = [];
    this.items.forEach((value, key) => {
      const item = whiteboardItemOf(key, value);
      if (item) out.push(item);
    });
    out.sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
    this.zTop = Math.max(this.zTop, out.length ? out[out.length - 1]!.z : 0);
    return out;
  }
}

// ── syncing a Y.Doc over the relay ───────────────────────────────────────

/**
 * Keep a Y.Doc in sync with one {@link DocChannel}: sync on every
 * (re)join, apply remote updates, send local ones. Returns a function
 * that unbinds (the channel and the doc stay open).
 */
export function bindYDoc(Y: YjsModule, ydoc: YDocLike, channel: DocChannel): () => void {
  const origin = Symbol('relay');
  const doc = ydoc as never;
  let canWrite = false;
  const offs = [
    channel.onJoined((info) => {
      canWrite = info.rights === 'write';
      void channel.requestSync(Y.encodeStateVector(doc)).catch(() => {});
    }),
    channel.onUpdate((u) => Y.applyUpdate(doc, u, origin)),
    channel.onSyncReply((u) => Y.applyUpdate(doc, u, origin)),
    channel.onSyncRequest(({ fromPeer, stateVector }) => {
      void channel.sendSyncReply(fromPeer, Y.encodeStateAsUpdate(doc, stateVector)).catch(() => {});
    }),
  ];
  const onLocal = (update: Uint8Array, from: unknown) => {
    if (from === origin || !canWrite) return;
    void channel.sendUpdate(update).catch(() => {});
  };
  ydoc.on('update', onLocal);
  return () => {
    offs.forEach((off) => off());
    ydoc.off('update', onLocal);
  };
}

/** What {@link openWhiteboard} returns: the model plus the connection behind it. */
export interface OpenWhiteboard {
  model: WhiteboardModel;
  channel: DocChannel;
  /** The relay said you may only look (a guest, or an ended meeting). */
  readOnly: () => boolean;
  close: () => void;
}

/**
 * Open a call's whiteboard: a fresh Y.Doc, synced over
 * `poolse.realtime.doc(access.docId, access.docToken)`. `refreshAccess`
 * is asked for a new token at ~80 % of the old one's lifetime (pass
 * `() => poolse.live.whiteboard(callId)`).
 */
export function openWhiteboard(
  poolse: {
    realtime: { doc(docId: string, token: string, opts?: { clientId?: number }): DocChannel };
  },
  Y: YjsModule,
  access: WhiteboardAccess,
  opts: { selfUserId?: string | null; refreshAccess?: () => Promise<WhiteboardAccess> } = {},
): OpenWhiteboard {
  const ydoc = new (Y.Doc as unknown as new () => YDocLike)();
  const channel = poolse.realtime.doc(access.docId, access.docToken, { clientId: ydoc.clientID });
  const unbind = bindYDoc(Y, ydoc, channel);
  const model = new WhiteboardModel(Y, ydoc, opts.selfUserId ?? null);
  let rights = access.rights;
  const offJoined = channel.onJoined((info) => {
    rights = info.rights;
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = (expiresAt: string | null) => {
    if (!opts.refreshAccess || !expiresAt) return;
    const left = Date.parse(expiresAt) - Date.now();
    if (!Number.isFinite(left)) return;
    timer = setTimeout(
      () => {
        void opts.refreshAccess!()
          .then((next) => channel.refresh(next.docToken).then(() => schedule(next.expiresAt)))
          .catch(() => {});
      },
      Math.max(5_000, left * 0.8),
    );
  };
  schedule(access.expiresAt);

  return {
    model,
    channel,
    readOnly: () => rights !== 'write',
    close: () => {
      if (timer) clearTimeout(timer);
      offJoined();
      unbind();
      model.destroy();
      channel.leave();
      ydoc.destroy();
    },
  };
}
