import { readFile } from 'node:fs/promises';
import path from 'node:path';

const brandFiles = {
  'geld-logo.svg': '../../assets/brand/geld-logo.svg',
  'geld-logomark.svg': '../../assets/brand/geld-logomark.svg',
  'geld-logomark-white.svg': '../../assets/brand/geld-logomark-white.svg',
  'hero-digest.png': '../../assets/screenshots/hero-digest.png',
  'Geist-SemiBold.ttf': './node_modules/geist/dist/fonts/geist-sans/Geist-SemiBold.ttf',
  'GeistMono-Medium.ttf': './node_modules/geist/dist/fonts/geist-mono/GeistMono-Medium.ttf',
};

type BrandFile = keyof typeof brandFiles;

export function readBrandSource(file: BrandFile): Promise<Buffer> {
  return readFile(/* turbopackIgnore: true */ path.resolve(/* turbopackIgnore: true */ process.cwd(), brandFiles[file]));
}

export interface BrandShape {
  readonly viewBox: string;
  readonly width: number;
  readonly height: number;
  readonly paths: readonly string[];
}

export function parseShape(svg: string): BrandShape {
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
  if (viewBox === undefined) throw new Error('Brand SVG has no viewBox');
  const [, , width, height] = viewBox.split(/\s+/).map(Number);
  if (width === undefined || height === undefined || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`Brand SVG has an unreadable viewBox: ${viewBox}`);
  }
  const paths: string[] = [];
  for (const match of svg.matchAll(/<path\s+d="([^"]+)"/g)) {
    const d = match[1];
    if (d !== undefined) paths.push(d);
  }
  if (paths.length === 0) throw new Error('Brand SVG has no paths');
  return { viewBox, width, height, paths };
}

interface Screenshot {
  /** `data:image/png;base64,…`, which is how Satori (`next/og`) accepts raster images. */
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

function parseScreenshot(png: Buffer): Screenshot {
  // PNG signature (8 bytes), then the IHDR chunk: length (4), "IHDR" (4), width (4), height (4).
  if (png.length < 24 || png.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Hero digest screenshot is not a PNG');
  return { src: `data:image/png;base64,${png.toString('base64')}`, width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export interface OpenGraphSources {
  readonly wordmark: BrandShape;
  readonly screenshot: Screenshot;
  readonly sans: ArrayBuffer;
  readonly mono: ArrayBuffer;
}

export async function readOpenGraphSources(): Promise<OpenGraphSources> {
  const [wordmark, screenshot, sans, mono] = await Promise.all([
    readBrandSource('geld-logo.svg'),
    readBrandSource('hero-digest.png'),
    readBrandSource('Geist-SemiBold.ttf'),
    readBrandSource('GeistMono-Medium.ttf'),
  ]);
  return {
    wordmark: parseShape(wordmark.toString('utf8')),
    screenshot: parseScreenshot(screenshot),
    sans: new Uint8Array(sans).buffer,
    mono: new Uint8Array(mono).buffer,
  };
}
