import type { Conversation, Message } from '@poolse/sdk';
import { describe, expect, it, vi } from 'vitest';

import { buildConversationSections } from '../src/internal/conversationSections.js';
import { DraftStore, draftKey, parseDraft, type DraftStorage } from '../src/internal/drafts.js';
import { emojiCategories, pushRecent, searchEmoji } from '../src/internal/emoji.js';
import {
  activeMentionQuery,
  filterMentionCandidates,
  insertMention,
  mentionedUserIds,
} from '../src/internal/mentions.js';
import { presenceBadgeKind, presenceText } from '../src/internal/presence.js';
import { stackedParticipants, threadSummaryText } from '../src/internal/thread.js';
import { relativeTime } from '../src/internal/time.js';
import {
  firstUnreadSequence,
  needsOlderForUnread,
  newMessagesDividerId,
} from '../src/internal/unread.js';
import { formatBytes, pickedFileRejection, uploadRejection } from '../src/internal/uploadRules.js';

const NOW = new Date(2026, 10, 21, 15, 0, 0); // Sat 21 Nov 2026, 15:00 local
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it('long style', () => {
    expect(relativeTime(ago(10_000), NOW)).toBe('just now');
    expect(relativeTime(ago(5 * MIN), NOW)).toBe('5m ago');
    expect(relativeTime(ago(3 * HOUR), NOW)).toBe('3h ago');
    expect(relativeTime(new Date(2026, 10, 20, 9, 0).toISOString(), NOW)).toBe('yesterday');
    expect(relativeTime(new Date(2026, 10, 17, 9, 0).toISOString(), NOW)).toBe('Tue');
    expect(relativeTime(new Date(2026, 2, 4, 9, 0).toISOString(), NOW)).toBe('Mar 4');
    expect(relativeTime(new Date(2025, 2, 4, 9, 0).toISOString(), NOW)).toBe('Mar 4, 2025');
  });
  it('short style', () => {
    expect(relativeTime(ago(10_000), NOW, 'short')).toBe('now');
    expect(relativeTime(ago(5 * MIN), NOW, 'short')).toBe('5m');
    expect(relativeTime(ago(2 * DAY), NOW, 'short')).toBe('2d');
    expect(relativeTime(ago(14 * DAY), NOW, 'short')).toBe('2w');
  });
  it('handles missing, bad and future times', () => {
    expect(relativeTime(null, NOW)).toBe('');
    expect(relativeTime('nope', NOW)).toBe('');
    expect(relativeTime(new Date(NOW.getTime() + HOUR).toISOString(), NOW)).toBe('just now');
  });
});

describe('presence', () => {
  it('badge kinds', () => {
    expect(presenceBadgeKind('online')).toBe('online');
    expect(presenceBadgeKind('away')).toBe('away');
    expect(presenceBadgeKind('in_call', true)).toBe('in_call');
    expect(presenceBadgeKind('online', true)).toBe('dnd');
    expect(presenceBadgeKind('offline', true)).toBeNull();
    expect(presenceBadgeKind(null)).toBeNull();
  });
  it('header text', () => {
    expect(presenceText({ state: 'online', last_seen_at: null }, NOW)).toBe('Online');
    expect(presenceText({ state: 'away', last_seen_at: null, do_not_disturb: true }, NOW)).toBe(
      'Away · Do not disturb',
    );
    expect(presenceText({ state: 'in_call', last_seen_at: null }, NOW)).toBe('In a call');
    expect(presenceText({ state: 'offline', last_seen_at: ago(5 * MIN) }, NOW)).toBe(
      'Last seen 5m ago',
    );
    expect(presenceText({ state: 'offline', last_seen_at: null }, NOW)).toBeNull();
    expect(presenceText(null, NOW)).toBeNull();
  });
});

const conv = (id: string, type: 'direct' | 'group') => ({ id, type }) as Conversation;

describe('buildConversationSections', () => {
  const list = [conv('a', 'direct'), conv('b', 'group'), conv('c', 'direct'), conv('d', 'group')];
  it('groups by type, channels first, order kept', () => {
    expect(buildConversationSections(list, undefined, 'type')).toEqual([
      { title: 'Channels', data: [list[1], list[3]] },
      { title: 'Direct messages', data: [list[0], list[2]] },
    ]);
  });
  it('custom sections: first match wins, empty sections dropped, unmatched dropped', () => {
    const out = buildConversationSections(list, [
      { title: 'Pinned', filter: (c) => c.id === 'c' },
      { title: 'Groups', filter: (c) => c.type === 'group' },
      { title: 'Empty', filter: () => false },
      { title: 'All', filter: () => true },
    ]);
    expect(out?.map((s) => [s.title, s.data.map((c) => c.id)])).toEqual([
      ['Pinned', ['c']],
      ['Groups', ['b', 'd']],
      ['All', ['a']],
    ]);
  });
  it('null without sections', () => {
    expect(buildConversationSections(list, undefined)).toBeNull();
  });
});

describe('new messages divider', () => {
  const msgs = [
    { id: 'm1', sequence: 1, sender_id: 'u2' },
    { id: 'm2', sequence: 2, sender_id: 'me' },
    { id: 'm3', sequence: 3, sender_id: 'u2' },
    { id: 'tmp', sequence: Number.MAX_SAFE_INTEGER, sender_id: 'u2' },
  ];
  it('first unread sequence from counts', () => {
    expect(firstUnreadSequence({ last_sequence: 10, unread_count: 3 })).toBe(8);
    expect(firstUnreadSequence({ last_sequence: 10, unread_count: 0 })).toBeNull();
    expect(firstUnreadSequence({ last_sequence: 2, unread_count: 9 })).toBe(1);
    expect(firstUnreadSequence({ last_sequence: 10 })).toBeNull();
    expect(firstUnreadSequence(null)).toBeNull();
  });
  it('sits above the first unread message from someone else', () => {
    expect(newMessagesDividerId(msgs, 2, 'me')).toBe('m3');
    expect(newMessagesDividerId(msgs, 1, 'me')).toBe('m1');
    expect(newMessagesDividerId(msgs, 4, 'me')).toBeNull();
    expect(newMessagesDividerId(msgs, null, 'me')).toBeNull();
  });
  it('knows when older pages are needed', () => {
    expect(needsOlderForUnread(msgs, 1)).toBe(false);
    expect(needsOlderForUnread(msgs.slice(2), 2)).toBe(true);
    expect(needsOlderForUnread(msgs, null)).toBe(false);
  });
});

describe('DraftStore', () => {
  const quote = { id: 'q1', body: 'hi' } as Message;
  it('keeps drafts in memory and clears empty ones', async () => {
    const store = new DraftStore();
    store.save('c1', { text: 'hello', quote: null });
    expect(store.peek('c1')).toEqual({ text: 'hello', quote: null });
    store.save('c1', { text: '  ', quote: null });
    expect(store.peek('c1')).toBeNull();
    expect(await store.load('c1')).toBeNull();
  });
  it('writes through to storage and reads it back', async () => {
    const data = new Map<string, string>();
    const storage: DraftStorage = {
      get: async (k) => data.get(k) ?? null,
      set: async (k, v) => void data.set(k, v),
      remove: (k) => void data.delete(k),
    };
    new DraftStore().save('c1', { text: 'x', quote }, storage);
    expect(parseDraft(data.get(draftKey('c1')))).toEqual({ text: 'x', quote });
    const fresh = new DraftStore();
    expect(await fresh.load('c1', storage)).toEqual({ text: 'x', quote });
    expect(fresh.peek('c1')).toEqual({ text: 'x', quote });
    fresh.clear('c1', storage);
    expect(data.has(draftKey('c1'))).toBe(false);
  });
  it('survives storage failures and junk', async () => {
    const storage: DraftStorage = {
      get: () => {
        throw new Error('boom');
      },
      set: vi.fn(async () => {
        throw new Error('boom');
      }),
      remove: () => undefined,
    };
    const store = new DraftStore();
    expect(await store.load('c1', storage)).toBeNull();
    expect(() => store.save('c1', { text: 'a', quote: null }, storage)).not.toThrow();
    expect(parseDraft('{oops')).toBeNull();
    expect(parseDraft('{"text":1}')).toBeNull();
  });
  it('settles a send from a conversation no longer on screen', () => {
    const store = new DraftStore();
    // Sent: the quote went out with it; text typed meanwhile stays.
    store.save('a', { text: '', quote });
    store.settleSend('a', { sent: true });
    expect(store.peek('a')).toBeNull();
    store.save('a', { text: 'later', quote });
    store.settleSend('a', { sent: true });
    expect(store.peek('a')).toEqual({ text: 'later', quote: null });
    // Failed: the words go back, with the quote; new text wins.
    store.save('b', { text: '', quote });
    store.settleSend('b', { sent: false, body: 'lost words' });
    expect(store.peek('b')).toEqual({ text: 'lost words', quote });
    store.settleSend('b', { sent: false, body: 'older' });
    expect(store.peek('b')?.text).toBe('lost words');
  });
});

describe('emoji', () => {
  it('parses categories', () => {
    const cats = emojiCategories();
    expect(cats.length).toBeGreaterThan(5);
    expect(cats.every((c) => c.emojis.length > 20)).toBe(true);
    expect(cats.every((c) => c.emojis.every((e) => e.emoji && e.keywords.length > 0))).toBe(true);
  });
  it('searches by keyword prefix, names first', () => {
    const thumbs = searchEmoji('thumbs');
    expect(thumbs.map((e) => e.emoji)).toEqual(['👍', '👎']);
    expect(searchEmoji('red heart')[0]?.emoji).toBe('❤️');
    expect(searchEmoji('fire').map((e) => e.emoji)).toContain('🔥');
    expect(searchEmoji('🔥')[0]?.emoji).toBe('🔥');
    expect(searchEmoji('  ')).toEqual([]);
    expect(searchEmoji('zzzqqq')).toEqual([]);
  });
  it('recent list', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(pushRecent(['a', 'b'], 'c', 2)).toEqual(['c', 'a']);
  });
});

describe('mentions', () => {
  it('finds the query at the cursor', () => {
    expect(activeMentionQuery('hi @al', 6)).toEqual({ start: 3, query: 'al' });
    expect(activeMentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(activeMentionQuery('mail a@b', 8)).toBeNull();
    expect(activeMentionQuery('hi @al there', 12)).toBeNull();
    expect(activeMentionQuery('(@bo', 4)).toEqual({ start: 1, query: 'bo' });
  });
  it('inserts the mention', () => {
    expect(insertMention('hi @al', 3, 6, 'Alice')).toEqual({ text: 'hi @Alice ', cursor: 10 });
    expect(insertMention('hi @al and', 3, 6, 'Alice')).toEqual({
      text: 'hi @Alice and',
      cursor: 10,
    });
  });
  it('keeps only mentions still in the text', () => {
    const picked = [
      { userId: 'u1', label: 'Alice' },
      { userId: 'u2', label: 'Bob' },
      { userId: 'u1', label: 'Alice' },
    ];
    expect(mentionedUserIds('hey @Alice', picked)).toEqual(['u1']);
    expect(mentionedUserIds('@Bob @Alice', picked)).toEqual(['u1', 'u2']);
  });
  it('ranks candidates', () => {
    const c = [
      { label: 'Mary Ann', externalId: 'm' },
      { label: 'Ann Lee', externalId: 'a' },
      { label: 'Joanna', externalId: 'j' },
      { label: 'Zed', externalId: 'z' },
    ];
    expect(filterMentionCandidates(c, 'ann').map((x) => x.externalId)).toEqual(['a', 'm', 'j']);
    expect(filterMentionCandidates(c, '', 2)).toHaveLength(2);
  });
});

describe('thread summary', () => {
  it('text', () => {
    expect(threadSummaryText(0, null, NOW)).toBe('');
    expect(threadSummaryText(1, null, NOW)).toBe('1 reply');
    expect(threadSummaryText(3, ago(5 * MIN), NOW)).toBe('3 replies · last reply 5m ago');
  });
  it('stacked avatars', () => {
    expect(
      stackedParticipants([
        { user_id: '1', external_id: 'a' },
        { user_id: '1', external_id: 'a' },
        { user_id: '2', external_id: null },
        { user_id: '3', external_id: 'c' },
        { user_id: '4', external_id: 'd' },
      ]),
    ).toEqual([
      { key: 'a', externalId: 'a' },
      { key: '2', externalId: null },
      { key: 'c', externalId: 'c' },
    ]);
    expect(stackedParticipants(undefined)).toEqual([]);
  });
});

describe('upload rules', () => {
  it('checks a converted photo by what was picked, and by the size uploaded', () => {
    const webp = {
      contentType: 'image/webp',
      byteSize: 200_000,
      filename: 'IMG_1.webp',
      source: { contentType: 'image/jpeg', filename: 'IMG_1.jpg' },
    };
    expect(pickedFileRejection(webp, { acceptedTypes: ['image/jpeg', 'image/png'] })).toBeNull();
    expect(pickedFileRejection(webp, { acceptedTypes: ['.jpg'] })).toBeNull();
    expect(pickedFileRejection(webp, { acceptedTypes: ['image/webp'] })).toBeNull();
    expect(pickedFileRejection(webp, { acceptedTypes: ['application/pdf'] })).toMatch(/type/);
    expect(pickedFileRejection(webp, { maxFileSize: 100_000 })).toMatch(/too large/);
    const { source: _source, ...plain } = webp;
    expect(pickedFileRejection(plain, { acceptedTypes: ['image/jpeg'] })).toMatch(/type/);
  });
  it('rejects by type and size', () => {
    const file = { contentType: 'image/png', byteSize: 3 * 1024 * 1024, filename: 'a.png' };
    expect(uploadRejection(file, {})).toBeNull();
    expect(uploadRejection(file, { acceptedTypes: ['image/*'] })).toBeNull();
    expect(uploadRejection(file, { acceptedTypes: ['.png'] })).toBeNull();
    expect(uploadRejection(file, { acceptedTypes: ['application/pdf'] })).toMatch(/file type/);
    expect(uploadRejection(file, { maxFileSize: 1024 * 1024 })).toBe(
      'a.png is too large (3 MB; the limit is 1 MB).',
    );
  });
  it('formats bytes', () => {
    expect(formatBytes(820)).toBe('820 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(12 * 1024 * 1024)).toBe('12 MB');
  });
});
