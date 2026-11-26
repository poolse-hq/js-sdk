import { defineConfig } from 'vitest/config';

// The TS bridge only: expo-modules-core and react-native are mocked in
// each test. The Kotlin and Swift cores have their own tests.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
