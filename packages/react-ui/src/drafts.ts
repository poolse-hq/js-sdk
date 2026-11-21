// Unsent drafts, one per user and conversation: the composer's text and
// the message being quoted (files aren't kept). Held in memory for the
// page — so switching conversations and back finds them — and written
// to a storage (localStorage by default) so a reload does too.

import type { Message } from '@poolse/sdk';

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

const memory = new Map<string, ConversationDraft>();

export function draftKey(userId: string, conversationId: string): string {
  return `poolse:draft:${userId}:${conversationId}`;
}

const isEmpty = (d: ConversationDraft) => d.text.trim() === '' && !d.replyTo;

/** The draft for `key`: from memory, else from `storage`. */
export function readDraft(
  storage: DraftStorage,
  key: string,
): ConversationDraft | null | Promise<ConversationDraft | null> {
  const held = memory.get(key);
  if (held) return held;
  let raw: ReturnType<DraftStorage['get']>;
  try {
    raw = storage.get(key);
  } catch {
    return null;
  }
  const hold = (d: ConversationDraft | null) => {
    if (d && !memory.has(key)) memory.set(key, d);
    return memory.get(key) ?? d;
  };
  if (raw instanceof Promise)
    return raw.then(
      (r) => hold(parse(r)),
      () => null,
    );
  return hold(parse(raw));
}

/** Save (or, when empty, drop) the draft for `key`. */
export function writeDraft(storage: DraftStorage, key: string, draft: ConversationDraft): void {
  if (isEmpty(draft)) {
    clearDraft(storage, key);
    return;
  }
  memory.set(key, draft);
  const value = JSON.stringify({ v: 1, text: draft.text, replyTo: draft.replyTo });
  try {
    void Promise.resolve(storage.set(key, value)).catch(() => undefined);
  } catch {
    // ignore
  }
}

export function clearDraft(storage: DraftStorage, key: string): void {
  memory.delete(key);
  try {
    void Promise.resolve(storage.remove(key)).catch(() => undefined);
  } catch {
    // ignore
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
