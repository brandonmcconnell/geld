import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    // The tests build every master, which takes several seconds a test on a CI runner.
    testTimeout: 60_000,
  },
});
