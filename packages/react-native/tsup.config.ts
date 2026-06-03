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
    'expo-image-picker',
    'expo-document-picker',
    '@poolse/sdk',
    '@poolse/react',
  ],
});
