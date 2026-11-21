// A client's warm cache: the conversation list and the newest messages
// of recently opened conversations. Always kept in memory, so switching
// back to a conversation (or a workspace) shows it at once while a
// quiet refetch catches up; also written to `config.storage` when one
// is given, so history stays readable offline and after a restart.
//
// Rows the outbox owns (`local_status` set) are never cached here —
// the outbox persists those itself.

import type { ScopedStorage } from './storage.js';
import type { Conversation, Message, Uuid } from './types.js';

export interface LocalCacheOptions {
  /** Newest messages kept per conversation. Default 50. */
  messagesPerConversation?: number;
  /** Conversations whose messages are kept (least recently used dropped). Default 50. */
  conversations?: number;
  /** Conversation-list rows kept. Default 200. */
  listRows?: number;
}

const WRITE_DELAY_MS = 300;

export class LocalCache {
  private readonly messages = new Map<Uuid, Message[]>();
  private list: Conversation[] | null = null;
  private readonly pendingWrites = new Map<string, unknown>();
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private readonly perConversation: number;
  private readonly maxConversations: number;
  private readonly listRows: number;
  private destroyed = false;

  constructor(
    /** Resolves to this client's storage slice once its namespace is known; null without storage. */
    private readonly scope: () => Promise<ScopedStorage | null>,
    opts: LocalCacheOptions = {},
  ) {
    this.perConversation = opts.messagesPerConversation ?? 50;
    this.maxConversations = opts.conversations ?? 50;
    this.listRows = opts.listRows ?? 200;
  }

  /** The cached messages of a conversation, oldest first, from memory only. */
  peekMessages(conversationId: Uuid): Message[] | undefined {
    return this.messages.get(conversationId);
  }

  /** The cached messages: from memory, else from storage. Null when none. */
  async loadMessages(conversationId: Uuid): Promise<Message[] | null> {
    const held = this.messages.get(conversationId);
    if (held) return held;
    const scope = await this.scope();
    if (!scope || this.destroyed) return null;
    const stored = await scope.getJson<Message[]>(messagesKey(conversationId));
    if (!Array.isArray(stored) || stored.length === 0) return null;
    // Something newer may have landed in memory meanwhile.
    if (!this.messages.has(conversationId)) this.remember(conversationId, stored);
    return this.messages.get(conversationId) ?? null;
  }

  /** Keep the newest messages of a conversation (oldest first, as shown). */
  setMessages(conversationId: Uuid, messages: ReadonlyArray<Message>): void {
    if (this.destroyed) return;
    const kept = messages.filter((m) => !m.local_status).slice(-this.perConversation);
    this.remember(conversationId, kept);
    this.queueWrite(messagesKey(conversationId), kept);
  }

  /** The cached conversation list, from memory only. */
  peekConversations(): Conversation[] | null {
    return this.list;
  }

  /** The cached conversation list: from memory, else from storage. */
  async loadConversations(): Promise<Conversation[] | null> {
    if (this.list) return this.list;
    const scope = await this.scope();
    if (!scope || this.destroyed) return null;
    const stored = await scope.getJson<Conversation[]>(LIST_KEY);
    if (!Array.isArray(stored)) return null;
    this.list ??= stored;
    return this.list;
  }

  setConversations(conversations: ReadonlyArray<Conversation>): void {
    if (this.destroyed) return;
    this.list = conversations.slice(0, this.listRows);
    this.queueWrite(LIST_KEY, this.list);
  }

  /** Forget a conversation's messages (left, or removed from it). */
  forget(conversationId: Uuid): void {
    this.messages.delete(conversationId);
    this.queueWrite(messagesKey(conversationId), null);
  }

  /** Write pending changes now. */
  flush(): Promise<void> {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = null;
    // A flush still waiting for the namespace takes the newer writes too.
    if (this.flushing) return this.flushing;
    if (this.pendingWrites.size === 0) return Promise.resolve();
    const run = (async () => {
      const scope = await this.scope();
      const writes = [...this.pendingWrites];
      this.pendingWrites.clear();
      if (!scope || this.destroyed) return;
      for (const [key, value] of writes) {
        if (value === null) await scope.remove(key);
        else await scope.setJson(key, value);
      }
    })().finally(() => {
      this.flushing = null;
      if (this.pendingWrites.size > 0 && !this.destroyed) this.queueWrite();
    });
    this.flushing = run;
    return run;
  }

  /** Drop everything, in memory and in storage. */
  async clear(): Promise<void> {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = null;
    this.pendingWrites.clear();
    this.messages.clear();
    this.list = null;
  }

  /** @internal */
  _destroy(): void {
    this.destroyed = true;
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = null;
    this.pendingWrites.clear();
    this.messages.clear();
    this.list = null;
  }

  private remember(conversationId: Uuid, messages: Message[]): void {
    // Map order is insertion order: re-insert to mark most recently used.
    this.messages.delete(conversationId);
    this.messages.set(conversationId, messages);
    while (this.messages.size > this.maxConversations) {
      const oldest = this.messages.keys().next().value;
      if (oldest === undefined) break;
      this.messages.delete(oldest);
    }
  }

  private queueWrite(key?: string, value?: unknown): void {
    if (key !== undefined) this.pendingWrites.set(key, value);
    if (this.writeTimer || this.flushing) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      void this.flush();
    }, WRITE_DELAY_MS);
  }
}

const LIST_KEY = 'conversations';
const messagesKey = (id: Uuid) => `messages:${id}`;
