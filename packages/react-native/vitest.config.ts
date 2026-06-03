import { defineConfig } from 'vitest/config';

// We deliberately scope vitest to pure-logic helpers only. React
// Native components require a Metro-style transformer + a native
// host to render; that's not what vitest is good at. Integration /
// snapshot testing happens in the Expo example app.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
