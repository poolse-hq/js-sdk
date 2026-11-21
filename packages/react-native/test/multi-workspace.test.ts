import type { Message, Poolse } from '@poolse/sdk';
import { describe, expect, it, vi } from 'vitest';
import { messageA11yLabel, reactionA11yLabel } from '../src/internal/a11y.js';
import { applyBackground } from '../src/internal/background.js';
import { DraftStore, draftKey, type DraftStorage } from '../src/internal/drafts.js';

const fakeClient = () => {
  let bg = false;
  return {
    destroyed: false,
    setBackground: vi.fn((b: boolean) => {
      bg = b;
    }),
    get bg() {
      return bg;
    },
  };
};

describe('applyBackground', () => {
  it('keeps only the workspace on screen connected, none with the app in the background', () => {
    const [a, b, c] = [fakeClient(), fakeClient(), fakeClient()];
    const all = [a, b, c] as unknown as Poolse[];
    applyBackground(all, all[1]!, true);
    expect([a.bg, b.bg, c.bg]).toEqual([true, false, true]);
    applyBackground(all, all[1]!, true, [all[2]!]);
    expect([a.bg, b.bg, c.bg]).toEqual([true, false, false]);
    applyBackground(all, all[1]!, false);
    expect([a.bg, b.bg, c.bg]).toEqual([true, true, true]);
  });
});

describe('DraftStore per client', () => {
  const mem = () => {
    const data = new Map<string, string>();
    const storage: DraftStorage = {
      get: (k) => data.get(k) ?? null,
      set: (k, v) => void data.set(k, v),
      remove: (k) => void data.delete(k),
    };
    return { data, storage };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('namespaces keys, moves a pre-3.8 draft, and clears only its own on sign-out', async () => {
    const { data, storage } = mem();
    data.set(draftKey('c1'), JSON.stringify({ text: 'old', quote: null }));
    const a = new DraftStore(async () => 'poolse:v1:https://a.test#u1');
    const b = new DraftStore(async () => 'poolse:v1:https://b.test#u1');

    expect((await a.load('c1', storage))?.text).toBe('old');
    await flush();
    expect(data.has(draftKey('c1'))).toBe(false);
    expect(data.get('poolse:v1:https://a.test#u1:draft:c1')).toContain('old');

    b.save('c1', { text: 'beta', quote: null }, storage);
    await flush();
    expect(data.get('poolse:v1:https://b.test#u1:draft:c1')).toContain('beta');
    expect(a.peek('c1')?.text).toBe('old');

    await a.destroy({ clearStorage: true });
    await flush();
    expect(data.has('poolse:v1:https://a.test#u1:draft:c1')).toBe(false);
    expect(data.get('poolse:v1:https://b.test#u1:draft:c1')).toContain('beta');
  });
});

describe('screen reader labels', () => {
  const m = (extra: Partial<Message>) => ({ body: 'see you at 3', ...extra }) as Message;
  it('names the sender and the state of the message', () => {
    expect(messageA11yLabel(m({}), 'Ana', false)).toBe('Ana: see you at 3');
    expect(messageA11yLabel(m({}), 'Ana', true)).toBe('You: see you at 3');
    expect(messageA11yLabel(m({ deleted_at: 'x' }), 'Ana', false)).toBe('Ana: message deleted');
    expect(messageA11yLabel(m({ local_status: 'failed' }), 'Ana', true)).toBe(
      'You: see you at 3, not sent',
    );
    expect(messageA11yLabel(m({ body: '', attachments: [{}, {}] as never }), 'Ana', false)).toBe(
      'Ana: 2 attachments',
    );
    expect(reactionA11yLabel('👍', 3, true)).toBe('👍 3, you reacted');
  });
});
