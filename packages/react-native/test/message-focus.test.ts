import { describe, expect, it } from 'vitest';
import { indexOfMessage, latestMarkableId } from '../src/internal/messageFocus.js';

describe('latestMarkableId', () => {
  it('is the tail message', () => {
    expect(
      latestMarkableId([
        { id: 'm1', sequence: 1 },
        { id: 'm2', sequence: 2 },
      ]),
    ).toBe('m2');
  });

  it('skips an optimistic send without a server sequence', () => {
    expect(latestMarkableId([{ id: 'tmp', sequence: Number.MAX_SAFE_INTEGER }])).toBeNull();
    expect(latestMarkableId([{ id: 'tmp', sequence: 0 }])).toBeNull();
  });

  it('is null for an empty list', () => {
    expect(latestMarkableId([])).toBeNull();
  });
});

describe('indexOfMessage', () => {
  const items = [
    { kind: 'msg', msg: { id: 'm3' } },
    { kind: 'separator', id: 'sep-m2' },
    { kind: 'msg', msg: { id: 'm2' } },
  ];

  it('finds a message row, skipping separators', () => {
    expect(indexOfMessage(items, 'm2')).toBe(2);
  });

  it('is -1 when the message is not in the list', () => {
    expect(indexOfMessage(items, 'nope')).toBe(-1);
    expect(indexOfMessage(items, 'sep-m2')).toBe(-1);
  });
});
