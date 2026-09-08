import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { cacheLife } from 'next/cache';

/**
 * Build-time access to the shared brand SVGs in `assets/brand/`, used to draw
 * the Open Graph image and favicons from the very same paths as the logo.
 *
 * Only imported from metadata routes. The reads are `use cache` so those
 * routes count as static and are prerendered; the files are never read at
 * request time (hence the `turbopackIgnore` on the paths: nothing to trace).
 */
export interface BrandShape {
  readonly viewBox: string;
  readonly width: number;
  readonly height: number;
  readonly paths: readonly string[];
}

/** `apps/site` is the working directory both locally and on Vercel (Root Directory). */
const REPO_ROOT = path.resolve(process.cwd(), '..', '..');

function parseShape(svg: string): BrandShape {
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

async function loadShape(file: 'geld-logo.svg' | 'geld-logomark.svg'): Promise<BrandShape> {
  'use cache';
  cacheLife('max');
  const svg = await readFile(/* turbopackIgnore: true */ path.join(REPO_ROOT, 'assets', 'brand', file), 'utf8');
  return parseShape(svg);
}

export function loadWordmark(): Promise<BrandShape> {
  return loadShape('geld-logo.svg');
}

export function loadLogomark(): Promise<BrandShape> {
  return loadShape('geld-logomark.svg');
}

export interface Screenshot {
  /** `data:image/png;base64,…`, which is how Satori (`next/og`) accepts raster images. */
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

function pngDimensions(png: Buffer, file: string): { readonly width: number; readonly height: number } {
  // PNG signature (8 bytes), then the IHDR chunk: length (4), "IHDR" (4), width (4), height (4).
  if (png.length < 24 || png.toString('ascii', 12, 16) !== 'IHDR') throw new Error(`${file} is not a PNG`);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * Product screenshots in `assets/screenshots/` (2× captures of the extension
 * on github.com), embedded in the Open Graph image at build time.
 */
export async function loadScreenshot(file: 'pr-header-breakdown.png'): Promise<Screenshot> {
  'use cache';
  cacheLife('max');
  const png = await readFile(/* turbopackIgnore: true */ path.join(REPO_ROOT, 'assets', 'screenshots', file));
  return { src: `data:image/png;base64,${png.toString('base64')}`, ...pngDimensions(png, file) };
}

type GeistFile = 'Geist-Regular.ttf' | 'Geist-Medium.ttf' | 'Geist-SemiBold.ttf' | 'GeistMono-Regular.ttf' | 'GeistMono-Medium.ttf';

/** Geist TTFs shipped by the `geist` package, for Satori (which cannot read woff2). */
export async function loadGeistFont(file: GeistFile): Promise<ArrayBuffer> {
  'use cache';
  cacheLife('max');
  const family = file.startsWith('GeistMono') ? 'geist-mono' : 'geist-sans';
  const buffer = await readFile(/* turbopackIgnore: true */ path.join(process.cwd(), 'node_modules', 'geist', 'dist', 'fonts', family, file));
  return new Uint8Array(buffer).buffer;
}
