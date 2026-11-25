import { cloudflare } from '@cloudflare/vite-plugin';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vinext from 'vinext';
import nextConfig from './next.config.ts';

export default defineConfig({
  resolve: {
    alias: {
      '@/lib/measurement-code': fileURLToPath(new URL('./worker/measurement-code.ts', import.meta.url)),
    },
  },
  plugins: [
    vinext({ nextConfig: { headers: nextConfig.headers } }),
    cloudflare({ viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] } }),
  ],
});
