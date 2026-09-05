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

type GeistFile = 'Geist-Regular.ttf' | 'Geist-Medium.ttf' | 'Geist-SemiBold.ttf' | 'GeistMono-Regular.ttf' | 'GeistMono-Medium.ttf';

/** Geist TTFs shipped by the `geist` package, for Satori (which cannot read woff2). */
export async function loadGeistFont(file: GeistFile): Promise<ArrayBuffer> {
  'use cache';
  cacheLife('max');
  const family = file.startsWith('GeistMono') ? 'geist-mono' : 'geist-sans';
  const buffer = await readFile(/* turbopackIgnore: true */ path.join(process.cwd(), 'node_modules', 'geist', 'dist', 'fonts', family, file));
  return new Uint8Array(buffer).buffer;
}
