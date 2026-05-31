import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  // Dual build: ESM for modern bundlers / Node, CJS for old toolchains.
  // `dts` emits a .d.ts AND a .d.cts so the package.json `exports`
  // conditional types resolve correctly under both module systems.
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2022',
  // The SDK is a browser-and-Node library; tsup bundles dependencies by
  // default, so anything we leave external must be listed here. We have
  // none yet — fetch() and the Phoenix Channels client come later.
  external: [],
});
