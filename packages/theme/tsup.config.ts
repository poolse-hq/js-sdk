import { defineConfig } from 'tsup';

// Plain data and pure functions, no runtime dependencies — the same
// bundle serves the web packages and React Native.
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
