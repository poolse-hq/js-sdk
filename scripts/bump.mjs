#!/usr/bin/env node
/**
 * Set one version across the workspace.
 *
 * Three things have to move together and none can be derived from the
 * others at runtime:
 *
 *   * each package's own `version`
 *   * the `^x.y.z` ranges the packages use for each other — npm resolves
 *     these from the registry, so a stale range silently installs an
 *     older sibling alongside the new package
 *   * `packages/sdk/src/version.ts`, the constant the SDK reports to the
 *     server
 *
 * Bumping them by hand has already shipped a release whose package.json
 * and reported version disagreed. `pnpm bump <version>` does all three.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const PACKAGES = ['sdk', 'react', 'react-ui', 'react-native'];

const next = process.argv[2];
if (!next || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(next)) {
  console.error('usage: pnpm bump <version>   (e.g. pnpm bump 2.8.4)');
  process.exit(1);
}

for (const name of PACKAGES) {
  const file = `packages/${name}/package.json`;
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  pkg.version = next;

  for (const field of ['dependencies', 'peerDependencies', 'devDependencies']) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const dep of Object.keys(deps)) {
      // Only our own packages, and only caret ranges — an exact pin or a
      // `workspace:` protocol was chosen deliberately.
      if (dep.startsWith('@poolse/') && deps[dep].startsWith('^')) deps[dep] = `^${next}`;
    }
  }

  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`  ${pkg.name} -> ${next}`);
}

const versionFile = 'packages/sdk/src/version.ts';
const source = readFileSync(versionFile, 'utf8');
const updated = source.replace(
  /export const version = '[^']*';/,
  `export const version = '${next}';`,
);
if (updated === source) {
  console.error(`could not find the version constant in ${versionFile}`);
  process.exit(1);
}
writeFileSync(versionFile, updated);
console.log(`  ${versionFile} -> ${next}`);
