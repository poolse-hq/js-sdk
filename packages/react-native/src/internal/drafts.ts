// Unsent text + quote target per conversation — pure, so vitest can
// run it under node.

import type { Message, Poolse } from '@poolse/sdk';

/** What the composer held for a conversation. */
export interface ConversationDraft {
  text: string;
  /** The message being quote-replied to, if any. */
  quote: Message | null;
}

/**
 * Where `persistDrafts` keeps drafts between launches — MMKV,
 * AsyncStorage or anything with the same three calls. Values are JSON
 * strings; each call may return a promise.
 */
export interface DraftStorage {
  get: (key: string) => string | null | undefined | Promise<string | null | undefined>;
  set: (key: string, value: string) => void | Promise<void>;
  remove: (key: string) => void | Promise<void>;
}

export const DRAFT_KEY_PREFIX = 'poolse:draft:';

export function draftKey(conversationId: string): string {
  return `${DRAFT_KEY_PREFIX}${conversationId}`;
}

export function isEmptyDraft(d: ConversationDraft | null | undefined): boolean {
  return !d || (d.text.trim().length === 0 && !d.quote);
}

/** A stored draft, or null when the value isn't one. */
export function parseDraft(raw: string | null | undefined): ConversationDraft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ConversationDraft> | null;
    if (!v || typeof v !== 'object' || typeof v.text !== 'string') return null;
    const quote = v.quote && typeof v.quote === 'object' && 'id' in v.quote ? v.quote : null;
    return { text: v.text, quote: quote as Message | null };
  } catch {
    return null;
  }
}

/**
 * Drafts in memory — so a draft survives switching conversations (the
 * view remounts) — and written through to a `DraftStorage` when given
 * one. One store per client (`draftStoreOf(chat)`): its storage keys
 * carry the client's namespace (server + user), so two workspaces never
 * share a draft, and `chat.destroy({ clearStorage: true })` removes
 * exactly that client's drafts.
 */
export class DraftStore {
  private readonly memory = new Map<string, ConversationDraft>();
  private readonly written = new Map<DraftStorage, Set<string>>();

  /**
   * `namespace` resolves to the client's namespace; without it keys are
   * the pre-3.8 `poolse:draft:<conversation>` (tests, single client).
   */
  constructor(private readonly namespace?: () => Promise<string>) {}

  /** The in-memory draft, if any. */
  peek(conversationId: string): ConversationDraft | null {
    return this.memory.get(conversationId) ?? null;
  }

  /**
   * The draft: from memory, else from `storage` (which then seeds the
   * memory; a pre-3.8 key is moved over). Null when there's none, or
   * storage fails.
   */
  async load(conversationId: string, storage?: DraftStorage): Promise<ConversationDraft | null> {
    const inMemory = this.memory.get(conversationId);
    if (inMemory) return inMemory;
    if (!storage) return null;
    try {
      const key = await this.key(conversationId);
      let stored = parseDraft(await storage.get(key));
      const legacy = draftKey(conversationId);
      if (!stored && key !== legacy) {
        stored = parseDraft(await storage.get(legacy));
        if (stored && !isEmptyDraft(stored)) {
          this.write(storage, key, stored);
          swallow(() => storage.remove(legacy));
        }
      }
      if (stored && !isEmptyDraft(stored) && !this.memory.has(conversationId)) {
        this.memory.set(conversationId, stored);
      }
      return this.memory.get(conversationId) ?? null;
    } catch {
      return null;
    }
  }

  /** Keep (or, when empty, clear) a draft. Storage failures are ignored. */
  save(conversationId: string, draft: ConversationDraft, storage?: DraftStorage): void {
    if (isEmptyDraft(draft)) {
      this.clear(conversationId, storage);
      return;
    }
    this.memory.set(conversationId, draft);
    if (storage && !this.namespace) {
      this.write(storage, draftKey(conversationId), draft);
    } else if (storage) {
      void this.key(conversationId).then(
        (key) => this.write(storage, key, draft),
        () => undefined,
      );
    }
  }

  /**
   * A send from `conversationId` settled while another conversation was
   * on screen: `sent` drops the quote that went out; otherwise `body`
   * goes back into that conversation's draft (unless it has text again).
   */
  settleSend(
    conversationId: string,
    outcome: { sent: true } | { sent: false; body: string },
    storage?: DraftStorage,
  ): void {
    const d = this.peek(conversationId);
    if (outcome.sent) {
      if (d?.quote) this.save(conversationId, { text: d.text, quote: null }, storage);
      return;
    }
    if (d && d.text.trim().length > 0) return;
    this.save(conversationId, { text: outcome.body, quote: d?.quote ?? null }, storage);
  }

  clear(conversationId: string, storage?: DraftStorage): void {
    this.memory.delete(conversationId);
    if (storage && !this.namespace) {
      swallow(() => storage.remove(draftKey(conversationId)));
    } else if (storage) {
      void this.key(conversationId).then(
        (key) => swallow(() => storage.remove(key)),
        () => undefined,
      );
    }
  }

  /** Called by `chat.destroy()`. @internal */
  async destroy(opts: { clearStorage: boolean }): Promise<void> {
    this.memory.clear();
    if (!opts.clearStorage) return;
    const ns = this.namespace ? await this.namespace() : null;
    for (const [storage, keys] of this.written) {
      const all = new Set(keys);
      if (ns) {
        try {
          const listed: unknown = JSON.parse((await storage.get(indexKey(ns))) ?? '[]');
          if (Array.isArray(listed)) for (const k of listed) if (typeof k === 'string') all.add(k);
        } catch {
          // ignore
        }
        swallow(() => storage.remove(indexKey(ns)));
      }
      for (const k of all) swallow(() => storage.remove(k));
    }
    this.written.clear();
  }

  private async key(conversationId: string): Promise<string> {
    if (!this.namespace) return draftKey(conversationId);
    return `${await this.namespace()}:draft:${conversationId}`;
  }

  private write(storage: DraftStorage, key: string, draft: ConversationDraft): void {
    swallow(() => storage.set(key, JSON.stringify(draft)));
    let keys = this.written.get(storage);
    if (!keys) {
      keys = new Set();
      this.written.set(storage, keys);
    }
    if (keys.has(key) || !this.namespace) return;
    keys.add(key);
    // An index of keys written, so a sign-out finds older sessions' drafts.
    const all = keys;
    void this.namespace().then(async (ns) => {
      try {
        const listed: unknown = JSON.parse((await storage.get(indexKey(ns))) ?? '[]');
        const prev = Array.isArray(listed)
          ? listed.filter((k): k is string => typeof k === 'string')
          : [];
        await storage.set(indexKey(ns), JSON.stringify([...new Set([...prev, ...all])]));
      } catch {
        // Storage is best-effort.
      }
    });
  }
}

const indexKey = (ns: string) => `${ns}:draft-index`;

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

/** The drafts of one client — what ConversationView uses. */
export function draftStoreOf(chat: Poolse): DraftStore {
  return chat.scoped('react-native:drafts', (c) => new DraftStore(() => c.whenNamespace()));
}
