import type { ZipEntry } from './unzip';

/** Mirrors the nightly name in wxt.config.ts: only a nightly build may replace a nightly build. */
export const NIGHTLY_NAME = 'Geld Nightly';
/** The nightly page, present only in nightly builds. */
export const NIGHTLY_PAGE = 'nightly.html';
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
export function stalePaths(existing: readonly string[], incoming: readonly string[]): string[] {
  const keep = new Set(incoming);
  return existing.filter((path) => {
    if (keep.has(path)) return false;
    const parts = path.split('/');
    return !parts.some((part) => part.startsWith('.')) && parts[0] !== '_metadata';
  });
}
