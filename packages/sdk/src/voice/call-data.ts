// Things that travel peer to peer over a call's data channel, through the
// SFU, never stored: reactions floating over the call (CL6) and the
// pointer and drawings on a shared screen (CL4).
//
//   const reactions = new CallReactions(room);
//   reactions.subscribe((r) => float(r.emoji, r.name));
//   reactions.send('👏');
//
//   const ink = new ScreenAnnotations(room, sharerUserId);
//   ink.subscribe((state) => draw(state));
//   const id = ink.begin({ color: '#e5484d' }); ink.extend(id, 0.4, 0.3); ink.end(id);
//
// Coordinates are fractions of the shared picture (0–1 on both axes), so
// a 4K screen and a phone draw in the same place.
//
// Both take any CallDataChannel: the web CallRoom, or @poolse/native's
// `callData` on phones — the same topics and messages either way.

import { CALL_DATA_MAX_BYTES, type CallDataSender, type Unsubscribe } from './call-room.js';

/**
 * What reactions and annotations need of a call: JSON messages by topic
 * over its data channel. `CallRoom` is one; @poolse/native's `callData`
 * is the native call core's.
 */
export interface CallDataChannel {
  /** Your user id (the media identity); null before connecting. */
  getSelfId(): string | null;
  /** Send to everyone (or `to`); false when not connected or over {@link CALL_DATA_MAX_BYTES}. */
  sendData(
    topic: string,
    message: unknown,
    opts?: { reliable?: boolean; to?: string[] },
  ): Promise<boolean>;
  /** Messages others sent under `topic` (yours are not echoed back). */
  onData(topic: string, fn: (message: unknown, from: CallDataSender) => void): Unsubscribe;
}

export const REACTION_TOPIC = 'poolse.reaction';
export const ANNOTATION_TOPIC = 'poolse.annotate';

/** The reactions offered by default; any short emoji is accepted. */
export const DEFAULT_CALL_REACTIONS = ['👍', '👏', '😂', '❤️', '🎉', '😮', '🙌', '🤔'] as const;

/** One reaction shown over the call. */
export interface CallReaction {
  /** Local id for list keys. */
  id: string;
  emoji: string;
  userId: string | null;
  name: string | null;
  isSelf: boolean;
  at: number;
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

/** True for a string that can be shown as one reaction: short, no letters or digits. */
export function isReactionEmoji(s: unknown): s is string {
  return (
    typeof s === 'string' &&
    s.length > 0 &&
    s.length <= 16 &&
    !/[\p{L}\p{N}\s<>]/u.test(s.replace(/️|‍/g, ''))
  );
}

/**
 * Reactions over the call's data channel. Your own come back to your
 * listeners at once (others never echo). Sending is held to 4 a second
 * and incoming to 10 a second per person, so a stuck key or a noisy
 * peer can't flood the screen.
 */
export class CallReactions {
  private readonly listeners = new Set<(r: CallReaction) => void>();
  private readonly sentAt: number[] = [];
  private readonly received = new Map<string, number[]>();
  private readonly off: Unsubscribe;

  constructor(private readonly room: CallDataChannel) {
    this.off = room.onData(REACTION_TOPIC, (msg, from) => {
      const emoji = (msg as { emoji?: unknown } | null)?.emoji;
      if (!isReactionEmoji(emoji)) return;
      const key = from.userId ?? '';
      if (!this.allow(this.received.get(key) ?? [], 10, (l) => this.received.set(key, l))) return;
      this.emit({
        id: nextId('r'),
        emoji,
        userId: from.userId,
        name: from.name,
        isSelf: false,
        at: Date.now(),
      });
    });
  }

  subscribe(fn: (r: CallReaction) => void): Unsubscribe {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Send a reaction to everyone. False when over the rate or not connected. */
  async send(emoji: string): Promise<boolean> {
    if (!isReactionEmoji(emoji)) return false;
    if (!this.allow(this.sentAt, 4)) return false;
    this.emit({
      id: nextId('r'),
      emoji,
      userId: this.room.getSelfId(),
      name: null,
      isSelf: true,
      at: Date.now(),
    });
    return this.room.sendData(REACTION_TOPIC, { v: 1, emoji }, { reliable: false });
  }

  destroy(): void {
    this.off();
    this.listeners.clear();
  }

  private allow(list: number[], perSecond: number, save?: (l: number[]) => void): boolean {
    const now = Date.now();
    while (list.length && now - list[0]! > 1000) list.shift();
    if (list.length >= perSecond) return false;
    list.push(now);
    save?.(list);
    return true;
  }

  private emit(r: CallReaction): void {
    for (const fn of this.listeners) fn(r);
  }
}

// ── annotations on a shared screen (CL4) ─────────────────────────────────

/** One line drawn on a shared screen. Points are flat `[x0, y0, x1, y1, …]` in 0–1. */
export interface AnnotationStroke {
  id: string;
  userId: string | null;
  color: string;
  /** Line width as a fraction of the picture's width (0.004 ≈ 4 px on 1000 px). */
  width: number;
  points: number[];
  done: boolean;
  /** When the last point arrived (ms) — for fading. */
  updatedAt: number;
}

export interface AnnotationPointer {
  userId: string;
  name: string | null;
  x: number;
  y: number;
  at: number;
}

export interface AnnotationState {
  /** The person whose screen this is. */
  sharerUserId: string;
  strokes: AnnotationStroke[];
  /** Other people's pointers, live. */
  pointers: AnnotationPointer[];
}

/** Limits that keep one share's drawing bounded. */
export const ANNOTATION_LIMITS = {
  pointsPerStroke: 4000,
  strokes: 300,
  /** A pointer not moved for this long is hidden. */
  pointerIdleMs: 3000,
  /** Pointer updates per second, sent. */
  pointerRate: 20,
} as const;

const clamp01 = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
const round = (n: number) => Math.round(n * 10000) / 10000;
const isColor = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c);

type Msg =
  | { t: 'ptr'; s: string; x: number; y: number }
  | { t: 'ptr_off'; s: string }
  | { t: 'stroke'; s: string; id: string; c: string; w: number; p: number[]; done: boolean }
  | { t: 'undo'; s: string; id: string }
  | { t: 'clear'; s: string };

/**
 * Pointer and drawing over one person's shared screen, synced over the
 * call's data channel. Everyone in the call can draw; the sharer (or
 * anyone) can `clear`. Lines appear as they are drawn: points are sent
 * in small batches every 50 ms while the line grows. Optional `fadeMs`
 * removes finished lines that long after they were drawn (a laser pen).
 *
 * Not stored, and not replayed to someone joining later — annotations
 * are for the moment. Scoped to `sharerUserId`: a new share starts
 * clean, and two people sharing at once each have their own layer.
 */
export class ScreenAnnotations {
  private strokes = new Map<string, AnnotationStroke>();
  private readonly pointers = new Map<string, AnnotationPointer>();
  private readonly listeners = new Set<(s: AnnotationState) => void>();
  /** Points of own strokes not sent yet. */
  private readonly pending = new Map<string, number[]>();
  private readonly mine: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private lastPointerAt = 0;
  private readonly off: Unsubscribe;

  constructor(
    private readonly room: CallDataChannel,
    public readonly sharerUserId: string,
    private readonly opts: { fadeMs?: number } = {},
  ) {
    this.off = room.onData(ANNOTATION_TOPIC, (raw, from) => this.receive(raw, from));
    this.sweepTimer = setInterval(() => this.sweep(), 1000);
  }

  getState(): AnnotationState {
    const now = Date.now();
    return {
      sharerUserId: this.sharerUserId,
      strokes: [...this.strokes.values()],
      pointers: [...this.pointers.values()].filter(
        (p) => now - p.at < ANNOTATION_LIMITS.pointerIdleMs,
      ),
    };
  }

  subscribe(fn: (s: AnnotationState) => void): Unsubscribe {
    this.listeners.add(fn);
    fn(this.getState());
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Move your pointer (lossy, at most 20 a second). */
  pointer(x: number, y: number): void {
    const now = Date.now();
    if (now - this.lastPointerAt < 1000 / ANNOTATION_LIMITS.pointerRate) return;
    this.lastPointerAt = now;
    const cx = clamp01(x);
    const cy = clamp01(y);
    if (cx === null || cy === null) return;
    void this.room.sendData(
      ANNOTATION_TOPIC,
      { v: 1, t: 'ptr', s: this.sharerUserId, x: round(cx), y: round(cy) },
      { reliable: false },
    );
  }

  /** Your pointer left the picture. */
  pointerOff(): void {
    void this.room.sendData(
      ANNOTATION_TOPIC,
      { v: 1, t: 'ptr_off', s: this.sharerUserId },
      { reliable: false },
    );
  }

  /** Start a line; returns its id for `extend` / `end`. */
  begin(style: { color?: string; width?: number } = {}): string {
    const id = nextId('s');
    const stroke: AnnotationStroke = {
      id,
      userId: this.room.getSelfId(),
      color: isColor(style.color) ? style.color : '#e5484d',
      width: Math.min(0.05, Math.max(0.001, style.width ?? 0.004)),
      points: [],
      done: false,
      updatedAt: Date.now(),
    };
    this.strokes.set(id, stroke);
    this.mine.push(id);
    this.trim();
    this.pending.set(id, []);
    this.emit();
    return id;
  }

  extend(id: string, x: number, y: number): void {
    const stroke = this.strokes.get(id);
    const cx = clamp01(x);
    const cy = clamp01(y);
    if (!stroke || stroke.done || cx === null || cy === null) return;
    if (stroke.points.length >= ANNOTATION_LIMITS.pointsPerStroke * 2) return;
    const p = [round(cx), round(cy)];
    stroke.points.push(...p);
    stroke.updatedAt = Date.now();
    this.pending.get(id)?.push(...p);
    this.emit();
    this.scheduleFlush();
  }

  end(id: string): void {
    const stroke = this.strokes.get(id);
    if (!stroke || stroke.done) return;
    stroke.done = true;
    stroke.updatedAt = Date.now();
    this.flush(id, true);
    this.emit();
  }

  /** Remove your last line, for everyone. */
  undo(): void {
    const id = this.mine.pop();
    if (!id) return;
    this.strokes.delete(id);
    this.pending.delete(id);
    void this.room.sendData(ANNOTATION_TOPIC, { v: 1, t: 'undo', s: this.sharerUserId, id });
    this.emit();
  }

  /** Remove every line, for everyone. */
  clear(): void {
    this.strokes.clear();
    this.pending.clear();
    this.mine.length = 0;
    void this.room.sendData(ANNOTATION_TOPIC, { v: 1, t: 'clear', s: this.sharerUserId });
    this.emit();
  }

  destroy(): void {
    this.off();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.flushTimer = null;
    this.sweepTimer = null;
    this.listeners.clear();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      for (const id of this.pending.keys()) this.flush(id, false);
    }, 50);
  }

  /** Send a stroke's unsent points, in pieces that fit one data message. */
  private flush(id: string, done: boolean): void {
    const stroke = this.strokes.get(id);
    const points = this.pending.get(id);
    if (!stroke || !points) return;
    if (points.length === 0 && !done) return;
    // ~14 bytes per coordinate pair as JSON: a safe batch under the cap.
    const per = Math.floor(CALL_DATA_MAX_BYTES / 16) * 2;
    do {
      const batch = points.splice(0, per);
      const last = done && points.length === 0;
      void this.room.sendData(ANNOTATION_TOPIC, {
        v: 1,
        t: 'stroke',
        s: this.sharerUserId,
        id,
        c: stroke.color,
        w: stroke.width,
        p: batch,
        done: last,
      });
    } while (points.length > 0);
    if (done) this.pending.delete(id);
  }

  private receive(raw: unknown, from: { userId: string | null; name: string | null }): void {
    const m = raw as Partial<Msg> | null;
    if (!m || m.s !== this.sharerUserId) return;
    switch (m.t) {
      case 'ptr': {
        const x = clamp01(m.x);
        const y = clamp01(m.y);
        if (!from.userId || x === null || y === null) return;
        this.pointers.set(from.userId, {
          userId: from.userId,
          name: from.name,
          x,
          y,
          at: Date.now(),
        });
        break;
      }
      case 'ptr_off':
        if (from.userId) this.pointers.delete(from.userId);
        break;
      case 'stroke': {
        if (typeof m.id !== 'string' || m.id.length > 40 || !Array.isArray(m.p)) return;
        let stroke = this.strokes.get(m.id);
        if (!stroke) {
          stroke = {
            id: m.id,
            userId: from.userId,
            color: isColor(m.c) ? m.c : '#e5484d',
            width: typeof m.w === 'number' ? Math.min(0.05, Math.max(0.001, m.w)) : 0.004,
            points: [],
            done: false,
            updatedAt: Date.now(),
          };
          this.strokes.set(m.id, stroke);
          this.trim();
        }
        if (stroke.userId !== from.userId) return;
        for (const n of m.p) {
          if (stroke.points.length >= ANNOTATION_LIMITS.pointsPerStroke * 2) break;
          const v = clamp01(n);
          if (v !== null) stroke.points.push(v);
        }
        if (stroke.points.length % 2 === 1) stroke.points.pop();
        stroke.done = m.done === true;
        stroke.updatedAt = Date.now();
        break;
      }
      case 'undo': {
        const s = typeof m.id === 'string' ? this.strokes.get(m.id) : undefined;
        if (s && s.userId === from.userId) this.strokes.delete(s.id);
        break;
      }
      case 'clear':
        this.strokes.clear();
        this.pending.clear();
        this.mine.length = 0;
        break;
      default:
        return;
    }
    this.emit();
  }

  /** Oldest lines go first once over the limit. */
  private trim(): void {
    while (this.strokes.size > ANNOTATION_LIMITS.strokes) {
      const first = this.strokes.keys().next().value;
      if (first === undefined) break;
      this.strokes.delete(first);
    }
  }

  private sweep(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, p] of this.pointers) {
      if (now - p.at >= ANNOTATION_LIMITS.pointerIdleMs) {
        this.pointers.delete(id);
        changed = true;
      }
    }
    const fade = this.opts.fadeMs ?? 0;
    if (fade > 0) {
      for (const [id, s] of this.strokes) {
        if (s.done && now - s.updatedAt >= fade) {
          this.strokes.delete(id);
          changed = true;
        }
      }
    }
    if (changed) this.emit();
  }

  private emit(): void {
    const state = this.getState();
    for (const fn of this.listeners) fn(state);
  }
}
