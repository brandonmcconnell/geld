import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { INSTALLER_VERSION: '"test"' },
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
