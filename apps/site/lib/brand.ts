import { cacheLife } from 'next/cache';

import { parseShape, readBrandSource, readOpenGraphSources } from './brand-files';
import type { BrandShape, OpenGraphSources } from './brand-files';

type LogomarkFile = 'geld-logomark.svg' | 'geld-logomark-white.svg';
declare const __GELD_LOGOMARKS__: Readonly<Record<LogomarkFile, string>> | undefined;

async function loadShape(file: LogomarkFile): Promise<BrandShape> {
  'use cache';
  cacheLife('max');
  // Workers render icon routes on demand and need the SVGs bundled.
  const svg = typeof __GELD_LOGOMARKS__ === 'undefined'
    ? await readBrandSource(file)
    : Buffer.from(__GELD_LOGOMARKS__[file], 'base64');
  return parseShape(svg.toString('utf8'));
}

export function loadLogomark(): Promise<BrandShape> {
  return loadShape('geld-logomark.svg');
}

/** The logomark's dark-mode cut: the same shape, every edge moved inward, since light on dark reads bolder. */
export function loadDarkLogomark(): Promise<BrandShape> {
  return loadShape('geld-logomark-white.svg');
}

export async function loadOpenGraphSources(): Promise<OpenGraphSources> {
  'use cache';
  cacheLife('max');
  return readOpenGraphSources();
}
