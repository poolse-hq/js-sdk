/**
 * Offline queue for notes (NT9). Edits made offline wait here, with the
 * revision they were made on, and go out in order when the app is back
 * online. The queue holds plaintext the app will seal at send time (the
 * revision is part of the associated data, so a note can only be sealed
 * once its `base_revision` is known), so it is stored encrypted under a key
 * derived from the account key.
 *
 *   const outbox = await NoteOutbox.load({ storage, accountKey });
 *   await outbox.put(note.id, note.revision, { title, body, metadata });
 *   await outbox.flush({ send, resolve });   // on reconnect, after a write, on a timer
 *
 * Several edits of one note collapse into one write on the oldest
 * `baseRevision`, so one offline session makes one revision.
 */
import { fromUtf8, utf8 } from './bytes';
import { PoolseCryptoError } from './errors';
import { DOMAIN } from './format';
import { decryptBytes, encryptBytes } from './item';
import { type AccountKey, ItemKey, secretOf } from './keys';
import { hkdf, label } from './subtle';

/** One waiting write. `data` is whatever the app needs to seal it (plaintext). */
export interface OutboxEntry<T> {
  noteId: string;
  op: 'put' | 'delete';
  /** The revision the edit was made on (0 for a note made offline). */
  baseRevision: number;
  data: T | null;
  /** When it was queued (ms). */
  queuedAt: number;
  /** Failed attempts so far. */
  attempts: number;
}

/** Where the sealed queue lives: a file, IndexedDB, AsyncStorage… */
export interface OutboxStorage {
  read(): Promise<Uint8Array | null>;
  write(data: Uint8Array): Promise<void>;
}

/** What `send` reports for one write. */
export type OutboxSendResult<T> =
  | { status: 'ok'; revision: number }
  /** `409 revision_conflict`: the server's current note, decrypted by the app. */
  | { status: 'conflict'; revision: number; current: T | null }
  /** Gone for good (deleted, access lost): drop the entry. */
  | { status: 'gone' };

export interface FlushOptions<T> {
  /** Seal and send one write (`PUT /notes/:id` with `base_revision`, or `DELETE`). Throw to stop and retry later. */
  send: (entry: OutboxEntry<T>) => Promise<OutboxSendResult<T>>;
  /**
   * Merge a conflicting edit with the server's version (`current`). Return
   * the data to write on top of `revision`, or `null` to drop the local
   * edit. Default: keep the local edit (last writer wins).
   */
  resolve?: (
    local: T | null,
    current: T | null,
    entry: OutboxEntry<T>,
  ) => T | null | Promise<T | null>;
  /** Called after each accepted write with the note's new revision. */
  onWritten?: (noteId: string, revision: number) => void;
  /** Conflicts retried per entry before it's dropped. Default 3. */
  maxConflicts?: number;
}

export interface FlushResult {
  written: string[];
  dropped: string[];
  /** Entries still waiting (the send threw). */
  pending: number;
  error?: unknown;
}

export class NoteOutbox<T> {
  #entries: OutboxEntry<T>[];
  #storage: OutboxStorage;
  #key: ItemKey;
  #flushing: Promise<FlushResult> | null = null;
  /** The entry being sent right now, if any. */
  #sending: OutboxEntry<T> | null = null;

  private constructor(entries: OutboxEntry<T>[], storage: OutboxStorage, key: ItemKey) {
    this.#entries = entries;
    this.#storage = storage;
    this.#key = key;
  }

  /**
   * Open the stored queue. A queue that can't be read — corrupt, written by
   * a newer version, or sealed under another account key (a different
   * account signed in on this device) — throws by default, on every start.
   * With `ifUnreadable: 'discard'` it starts empty instead (the unreadable
   * edits are lost; `discardedUnreadable` says so, to tell the user), and
   * the next save replaces it.
   */
  static async load<T>(options: {
    storage: OutboxStorage;
    accountKey: AccountKey;
    ifUnreadable?: 'throw' | 'discard';
  }): Promise<NoteOutbox<T>> {
    const key = await outboxKey(options.accountKey);
    const sealed = await options.storage.read();
    let entries: OutboxEntry<T>[] = [];
    let discarded = false;
    if (sealed && sealed.length > 0) {
      try {
        const text = fromUtf8(await decryptBytes(key, sealed, AD));
        const parsed = JSON.parse(text) as { v?: number; entries?: OutboxEntry<T>[] };
        if (parsed.v !== 1 || !Array.isArray(parsed.entries)) {
          throw new PoolseCryptoError('unsupported', 'Unknown outbox version');
        }
        entries = parsed.entries;
      } catch (err) {
        if (options.ifUnreadable !== 'discard') throw err;
        discarded = true;
      }
    }
    const box = new NoteOutbox<T>(entries, options.storage, key);
    box.discardedUnreadable = discarded;
    return box;
  }

  /** `load` found a queue it couldn't read and started empty (`ifUnreadable: 'discard'`). */
  discardedUnreadable = false;

  /** Waiting writes, oldest first. */
  get entries(): readonly OutboxEntry<T>[] {
    return this.#entries;
  }

  /** Whether a note has unsent edits (show "Not synced yet"). */
  isPending(noteId: string): boolean {
    return this.#entries.some((e) => e.noteId === noteId);
  }

  /** Queue an edit (or a new note, `baseRevision` 0). Replaces an earlier queued edit of the note. */
  async put(noteId: string, baseRevision: number, data: T): Promise<void> {
    this.#enqueue(noteId, 'put', baseRevision, data);
    await this.#save();
  }

  /** Queue a delete. A note made offline and never sent is just forgotten. */
  async delete(noteId: string, baseRevision: number): Promise<void> {
    const prior = this.#entries.find((e) => e.noteId === noteId);
    // Never sent, and not being sent right now: nothing on the server to
    // delete. One in flight may be created by the time this returns, so
    // it gets a real delete, based on the revision that send writes.
    if (prior && prior.baseRevision === 0 && this.#sending?.noteId !== noteId) {
      this.#entries = this.#entries.filter((e) => e.noteId !== noteId);
    } else {
      this.#enqueue(noteId, 'delete', baseRevision, null);
    }
    await this.#save();
  }

  /** Send everything, in order. Concurrent calls share one run. */
  flush(options: FlushOptions<T>): Promise<FlushResult> {
    this.#flushing ??= this.#flush(options).finally(() => {
      this.#flushing = null;
    });
    return this.#flushing;
  }

  async #flush(options: FlushOptions<T>): Promise<FlushResult> {
    const result: FlushResult = { written: [], dropped: [], pending: 0 };
    const maxConflicts = options.maxConflicts ?? 3;
    while (this.#entries.length > 0) {
      let current = this.#entries[0]!;
      let conflicts = 0;
      let done = false;
      while (!done) {
        let res: OutboxSendResult<T>;
        this.#sending = current;
        try {
          res = await options.send(current);
        } catch (error) {
          current.attempts += 1;
          await this.#save();
          result.pending = this.#entries.length;
          result.error = error;
          return result;
        } finally {
          this.#sending = null;
        }
        // While that send was out, put() may have replaced the entry with a
        // newer edit, or delete() may have queued a delete: those are newer
        // than what was just written and must not be lost. Find the note's
        // entry again by id, and compare it with what was sent.
        const i = this.#entries.findIndex((e) => e.noteId === current.noteId);
        const newer = i !== -1 && this.#entries[i] !== current ? this.#entries[i]! : null;
        if (res.status === 'ok') {
          result.written.push(current.noteId);
          options.onWritten?.(current.noteId, res.revision);
          if (newer) {
            // Sent next, on top of the revision just written.
            this.#entries[i] = { ...newer, baseRevision: res.revision };
          } else if (i !== -1) {
            this.#entries.splice(i, 1);
          }
          done = true;
        } else if (res.status === 'gone') {
          result.dropped.push(current.noteId);
          if (i !== -1) this.#entries.splice(i, 1);
          done = true;
        } else {
          conflicts += 1;
          // Resolve the newest local version against the server's.
          const base = newer ?? current;
          const merged =
            base.op === 'delete'
              ? null
              : options.resolve
                ? await options.resolve(base.data, res.current, base)
                : base.data;
          if (conflicts > maxConflicts || (base.op === 'put' && merged === null)) {
            result.dropped.push(current.noteId);
            const j = this.#entries.findIndex((e) => e.noteId === current.noteId);
            if (j !== -1) this.#entries.splice(j, 1);
            done = true;
          } else {
            const j = this.#entries.findIndex((e) => e.noteId === current.noteId);
            if (j === -1) {
              // Deleted locally while resolving: nothing left to send.
              done = true;
            } else {
              // Another edit may have landed while resolving; it wins.
              const latest = this.#entries[j]!;
              current =
                latest === base
                  ? { ...base, baseRevision: res.revision, data: merged }
                  : { ...latest, baseRevision: res.revision };
              this.#entries[j] = current;
            }
          }
        }
      }
      await this.#save();
    }
    return result;
  }

  #enqueue(noteId: string, op: 'put' | 'delete', baseRevision: number, data: T | null): void {
    const i = this.#entries.findIndex((e) => e.noteId === noteId);
    if (i !== -1) {
      const prior = this.#entries[i]!;
      // Keep the revision the first offline edit was made on.
      this.#entries[i] = { ...prior, op, data, queuedAt: Date.now() };
      return;
    }
    this.#entries.push({ noteId, op, baseRevision, data, queuedAt: Date.now(), attempts: 0 });
  }

  async #save(): Promise<void> {
    const text = JSON.stringify({ v: 1, entries: this.#entries });
    await this.#storage.write(await encryptBytes(this.#key, utf8(text), AD));
  }
}

const AD = { itemId: 'notes-outbox' } as const;

async function outboxKey(accountKey: AccountKey): Promise<ItemKey> {
  const raw = await hkdf(
    secretOf(accountKey),
    new Uint8Array(0),
    label(DOMAIN, 'key/notes-outbox'),
  );
  return ItemKey.fromBytes(raw, 1);
}

/** An in-memory `OutboxStorage` for tests. */
export class MemoryOutboxStorage implements OutboxStorage {
  data: Uint8Array | null = null;
  async read(): Promise<Uint8Array | null> {
    return this.data;
  }
  async write(data: Uint8Array): Promise<void> {
    this.data = data;
  }
}
