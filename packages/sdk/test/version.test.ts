import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { version } from '../src/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

describe('version', () => {
  it('exports a semver-shaped string', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('matches package.json', () => {
    // The runtime constant is hand-maintained, so nothing stops it
    // drifting from the published version except this assertion.
    expect(version).toBe(pkg.version);
  });
});
