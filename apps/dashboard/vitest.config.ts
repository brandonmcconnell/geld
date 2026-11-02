import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  test: {
    maxWorkers: 2,
    testTimeout: 30000,
    include: ['lib/**/*.test.ts'],
    environment: 'node',
  },
});
