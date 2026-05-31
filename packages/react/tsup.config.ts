import { defineConfig } from 'tsup';
import { readFileSync, writeFileSync } from 'node:fs';

// Every export in this package is a React hook or provider — strictly
// client-only. We need `'use client'` at the very top of the bundled
// output so RSC frameworks (Next.js app router, etc.) treat the whole
// module as a client boundary. Without this, `createContext` runs
// server-side too and consumers see "no <PoolseProvider> in the tree"
// because they're looking at a different context instance than the one
// the provider set.
//
// esbuild's `banner` option strips bare `'use client';` strings as
// no-op statements during bundling, so we re-add it as a post-build
// step on each output file.
const CLIENT_DIRECTIVE = "'use client';\n";

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2022',
  // React and @poolse/sdk are peer/workspace deps — never bundle them.
  external: ['react', 'react-dom', '@poolse/sdk'],
  onSuccess: async () => {
    for (const file of ['dist/index.js', 'dist/index.cjs']) {
      const original = readFileSync(file, 'utf8');
      if (!original.startsWith(CLIENT_DIRECTIVE)) {
        writeFileSync(file, CLIENT_DIRECTIVE + original);
      }
    }
  },
});
