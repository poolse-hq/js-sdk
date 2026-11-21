import { defineConfig } from 'tsup';

// No runtime dependencies: every primitive comes from the platform's
// WebCrypto (`globalThis.crypto.subtle`), so the same bundle serves
// browsers, Tauri webviews, Node 20+ and React Native (with a polyfill).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2022',
  external: [],
});
