// Unsent text + quote target per conversation — pure, so vitest can
// run it under node.

import type { Message } from '@poolse/sdk';

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
 * Drafts in memory, shared by every ConversationView in the app — so a
 * draft survives switching conversations (the view remounts) — and
 * written through to a `DraftStorage` when given one.
 */
export class DraftStore {
  private readonly memory = new Map<string, ConversationDraft>();

  /** The in-memory draft, if any. */
  peek(conversationId: string): ConversationDraft | null {
    return this.memory.get(conversationId) ?? null;
  }

  /**
   * The draft: from memory, else from `storage` (which then seeds the
   * memory). Null when there's none, or storage fails.
   */
  async load(conversationId: string, storage?: DraftStorage): Promise<ConversationDraft | null> {
    const inMemory = this.memory.get(conversationId);
    if (inMemory) return inMemory;
    if (!storage) return null;
    try {
      const stored = parseDraft(await storage.get(draftKey(conversationId)));
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
    if (storage) {
      swallow(() => storage.set(draftKey(conversationId), JSON.stringify(draft)));
    }
  }

  clear(conversationId: string, storage?: DraftStorage): void {
    this.memory.delete(conversationId);
    if (storage) swallow(() => storage.remove(draftKey(conversationId)));
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

/** The store ConversationView uses. */
export const sharedDraftStore = new DraftStore();
