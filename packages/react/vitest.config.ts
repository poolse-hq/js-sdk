import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // happy-dom is faster than jsdom and covers everything React needs.
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
    },
  },
});
