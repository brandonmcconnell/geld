import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __GELD_NIGHTLY__: 'false' },
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
