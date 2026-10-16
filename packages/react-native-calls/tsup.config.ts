import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2022',
  // The host app supplies these; never bundle them. `expo-modules-core`
  // in particular must stay an external require so it resolves against
  // the app's copy at runtime.
  external: ['react', 'react-native', 'expo', 'expo-modules-core'],
});
