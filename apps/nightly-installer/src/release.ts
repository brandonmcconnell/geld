import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { buildProblem, LATEST_RELEASE_URL, manifestTextOf, parseChecksum, parseRelease, readZip } from '@geld/core/nightly';
import type { NightlyBrowser, NightlyRelease, ZipEntry } from '@geld/core/nightly';

/** The latest release's nightly builds, taken and refused by the same rules as the extension's updater (@geld/core/nightly). */

export type Fetch = (url: string, init?: { readonly headers?: Record<string, string> }) => Promise<Response>;

export async function latestRelease(fetch: Fetch): Promise<unknown> {
  const response = await fetch(LATEST_RELEASE_URL, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'geld-nightly' } });
  if (response.status === 403 || response.status === 429) throw new Error('GitHub is limiting requests from this network. Try again in a few minutes.');
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for the latest release.`);
  return response.json();
}

export function pickBuild(release: unknown, browser: NightlyBrowser): NightlyRelease {
  const build = parseRelease(release, browser);
  if (build === null) throw new Error(`The latest release has no ${browser} nightly build with its checksum, uploaded by Geld's CI.`);
  return build;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** Checks the zip against its published checksum, then that it holds the build it claims, before anything is unzipped onto disk. */
export async function verifiedEntries(build: NightlyRelease, zip: Uint8Array, checksums: string): Promise<ZipEntry[]> {
  const expected = parseChecksum(checksums, build.assetName);
  if (expected === null) throw new Error(`${build.assetName}.sha256 names no checksum for ${build.assetName}.`);
  if (sha256(zip) !== expected) throw new Error(`${build.assetName} does not match its published checksum.`);
  const entries = await readZip(zip, { inflate: (data) => new Uint8Array(inflateRawSync(data)), decode });
  const problem = buildProblem(entries.map((entry) => entry.path), manifestTextOf(entries, decode), build.version);
  if (problem !== null) throw new Error(problem);
  return entries;
}

export async function download(fetch: Fetch, url: string): Promise<Uint8Array> {
  const response = await fetch(url, { headers: { 'User-Agent': 'geld-nightly' } });
  if (!response.ok) throw new Error(`The download of ${url} failed (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}
