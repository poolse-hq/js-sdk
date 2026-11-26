import { describe, expect, it, vi } from 'vitest';
import { LocalCache } from '../src/local-cache.js';
import { ScopedStorage, memoryStorage, type PoolseStorage } from '../src/storage.js';
import { UsersResource } from '../src/resources/users.js';
import type { Message } from '../src/types.js';

const msg = (id: string, conversationId: string): Message =>
  ({ id, conversation_id: conversationId, body: id, sequence: 1 }) as unknown as Message;

describe('LocalCache', () => {
  it('clear() during a flush leaves nothing of the history in storage', async () => {
    const base = memoryStorage();
    let release: (() => void) | null = null;
    const slow: PoolseStorage = {
      get: base.get,
      remove: base.remove,
      set: async (k, v) => {
        if (k.includes('messages:c-1') && !release) await new Promise<void>((r) => (release = r));
        await base.set(k, v);
      },
    };
    const scope = new ScopedStorage(slow, 'ns');
    const cache = new LocalCache(async () => scope);
    cache.setMessages('c-1', [msg('m-1', 'c-1')]);
    cache.setMessages('c-2', [msg('m-2', 'c-2')]);
    const flushing = cache.flush();
    await vi.waitFor(() => expect(release).not.toBeNull());

    const clearing = cache.clear().then(() => scope.clear());
    release!();
    await Promise.all([flushing, clearing]);
    expect(base.size).toBe(0);
  });

  it('deletes a dropped conversation from storage too, across restarts', async () => {
    const base = memoryStorage();
    const scope = () => Promise.resolve(new ScopedStorage(base, 'ns'));
    const first = new LocalCache(scope, { conversations: 2 });
    first.setMessages('a', [msg('1', 'a')]);
    first.setMessages('b', [msg('2', 'b')]);
    await first.flush();

    const second = new LocalCache(scope, { conversations: 2 });
    second.setMessages('c', [msg('3', 'c')]);
    await second.flush();
    const s = await scope();
    expect(await s.getJson('messages:a')).toBeNull();
    expect(await s.getJson('messages:b')).not.toBeNull();
    expect(await s.getJson('messages:c')).not.toBeNull();
  });
});

describe('UsersResource', () => {
  it('an answer from before invalidate() does not overwrite the newer profile', async () => {
    const answers: Array<(p: { displayName: string }) => void> = [];
    const users = new UsersResource({
      userResolver: () => new Promise((r) => answers.push(r)),
    } as never);
    const old = users.get('ana');
    users.invalidate('ana');
    const fresh = users.get('ana');
    await vi.waitFor(() => expect(answers).toHaveLength(2));
    answers[1]!({ displayName: 'Ana New' });
    await fresh;
    answers[0]!({ displayName: 'Ana Old' });
    await old;
    expect(users.peek('ana')).toEqual({ displayName: 'Ana New' });
  });
});
