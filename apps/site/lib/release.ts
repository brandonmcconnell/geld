import { cacheLife, cacheTag } from 'next/cache';

import { LATEST_RELEASE_URL, RELEASES_URL, REPO_SLUG } from './site';

export interface ReleaseAsset {
  readonly name: string;
  readonly url: string;
}

export interface LatestRelease {
  /** Tag such as `v0.1.0`, or `null` when no release could be read. */
  readonly tag: string | null;
  /** Page to send people to; falls back to the repository's Releases list. */
  readonly url: string;
  readonly assets: readonly ReleaseAsset[];
}

export const FALLBACK_RELEASE: LatestRelease = { tag: null, url: RELEASES_URL, assets: [] };

const RELEASES_API_URL = `https://api.github.com/repos/${REPO_SLUG}/releases/latest`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function parseAsset(value: unknown): ReleaseAsset | null {
  if (!isRecord(value)) return null;
  const name = readString(value, 'name');
  const url = readString(value, 'browser_download_url');
  if (name === null || url === null) return null;
  return { name, url };
}

/** Turn a GitHub "release" API payload into a {@link LatestRelease}, or `null` if it is not one. */
export function parseRelease(value: unknown): LatestRelease | null {
  if (!isRecord(value)) return null;
  const tag = readString(value, 'tag_name');
  if (tag === null) return null;
  const url = readString(value, 'html_url') ?? LATEST_RELEASE_URL;
  const rawAssets = value['assets'];
  const assets: ReleaseAsset[] = [];
  if (Array.isArray(rawAssets)) {
    for (const entry of rawAssets) {
      const asset = parseAsset(entry);
      if (asset !== null) assets.push(asset);
    }
  }
  return { tag, url, assets };
}

/**
 * Latest GitHub Release of the extension. Cached and revalidated in the
 * background so pages stay fully static; any failure (no releases yet, rate
 * limit, network) degrades to the Releases page.
 */
export async function getLatestRelease(): Promise<LatestRelease> {
  'use cache';
  cacheTag('latest-release');
  cacheLife({ stale: 3600, revalidate: 3600, expire: 60 * 60 * 24 * 30 });

  try {
    const response = await fetch(RELEASES_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'geld.sh (https://geld.sh)',
      },
    });
    if (!response.ok) return FALLBACK_RELEASE;
    const payload: unknown = await response.json();
    return parseRelease(payload) ?? FALLBACK_RELEASE;
  } catch {
    return FALLBACK_RELEASE;
  }
}
