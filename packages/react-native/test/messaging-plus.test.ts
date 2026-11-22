import { describe, expect, it } from 'vitest';
import { formatBytes, noteIdFromLink, stripMarkdown } from '../src/internal/plus.js';

describe('messaging plus helpers', () => {
  it('strips Markdown for plain-text block rendering', () => {
    expect(stripMarkdown('**Deploy 4.2** is `ready`, see [docs](https://x)')).toBe(
      'Deploy 4.2 is ready, see docs',
    );
    expect(stripMarkdown('# Title\n_soft_ ~~old~~')).toBe('Title\nsoft old');
  });
  it('formats sizes and reads note links', () => {
    expect(formatBytes(48_213)).toBe('47 KB');
    expect(formatBytes(3_400_000)).toBe('3.2 MB');
    expect(
      noteIdFromLink('https://a.b/workspace/l/note/0f3c9a1e-aaaa-bbbb-cccc-1234567890ab'),
    ).toBe('0f3c9a1e-aaaa-bbbb-cccc-1234567890ab');
    expect(noteIdFromLink('https://a.b/c')).toBeNull();
  });
});
