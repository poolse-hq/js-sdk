import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // The tamper tests flip every bit of a record and run hundreds of
    // decryptions; on a loaded machine or the self-hosted CI runner
    // (low priority) that takes longer than vitest's 5 s default.
    testTimeout: 30_000,
  },
});
