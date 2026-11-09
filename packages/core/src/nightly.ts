/**
 * Nightly builds: which release asset is a nightly build, how a downloaded build is checked, and how its
 * files are laid out in the folder it runs from. Shared by the self-updating extension and the installer
 * (apps/nightly-installer), so both take and refuse exactly the same builds. No browser or Node APIs: the
 * zip reader is handed its inflater and decoder.
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
const DOWNLOAD_PREFIX = 'https://github.com/brandonmcconnell/geld/releases/download/';
/** CI's workflow token uploads every release asset, so an asset from anyone else is not a build. */
export const RELEASE_UPLOADER = 'github-actions[bot]';

/** The browsers whose nightly build updates itself (wxt.config.ts `selfUpdating`). */
export type NightlyBrowser = 'chrome' | 'edge';

export interface NightlyRelease {
  readonly tag: string;
  /** The four-part manifest version the build carries, `0.1.2.3267`. */
  readonly version: string;
  readonly build: number;
  readonly assetName: string;
  readonly assetUrl: string;
  /** The `<zip>.sha256` CI publishes beside it (`sha256sum` output). */
  readonly checksumUrl: string;
  readonly size: number;
  readonly publishedAt: string;
  readonly htmlUrl: string;
}

export function nightlyAssetName(version: string, browser: NightlyBrowser): string {
  return `geld-${version}-${browser}-nightly.zip`;
}

export function checksumAssetName(assetName: string): string {
  return `${assetName}.sha256`;
}

const TAG = /^v(\d+\.\d+\.\d+)-build\.(\d+)$/;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

/** An asset CI uploaded to this repository's download path, or null for anything else of that name. */
function ciAsset(assets: readonly unknown[], name: string): { readonly url: string; readonly size: number } | null {
  for (const asset of assets) {
    if (!isRecord(asset) || stringField(asset, 'name') !== name) continue;
    const uploader = asset['uploader'];
    if (!isRecord(uploader) || stringField(uploader, 'login') !== RELEASE_UPLOADER) return null;
    const url = stringField(asset, 'browser_download_url');
    if (url === null || !url.startsWith(DOWNLOAD_PREFIX)) return null;
    const size = asset['size'];
    return { url, size: typeof size === 'number' ? size : 0 };
  }
  return null;
}

/**
 * The release's nightly build for `browser`, or null when the release is not one CI published (a draft, a
 * prerelease, another tag) or does not carry that build and its checksum, both uploaded by CI.
 */
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
  const zip = ciAsset(assets, name);
  const checksum = ciAsset(assets, checksumAssetName(name));
  if (zip === null || checksum === null) return null;
  return {
    tag,
    version,
    build,
    assetName: name,
    assetUrl: zip.url,
    checksumUrl: checksum.url,
    size: zip.size,
    publishedAt: stringField(json, 'published_at') ?? '',
    htmlUrl: stringField(json, 'html_url') ?? `https://github.com/brandonmcconnell/geld/releases/tag/${tag}`,
  };
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
  const prefix = 'https://github.com/brandonmcconnell/geld/releases/tag/';
  if (!url.startsWith(prefix)) return null;
  const tag = decodeURIComponent(url.slice(prefix.length).split(/[?#]/)[0] ?? '');
  return TAG.test(tag) ? tag : null;
}

/** The hash a `sha256sum` line gives for `name`, lowercased, or null when the file names no such hash. */
export function parseChecksum(text: string, name: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line.trim());
    if (match !== null && match[2] === name) return (match[1] ?? '').toLowerCase();
  }
  return null;
}

/** Mirrors NIGHTLY_NAME in apps/extension/wxt.config.ts: only a nightly build may replace a nightly build. */
export const NIGHTLY_NAME = 'Geld Nightly';
/** The nightly page, present only in the self-updating nightly builds. */
export const NIGHTLY_PAGE = 'nightly.html';
/** Every file of a nightly build, written at build time (wxt.config.ts), so the running build can copy itself before an install. */
export const FILE_LIST = 'nightly-files.json';
/** Written into the folder and read back through the extension's own URL to prove it is the folder Geld runs from. */
export const PROBE_FILE = 'nightly-probe.txt';
/** Written by the installer: where the folder is and which profile it is for (`parseInstallRecord`). */
export const INSTALL_FILE = 'nightly-install.json';
/** Held while a build is written into the folder, so two profiles loading one folder never write at once. */
export const LOCK_FILE = 'nightly-update.lock';

/** Files in a build folder that are not the build's and that an update keeps. */
const KEPT = new Set([INSTALL_FILE, LOCK_FILE]);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Why the files are not the nightly build they claim to be, or null when they are. */
export function buildProblem(paths: readonly string[], manifestText: string | null, expectedVersion: string): string | null {
  if (manifestText === null) return 'The download has no manifest.json.';
  const manifest = parseJson(manifestText);
  if (manifest === undefined) return 'The download has an unreadable manifest.json.';
  if (!isRecord(manifest) || manifest['name'] !== NIGHTLY_NAME) return 'The download is not a Geld Nightly build.';
  if (manifest['version'] !== expectedVersion) return `The download is version ${String(manifest['version'])}, not ${expectedVersion}.`;
  if (!paths.includes(NIGHTLY_PAGE)) return 'The download is not a Geld Nightly build.';
  return null;
}

/** Whether a folder's manifest says it holds a nightly build, which is the only kind of folder an update writes over. */
export function isNightlyManifest(manifestText: string): boolean {
  const manifest = parseJson(manifestText);
  return isRecord(manifest) && manifest['name'] === NIGHTLY_NAME;
}

/**
 * Files in the folder that the new build does not have. Hidden files, Chrome's own `_metadata` and the
 * installer's and updater's own files are not the build's and stay.
 */
export function stalePaths(existing: readonly string[], incoming: readonly string[]): string[] {
  const keep = new Set(incoming);
  return existing.filter((path) => {
    if (keep.has(path) || KEPT.has(path)) return false;
    const parts = path.split('/');
    return !parts.some((part) => part.startsWith('.')) && parts[0] !== '_metadata';
  });
}

export function parseFileList(text: string): string[] | null {
  const parsed = parseJson(text);
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

/** What the installer leaves in each build folder (`INSTALL_FILE`). */
export interface InstallRecord {
  /** The folder's absolute path, to show when Chrome asks for it. */
  readonly folder: string;
  readonly installedAt: string;
  readonly version: string;
  readonly browser: string;
  readonly profile: { readonly directory: string; readonly name: string };
  /** The folder's name when it sits directly in the profile's download folder, so the downloads API can write to it with no picker. */
  readonly downloadsName: string | null;
}

export function parseInstallRecord(text: string): InstallRecord | null {
  const value = parseJson(text);
  if (!isRecord(value)) return null;
  const profile = value['profile'];
  const folder = stringField(value, 'folder');
  const installedAt = stringField(value, 'installedAt');
  const version = stringField(value, 'version');
  const browser = stringField(value, 'browser');
  const downloadsName = value['downloadsName'];
  if (folder === null || installedAt === null || version === null || browser === null || !isRecord(profile)) return null;
  const directory = stringField(profile, 'directory');
  const name = stringField(profile, 'name');
  if (directory === null || name === null || (downloadsName !== null && typeof downloadsName !== 'string')) return null;
  return { folder, installedAt, version, browser, profile: { directory, name }, downloadsName };
}

/** The update lock's contents (`LOCK_FILE`): who holds it, and since when. */
export interface UpdateLock {
  readonly token: string;
  readonly at: number;
}

/** A lock older than this was left by a writer that stopped: it no longer holds anyone back. */
export const LOCK_STALE_MS = 3 * 60_000;

export function parseLock(text: string | null): UpdateLock | null {
  const value = text === null ? undefined : parseJson(text);
  if (!isRecord(value) || typeof value['token'] !== 'string' || typeof value['at'] !== 'number') return null;
  return { token: value['token'], at: value['at'] };
}

/** Whether a lock someone else holds keeps `token` from writing now. */
export function lockedOut(lock: UpdateLock | null, token: string, now: number): boolean {
  return lock !== null && lock.token !== token && now - lock.at < LOCK_STALE_MS;
}

export interface ZipEntry {
  readonly path: string;
  readonly data: Uint8Array;
}

export interface ZipCodec {
  /** Raw DEFLATE, as zip stores it (no zlib header). */
  readonly inflate: (data: Uint8Array) => Promise<Uint8Array> | Uint8Array;
  /** UTF-8 file names. */
  readonly decode: (bytes: Uint8Array) => string;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
let crcTable: Uint32Array | null = null;

export function crc32(data: Uint8Array): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function isSafePath(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function endOfCentralDirectory(view: DataView): number {
  for (let at = view.byteLength - 22; at >= Math.max(0, view.byteLength - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === EOCD) return at;
  }
  throw new Error('Not a zip file');
}

/**
 * Reads the zips WXT writes: stored or deflated entries, no zip64, no encryption. Each entry's CRC is
 * checked, and a path that could reach outside the folder it is written to is refused.
 */
export async function readZip(bytes: Uint8Array, codec: ZipCodec): Promise<ZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = endOfCentralDirectory(view);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== CENTRAL) throw new Error('Damaged zip directory');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const path = codec.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (path.endsWith('/')) continue;
    if (flags & 1) throw new Error(`Encrypted zip entry: ${path}`);
    if (compressed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) throw new Error('Zip64 is not supported');
    if (!isSafePath(path)) throw new Error(`Unsafe path in zip: ${path}`);
    if (view.getUint32(local, true) !== LOCAL) throw new Error(`Damaged zip entry: ${path}`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + compressed);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await codec.inflate(raw);
    else throw new Error(`Unsupported zip compression ${method}: ${path}`);
    if (data.byteLength !== size || crc32(data) !== crc) throw new Error(`Corrupt zip entry: ${path}`);
    entries.push({ path, data });
  }
  return entries;
}

/** The manifest's text among a zip's entries, for `buildProblem`. */
export function manifestTextOf(entries: readonly ZipEntry[], decode: (bytes: Uint8Array) => string): string | null {
  const manifest = entries.find((entry) => entry.path === 'manifest.json');
  return manifest === undefined ? null : decode(manifest.data);
}
