import { describe, expect, it } from 'vitest';
import { userColor } from '../src/userColor.js';

const PALETTE = [
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#0ea5e9',
  '#8b5cf6',
  '#14b8a6',
  '#d946ef',
];

describe('userColor', () => {
  it('returns a hex from the 8-color palette', () => {
    expect(PALETTE).toContain(userColor('00000000-0000-0000-0000-000000000001'));
  });

  it('is deterministic — same input → same color across calls', () => {
    const id = '7e1c3d8e-9b2a-4f3e-87cd-2c1b6a4f0e51';
    const first = userColor(id);
    const second = userColor(id);
    const third = userColor(id);
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it('different ids produce a spread across the palette (not all the same)', () => {
    // Generate 100 unique uuid-like strings, hash each, count distinct
    // colors. With 8 buckets we expect roughly uniform distribution;
    // a hash that bucketed everything to one color would fail the
    // ">= 5 hues" sanity check.
    const colors = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const id = `aaaaaaaa-bbbb-cccc-dddd-${String(i).padStart(12, '0')}`;
      colors.add(userColor(id));
    }
    expect(colors.size).toBeGreaterThanOrEqual(5);
  });

  it('handles single-char and empty-ish inputs without crashing', () => {
    expect(PALETTE).toContain(userColor('a'));
    expect(PALETTE).toContain(userColor(' '));
    // Empty string: deterministic but unspecified which color — just
    // must not throw and must return a palette entry.
    expect(PALETTE).toContain(userColor(''));
  });
});
