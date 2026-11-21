// Unsent drafts, one per client (server + user) and conversation: the
// composer's text and the message being quoted (files aren't kept). Held
// in memory for the page — so switching conversations and back finds
// them — and written to a storage (localStorage by default) so a reload
// does too.

import type { Message, Poolse } from '@poolse/sdk';

/**
 * Where drafts persist. Sync or async (`AsyncStorage`-style) both work.
 * Values are opaque strings.
 */
export interface DraftStorage {
  get: (key: string) => string | null | undefined | Promise<string | null | undefined>;
  set: (key: string, value: string) => void | Promise<void>;
  remove: (key: string) => void | Promise<void>;
}

/** One conversation's unsent draft. */
export interface ConversationDraft {
  text: string;
  /** The message being quoted, if any. */
  replyTo: Message | null;
}

/** `window.localStorage`, every call guarded (private mode, blocked storage, SSR). */
export const localDraftStorage: DraftStorage = {
  get: (key) => {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Full or blocked: the in-memory copy still works for this page.
    }
  },
  remove: (key) => {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // ignore
    }
  },
};

/** The pre-3.8 key (no server in it); still read once, then moved. */
export function draftKey(userId: string, conversationId: string): string {
  return `poolse:draft:${userId}:${conversationId}`;
}

const isEmpty = (d: ConversationDraft) => d.text.trim() === '' && !d.replyTo;

/**
 * One client's drafts: held in memory for the page (so switching
 * conversations, or workspaces, and back finds them) and written to a
 * storage under the client's namespace (server + user), so two
 * workspaces never see each other's drafts. Cleared from storage by
 * `chat.destroy({ clearStorage: true })`.
 */
export class DraftScope {
  private readonly memory = new Map<string, ConversationDraft>();
  /** Storages written to, and the keys written to each. */
  private readonly written = new Map<DraftStorage, Set<string>>();

  constructor(private readonly namespace: () => string | null) {}

  /** The storage key for a conversation's draft; null until the namespace is known. */
  key(conversationId: string): string | null {
    const ns = this.namespace();
    return ns ? `${ns}:draft:${conversationId}` : null;
  }

  /** The draft for `key`: from memory, else from `storage` (else from `legacyKey`, moved over). */
  read(
    storage: DraftStorage,
    key: string,
    legacyKey?: string,
  ): ConversationDraft | null | Promise<ConversationDraft | null> {
    const held = this.memory.get(key);
    if (held) return held;
    const hold = (d: ConversationDraft | null) => {
      if (d && !this.memory.has(key)) this.memory.set(key, d);
      return this.memory.get(key) ?? d;
    };
    const fromLegacy = (): ConversationDraft | null | Promise<ConversationDraft | null> => {
      if (!legacyKey) return null;
      const old = safeGet(storage, legacyKey);
      const move = (raw: string | null | undefined) => {
        const d = parse(raw);
        if (!d) return null;
        this.write(storage, key, d);
        swallow(() => storage.remove(legacyKey));
        return hold(d);
      };
      return old instanceof Promise ? old.then(move, () => null) : move(old);
    };
    const raw = safeGet(storage, key);
    const take = (r: string | null | undefined) => {
      const d = parse(r);
      return d ? hold(d) : fromLegacy();
    };
    return raw instanceof Promise ? raw.then(take, () => null) : take(raw);
  }

  /** Save (or, when empty, drop) the draft for `key`. */
  write(storage: DraftStorage, key: string, draft: ConversationDraft): void {
    if (isEmpty(draft)) {
      this.clear(storage, key);
      return;
    }
    this.memory.set(key, draft);
    this.track(storage, key);
    const value = JSON.stringify({ v: 1, text: draft.text, replyTo: draft.replyTo });
    swallow(() => storage.set(key, value));
  }

  clear(storage: DraftStorage, key: string): void {
    this.memory.delete(key);
    swallow(() => storage.remove(key));
  }

  /** Called by `chat.destroy()`. @internal */
  async destroy(opts: { clearStorage: boolean }): Promise<void> {
    this.memory.clear();
    if (!opts.clearStorage) return;
    const ns = this.namespace();
    const storages = new Set([...this.written.keys(), localDraftStorage]);
    for (const storage of storages) {
      const keys = new Set(this.written.get(storage) ?? []);
      if (ns) {
        try {
          const raw = await storage.get(indexKey(ns));
          const listed: unknown = raw ? JSON.parse(raw) : [];
          if (Array.isArray(listed)) for (const k of listed) if (typeof k === 'string') keys.add(k);
        } catch {
          // ignore
        }
        swallow(() => storage.remove(indexKey(ns)));
      }
      for (const k of keys) swallow(() => storage.remove(k));
    }
    this.written.clear();
  }

  // Remember the key in an index entry, so a sign-out finds drafts
  // written in earlier sessions too.
  private track(storage: DraftStorage, key: string): void {
    let keys = this.written.get(storage);
    if (!keys) {
      keys = new Set();
      this.written.set(storage, keys);
    }
    if (keys.has(key)) return;
    keys.add(key);
    const ns = this.namespace();
    if (!ns) return;
    const all = keys;
    const merge = (raw: string | null | undefined) => {
      let listed: string[] = [];
      try {
        const v: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(v)) listed = v.filter((k): k is string => typeof k === 'string');
      } catch {
        // A broken index: start over.
      }
      const next = [...new Set([...listed, ...all])];
      swallow(() => storage.set(indexKey(ns), JSON.stringify(next)));
    };
    const raw = safeGet(storage, indexKey(ns));
    if (raw instanceof Promise) void raw.then(merge, () => undefined);
    else merge(raw);
  }
}

/** The drafts of one client (made on first use, dropped with it). */
export function draftsOf(chat: Poolse): DraftScope {
  return chat.scoped('react-ui:drafts', (c) => new DraftScope(() => c.namespace));
}

const indexKey = (ns: string) => `${ns}:draft-index`;

function safeGet(storage: DraftStorage, key: string): ReturnType<DraftStorage['get']> {
  try {
    return storage.get(key);
  } catch {
    return null;
  }
}

function swallow(fn: () => void | Promise<void>): void {
  try {
    const r = fn();
    if (r && typeof (r as Promise<void>).catch === 'function') {
      (r as Promise<void>).catch(() => undefined);
    }
  } catch {
    // Storage is best-effort.
  }
}

function parse(raw: string | null | undefined): ConversationDraft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { text?: unknown; replyTo?: unknown };
    const text = typeof v.text === 'string' ? v.text : '';
    const replyTo =
      v.replyTo && typeof v.replyTo === 'object' && typeof (v.replyTo as Message).id === 'string'
        ? (v.replyTo as Message)
        : null;
    const draft = { text, replyTo };
    return isEmpty(draft) ? null : draft;
  } catch {
    return null;
  }
}
