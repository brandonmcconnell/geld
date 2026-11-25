import { ImageResponse } from 'next/og';

import { loadOpenGraphSources } from '@/lib/brand';
import { openGraphSize, renderOpenGraphCard } from '@/lib/open-graph-card';
import { TAGLINE } from '@/lib/site';

declare const __GELD_OPEN_GRAPH_PNG__: string | undefined;

export const alt = TAGLINE;
export const size = openGraphSize;
export const contentType = 'image/png';

export default async function OpenGraphImage() {
  // A cold render can exceed the Workers CPU limit. The Vinext build renders the same card in Node.
  if (typeof __GELD_OPEN_GRAPH_PNG__ !== 'undefined') {
    return new Response(new Uint8Array(Buffer.from(__GELD_OPEN_GRAPH_PNG__, 'base64')), {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=0, must-revalidate' },
    });
  }

  return renderOpenGraphCard(ImageResponse, await loadOpenGraphSources());
}
