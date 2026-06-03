import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2022',
  external: [
    'react',
    'react-native',
    'react-native-svg',
    'expo-haptics',
    'expo-image-picker',
    'expo-document-picker',
    '@poolse/sdk',
    '@poolse/react',
  ],
  // Suppress tsup's "Could not resolve" warnings for the optional
  // expo modules — they're intentionally not statically imported.
  noExternal: [],
});
