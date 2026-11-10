import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __GELD_NIGHTLY__: 'false', __GELD_CHANNEL__: JSON.stringify('stable') },
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
