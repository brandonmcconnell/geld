import type { ZipEntry } from './unzip';

/** Mirrors the nightly name in wxt.config.ts: only a nightly build may replace a nightly build. */
export const NIGHTLY_NAME = 'Geld Nightly';
/** The nightly page, present only in nightly builds. */
export const NIGHTLY_PAGE = 'nightly.html';
/** Every file of a nightly build, written at build time (wxt.config.ts), so the running build can copy itself before an install. */
export const FILE_LIST = 'nightly-files.json';
/** Written into the folder and read back through the extension's own URL to prove it is the folder Geld runs from. */
export const PROBE_FILE = 'nightly-probe.txt';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Why the archive is not the nightly build it claims to be, or null when it is. */
export function buildProblem(entries: readonly ZipEntry[], expectedVersion: string): string | null {
  const manifest = entries.find((entry) => entry.path === 'manifest.json');
  if (manifest === undefined) return 'The download has no manifest.json.';
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(manifest.data));
  } catch {
    return 'The download has an unreadable manifest.json.';
  }
  if (!isRecord(parsed) || parsed['name'] !== NIGHTLY_NAME) return 'The download is not a Geld Nightly build.';
  if (parsed['version'] !== expectedVersion) return `The download is version ${String(parsed['version'])}, not ${expectedVersion}.`;
  if (!entries.some((entry) => entry.path === NIGHTLY_PAGE)) return 'The download is not a Geld Nightly build.';
  return null;
}

/**
 * Files in the folder that the new build does not have. Hidden files and
 * Chrome's own `_metadata` are not the build's and stay.
 */
/**
 * The files to delete after a build is written: those Geld wrote before (`owned`, from the build lists) that the
 * new build lacks. Anything else in the folder is the reader's and is never touched.
 */
export function stalePaths(owned: readonly string[], incoming: readonly string[]): string[] {
  const keep = new Set(incoming);
  return [...new Set(owned)].filter((path) => {
    if (keep.has(path)) return false;
    const parts = path.split('/');
    return !parts.some((part) => part.startsWith('.')) && parts[0] !== '_metadata';
  });
}

export function parseFileList(text: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed['files'])) return null;
  const files: readonly unknown[] = parsed['files'];
  const paths = files.filter((file): file is string => typeof file === 'string');
  return paths.length === files.length && paths.includes('manifest.json') ? paths : null;
}

/**
 * The order to write a build in: files the running build does not have first, since nothing loads them yet,
 * then the ones it shares, and the manifest last. Until the manifest is written Chrome would still start the
 * old build, so a write that breaks off leaves as little as possible of the new one in its way.
 */
export function writeOrder<T extends { readonly path: string }>(entries: readonly T[], current: readonly string[]): T[] {
  const existing = new Set(current);
  const rank = (entry: T): number => (entry.path === 'manifest.json' ? 2 : existing.has(entry.path) ? 1 : 0);
  return [...entries].sort((a, b) => rank(a) - rank(b));
}
