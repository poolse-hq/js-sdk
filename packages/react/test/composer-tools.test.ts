import { describe, expect, it } from 'vitest';
import {
  applyFormat,
  applySlashCommand,
  filterSlashCommands,
  formatForShortcut,
  mentionGroupMeta,
  rankMentionGroups,
  nextPlaybackRate,
  parseSlashCommand,
  slashQuery,
  waveformBars,
} from '../src/composer-tools.js';
import {
  customEmojiToken,
  findCustomEmoji,
  parseCustomEmojiToken,
  searchCustomEmoji,
} from '../src/custom-emoji.js';

const sel = (start: number, end = start) => ({ start, end });

describe('applyFormat', () => {
  it('wraps and unwraps inline formats', () => {
    const r = applyFormat('say hi now', sel(4, 6), 'bold');
    expect(r).toEqual({ value: 'say **hi** now', selection: sel(6, 8) });
    expect(applyFormat(r.value, r.selection, 'bold')).toEqual({
      value: 'say hi now',
      selection: sel(4, 6),
    });
    expect(applyFormat('a **b** c', sel(2, 7), 'bold').value).toBe('a b c');
  });

  it('inserts an empty pair at a caret', () => {
    expect(applyFormat('ab', sel(1), 'code')).toEqual({ value: 'a``b', selection: sel(2) });
    expect(applyFormat('', sel(0), 'strike').value).toBe('~~~~');
  });

  it('makes a link and selects the url', () => {
    const r = applyFormat('see docs', sel(4, 8), 'link');
    expect(r.value).toBe('see [docs](https://)');
    expect(r.value.slice(r.selection.start, r.selection.end)).toBe('https://');
  });

  it('prefixes and unprefixes every selected line', () => {
    const r = applyFormat('one\ntwo\nthree', sel(1, 6), 'bulletList');
    expect(r.value).toBe('- one\n- two\nthree');
    expect(applyFormat(r.value, r.selection, 'bulletList').value).toBe('one\ntwo\nthree');
    expect(applyFormat('a\nb', sel(0, 3), 'numberedList').value).toBe('1. a\n2. b');
    expect(applyFormat('1. a\n2. b', sel(0, 9), 'numberedList').value).toBe('a\nb');
    expect(applyFormat('- a', sel(3), 'numberedList').value).toBe('1. a');
    expect(applyFormat('x', sel(1), 'quote')).toEqual({ value: '> x', selection: sel(3) });
    expect(applyFormat('task', sel(0), 'checklist').value).toBe('- [ ] task');
  });

  it('fences a code block on its own lines', () => {
    const r = applyFormat('hi x = 1', sel(3, 8), 'codeBlock');
    expect(r.value).toBe('hi \n```\nx = 1\n```');
    expect(r.value.slice(r.selection.start, r.selection.end)).toBe('x = 1');
  });

  it('inserts a table with the caret in the first body cell', () => {
    const r = applyFormat('', sel(0), 'table');
    expect(r.value).toBe('| Column | Column |\n| --- | --- |\n|  |  |\n');
    expect(r.value.slice(0, r.selection.start).endsWith('\n| ')).toBe(true);
  });

  it('clamps an out-of-range selection', () => {
    expect(applyFormat('ab', sel(9, 1), 'italic').value).toBe('a_b_');
  });
});

describe('formatForShortcut', () => {
  it('maps Mod shortcuts', () => {
    expect(formatForShortcut({ key: 'b', metaKey: true })).toBe('bold');
    expect(formatForShortcut({ key: 'X', ctrlKey: true, shiftKey: true })).toBe('strike');
    expect(formatForShortcut({ key: 'b' })).toBeNull();
    expect(formatForShortcut({ key: 'b', metaKey: true, altKey: true })).toBeNull();
  });
});

describe('slash commands', () => {
  const cmds = [
    { name: 'jira', description: 'Create an issue' },
    { name: 'giphy', description: 'Post a gif' },
    { name: 'poll', description: 'Start a poll' },
    { name: 'remind', description: 'Remind me about this issue later' },
  ];
  it('detects the query only at the start, before a space', () => {
    expect(slashQuery('/ji', 3)).toEqual({ query: 'ji' });
    expect(slashQuery('/', 1)).toEqual({ query: '' });
    expect(slashQuery('/jira ABC', 9)).toBeNull();
    expect(slashQuery('see /jira', 9)).toBeNull();
    expect(slashQuery('/a/b', 0)).toBeNull();
  });
  it('ranks prefix matches before contains', () => {
    expect(filterSlashCommands(cmds, 'i').map((c) => c.name)).toEqual(['jira', 'giphy', 'remind']);
    expect(filterSlashCommands(cmds, 'issue').map((c) => c.name)).toEqual(['jira', 'remind']);
    expect(filterSlashCommands(cmds, '').length).toBe(4);
  });
  it('applies and parses', () => {
    expect(applySlashCommand('/ji', 'jira')).toEqual({ value: '/jira ', selection: sel(6) });
    expect(applySlashCommand('/ji ABC-1', 'jira').value).toBe('/jira ABC-1');
    expect(parseSlashCommand('/Jira  ABC-1 ')).toEqual({ name: 'jira', args: 'ABC-1' });
    expect(parseSlashCommand('hello')).toBeNull();
  });
});

describe('playback', () => {
  it('cycles 1× → 1.5× → 2× → 1×', () => {
    expect(nextPlaybackRate(1)).toBe(1.5);
    expect(nextPlaybackRate(1.5)).toBe(2);
    expect(nextPlaybackRate(2)).toBe(1);
    expect(nextPlaybackRate(3)).toBe(1);
  });
  it('downsamples waveforms', () => {
    expect(waveformBars([0.1, 0.9, 0.2, 0.4], 2)).toEqual([0.9, 0.4]);
    expect(waveformBars([], 3)).toEqual([0.08, 0.08, 0.08]);
  });
});

describe('group mentions', () => {
  const groups = [
    { handle: 'design', name: 'Design team', memberCount: 12 },
    { handle: 'oncall', name: 'On call', description: 'On call: Ana' },
    { handle: 'sales-eu', name: 'Sales Europe', memberCount: 1 },
  ];
  it('ranks handle prefix, then name word, then anywhere', () => {
    expect(rankMentionGroups(groups, 'on').map((g) => g.handle)).toEqual(['oncall']);
    expect(rankMentionGroups(groups, 'eu').map((g) => g.handle)).toEqual(['sales-eu']);
    expect(rankMentionGroups(groups, 'team').map((g) => g.handle)).toEqual(['design']);
    expect(rankMentionGroups(groups, '').length).toBe(3);
  });
  it('describes a group', () => {
    expect(groups.map(mentionGroupMeta)).toEqual(['12 people', 'On call: Ana', '1 person']);
    expect(mentionGroupMeta({ handle: 'x', name: 'X' })).toBeNull();
  });
});

describe('custom emoji', () => {
  const set = [
    { name: 'party-parrot', url: 'https://w/e/1' },
    { name: 'shipit', url: 'https://w/e/2' },
    { name: 'parrot', url: 'https://w/e/3' },
  ];
  it('makes and reads tokens', () => {
    expect(customEmojiToken('shipit')).toBe(':shipit:');
    expect(parseCustomEmojiToken(':shipit:')).toBe('shipit');
    expect(parseCustomEmojiToken('👍')).toBeNull();
    expect(parseCustomEmojiToken(':Bad Name:')).toBeNull();
    expect(findCustomEmoji(':parrot:', set)?.url).toBe('https://w/e/3');
    expect(findCustomEmoji(':nope:', set)).toBeNull();
  });
  it('searches, prefix first', () => {
    expect(searchCustomEmoji(set, 'parrot').map((e) => e.name)).toEqual(['parrot', 'party-parrot']);
    expect(searchCustomEmoji(set, ':ship').map((e) => e.name)).toEqual(['shipit']);
    expect(searchCustomEmoji(set, '')).toHaveLength(3);
  });
});
