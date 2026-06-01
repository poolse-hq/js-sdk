// Smart Enter handling in the composer — given a value + caret
// position, returns the continuation/end transformation OR null
// when Enter should fall through to submit.

import { describe, expect, it } from 'vitest';
import { handleListEnter } from '../src/listAutocomplete.js';

describe('handleListEnter', () => {
  it('returns null when not on a list line', () => {
    expect(handleListEnter('hello', 5)).toBeNull();
    expect(handleListEnter('multi\nline\ntext', 16)).toBeNull();
  });

  it('continues an unordered list with the same marker', () => {
    const result = handleListEnter('- item one', 10);
    expect(result?.kind).toBe('continue');
    expect(result?.value).toBe('- item one\n- ');
    expect(result?.caret).toBe(13);
  });

  it('continues a numbered list with the next number', () => {
    const result = handleListEnter('1. first', 8);
    expect(result?.kind).toBe('continue');
    expect(result?.value).toBe('1. first\n2. ');
    expect(result?.caret).toBe(12);
  });

  it('increments multi-digit numbers correctly', () => {
    const result = handleListEnter('42. forty-second', 16);
    expect(result?.kind).toBe('continue');
    expect(result?.value).toBe('42. forty-second\n43. ');
  });

  it('ends an unordered list when the marker has no content', () => {
    const result = handleListEnter('- item one\n- ', 13);
    expect(result?.kind).toBe('end');
    // Marker line is stripped.
    expect(result?.value).toBe('- item one\n');
    expect(result?.caret).toBe(11);
  });

  it('ends a numbered list when the marker has no content', () => {
    const result = handleListEnter('1. first\n2. ', 12);
    expect(result?.kind).toBe('end');
    expect(result?.value).toBe('1. first\n');
  });

  it('preserves leading indentation on continuation', () => {
    const result = handleListEnter('  - nested', 10);
    expect(result?.kind).toBe('continue');
    expect(result?.value).toBe('  - nested\n  - ');
  });

  it('supports all unordered markers: - * +', () => {
    expect(handleListEnter('* star', 6)?.value).toBe('* star\n* ');
    expect(handleListEnter('+ plus', 6)?.value).toBe('+ plus\n+ ');
    expect(handleListEnter('- dash', 6)?.value).toBe('- dash\n- ');
  });

  it('returns null on caret outside any list (mid-paragraph)', () => {
    expect(handleListEnter('Just a regular sentence.', 5)).toBeNull();
  });
});
