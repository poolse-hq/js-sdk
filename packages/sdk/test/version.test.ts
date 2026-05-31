import { describe, expect, it } from 'vitest';
import { version } from '../src/index.js';

describe('version', () => {
  it('exports a semver-shaped string', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
