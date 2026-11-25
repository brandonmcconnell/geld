import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { kvDataAdapter } from '@vinext/cloudflare/cache/kv-data-adapter';
import { ImageResponse } from 'next/og.js';
import { defineConfig } from 'vite';
import vinext from 'vinext';

import { readBrandSource, readOpenGraphSources } from './lib/brand-files.ts';
import { renderOpenGraphCard } from './lib/open-graph-card.tsx';

export default defineConfig(async ({ command, isPreview }) => {
  const [lightMark, darkMark, openGraphSources] = await Promise.all([
    readBrandSource('geld-logomark.svg'),
    readBrandSource('geld-logomark-white.svg'),
    readOpenGraphSources(),
  ]);
  const image = renderOpenGraphCard(ImageResponse, openGraphSources);

  return {
    css: { postcss: { plugins: [] } },
    define: {
      __GELD_OPEN_GRAPH_PNG__: JSON.stringify(Buffer.from(await image.arrayBuffer()).toString('base64')),
      __GELD_LOGOMARKS__: JSON.stringify({
        'geld-logomark.svg': lightMark.toString('base64'),
        'geld-logomark-white.svg': darkMark.toString('base64'),
      }),
      'process.env.GELD_SITE_PREVIEW_ORIGIN': JSON.stringify(
        process.env.GELD_SITE_PREVIEW_ORIGIN ?? (command === 'serve' && !isPreview ? 'http://localhost:3000' : ''),
      ),
    },
    plugins: [
      tailwindcss(),
      vinext({
        cache: { data: { ...kvDataAdapter(), options: {} } },
      }),
      cloudflare({
        viteEnvironment: {
          name: 'rsc',
          childEnvironments: ['ssr'],
        },
      }),
    ],
  };
});
