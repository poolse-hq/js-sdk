import { defineConfig } from 'tsup';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

// See @poolse/react's tsup.config.ts for the rationale — same RSC
// client-boundary requirement; esbuild's `banner` won't preserve it
// because the bundler treats `'use client';` as a no-op string.
const CLIENT_DIRECTIVE = "'use client';\n";

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2022',
  external: ['react', 'react-dom', '@poolse/sdk', '@poolse/react'],
  onSuccess: async () => {
    // 1. Prepend `'use client'` so RSC frameworks bundle this as a
    //    client component module.
    for (const file of ['dist/index.js', 'dist/index.cjs']) {
      const original = readFileSync(file, 'utf8');
      if (!original.startsWith(CLIENT_DIRECTIVE)) {
        writeFileSync(file, CLIENT_DIRECTIVE + original);
      }
    }
    // 2. Copy styles.css across — consumers do
    //    `import '@poolse/react-ui/styles.css'` and the package.json
    //    `exports."./styles.css"` field points at this copied path.
    copyFileSync('src/styles.css', 'dist/styles.css');
  },
});
