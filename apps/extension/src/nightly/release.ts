/**
 * The latest GitHub Release, read as a nightly build. CI publishes a release
 * for every push to `main` that touches the extension, tagged
 * `v{version}-build.{run}` with each browser's nightly build as
 * `geld-{version}.{run}-{browser}-nightly.zip` beside the store zips.
 */

/** Plain strings, not templates on NIGHTLY_REPO: a module-level template survives tree-shaking into the store builds. */
export const NIGHTLY_REPO = 'brandonmcconnell/geld';
export const LATEST_RELEASE_URL = 'https://api.github.com/repos/brandonmcconnell/geld/releases/latest';
/**
 * github.com redirects this to the latest release's tag page. Unlike the REST API, whose 60 unauthenticated
 * requests an hour are shared by everyone behind one address (and a 304 was seen to count against them in
 * Nov 2026), the website can be asked on every page load, so the API is asked only when the tag changes.
 */
export const LATEST_RELEASE_PAGE = 'https://github.com/brandonmcconnell/geld/releases/latest';
/** CI's workflow token uploads every release asset, so an asset from anyone else is not a build. */
export const RELEASE_UPLOADER = 'github-actions[bot]';

export interface NightlyRelease {
  readonly tag: string;
  /** The four-part manifest version the build carries, `0.1.2.3267`. */
  readonly version: string;
  readonly build: number;
  readonly assetName: string;
  readonly assetUrl: string;
  readonly size: number;
  readonly publishedAt: string;
  readonly htmlUrl: string;
}

/** The browsers whose nightly build updates itself (wxt.config.ts `selfUpdating`). */
export type NightlyBrowser = 'chrome' | 'edge';

export function nightlyAssetName(version: string, browser: NightlyBrowser): string {
  return `geld-${version}-${browser}-nightly.zip`;
}

const TAG = /^v(\d+\.\d+\.\d+)-build\.(\d+)$/;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

/** The release's nightly build, or null when the release is not one CI published or carries none. */
export function parseRelease(json: unknown, browser: NightlyBrowser): NightlyRelease | null {
  if (!isRecord(json) || json['draft'] === true || json['prerelease'] === true) return null;
  const tag = stringField(json, 'tag_name');
  const match = tag === null ? null : TAG.exec(tag);
  if (tag === null || match === null) return null;
  const build = Number(match[2]);
  const version = `${match[1]}.${build}`;
  const listed: unknown = json['assets'];
  if (!Array.isArray(listed)) return null;
  const assets: readonly unknown[] = listed;
  const name = nightlyAssetName(version, browser);
  for (const asset of assets) {
    if (!isRecord(asset) || stringField(asset, 'name') !== name) continue;
    const uploader = asset['uploader'];
    if (!isRecord(uploader) || stringField(uploader, 'login') !== RELEASE_UPLOADER) return null;
    const url = stringField(asset, 'browser_download_url');
    const size = asset['size'];
    if (url === null || !url.startsWith(`https://github.com/${NIGHTLY_REPO}/releases/download/`)) return null;
    return {
      tag,
      version,
      build,
      assetName: name,
      assetUrl: url,
      size: typeof size === 'number' ? size : 0,
      publishedAt: stringField(json, 'published_at') ?? '',
      htmlUrl: stringField(json, 'html_url') ?? `https://github.com/${NIGHTLY_REPO}/releases/tag/${tag}`,
    };
  }
  return null;
}

/** Compares dotted numeric versions part by part; a missing part counts as 0. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (Number.isNaN(diff)) return 0;
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

/** The fourth part of a CI version, or null for a local build that has none. */
export function buildOf(version: string): number | null {
  const parts = version.split('.');
  return parts.length === 4 && /^\d+$/.test(parts[3] ?? '') ? Number(parts[3]) : null;
}

/** The tag the latest-release redirect landed on, or null when it landed anywhere else (a sign-in page, an error). */
export function tagFromReleaseUrl(url: string): string | null {
  const prefix = `https://github.com/${NIGHTLY_REPO}/releases/tag/`;
  if (!url.startsWith(prefix)) return null;
  const tag = decodeURIComponent(url.slice(prefix.length).split(/[?#]/)[0] ?? '');
  return TAG.test(tag) ? tag : null;
}
