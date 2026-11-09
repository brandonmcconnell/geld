import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { claimLock, FILE_LIST, INSTALL_FILE, isNightlyManifest, LOCK_FILE, parseFileList, parseInstallRecord, releaseLock, stalePaths, writeOrder } from '@geld/core/nightly';
import type { InstallRecord, LockIo, ZipEntry } from '@geld/core/nightly';

/** Writes a verified build into its folder, and only ever into a folder that is empty or already a nightly build. */

export type TargetState = 'missing' | 'empty' | 'nightly' | 'other';

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

export async function inspectTarget(dir: string): Promise<TargetState> {
  let info;
  try {
    info = await stat(dir);
  } catch {
    return 'missing';
  }
  if (!info.isDirectory()) return 'other';
  const names = (await readdir(dir)).filter((name) => !name.startsWith('.'));
  if (names.length === 0) return 'empty';
  const manifest = await readText(path.join(dir, 'manifest.json'));
  if (manifest !== null && isNightlyManifest(manifest)) return 'nightly';
  // The installer writes its record before anything else, so a folder it was interrupted in is still its own.
  return (await folderRecord(dir)) !== null ? 'nightly' : 'other';
}

async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await listFiles(dir, relative)));
    else files.push(relative);
  }
  return files;
}

/**
 * The extension's updater may be writing into the same folder (an update found while the installer runs), and so
 * may another installer run, so the installer takes the extension's lock (`claimLock`) under a token of its own
 * per run. A claim is written beside the lock and renamed over it, so a reader never sees half of one.
 */
function folderLock(dir: string, name = LOCK_FILE): LockIo {
  const file = path.join(dir, name);
  return {
    read: () => readText(file),
    async write(text) {
      if (text === null) return rm(file, { force: true });
      const claim = `${file}.${randomUUID()}`;
      await writeFile(claim, text);
      await rename(claim, file);
    },
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

/** A file is written beside its place and renamed over it, so an interrupted run never leaves half of one. */
async function writeWhole(file: string, data: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const partial = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.partial`);
  await writeFile(partial, data);
  await rename(partial, file);
}

/**
 * Writes the record first and every file whole, the manifest last: a run stopped at any point leaves a folder
 * the next run recognises (`inspectTarget`) and repairs, never one it refuses as someone else's.
 */
export async function writeBuild(dir: string, entries: readonly ZipEntry[], record: InstallRecord): Promise<void> {
  const state = await inspectTarget(dir);
  if (state === 'other') throw new Error(`${dir} already holds something that is not Geld Nightly. Geld never writes over it. Pick another folder with --dir.`);
  await mkdir(dir, { recursive: true });
  const lock = folderLock(dir);
  const token = `geld-nightly-installer-${randomUUID()}`;
  if (!(await claimLock(lock, token))) throw new Error('Geld Nightly is installing an update into this folder. Try again in a few minutes.');
  try {
    const current = await listFiles(dir);
    const owned = parseFileList((await readText(path.join(dir, FILE_LIST))) ?? '') ?? [];
    const recordText = `${JSON.stringify(record, null, 2)}\n`;
    await writeWhole(path.join(dir, INSTALL_FILE), recordText);
    for (const entry of writeOrder(entries, current)) await writeWhole(path.join(dir, ...entry.path.split('/')), entry.data);
    for (const stale of stalePaths(owned, entries.map((entry) => entry.path))) {
      await rm(path.join(dir, ...stale.split('/')), { force: true });
    }
  } finally {
    await releaseLock(lock, token);
  }
}

/** Installer state lives in ~/.geld, never in a build folder, which belongs to the extension. */
export interface InstallerState {
  readonly installs: readonly InstallRecord[];
}

export async function readInstalls(stateDir: string): Promise<InstallRecord[]> {
  const previous = await readText(path.join(stateDir, 'nightly.json'));
  if (previous === null) return [];
  try {
    const parsed: unknown = JSON.parse(previous);
    if (typeof parsed !== 'object' || parsed === null || !('installs' in parsed) || !Array.isArray(parsed.installs)) return [];
    const listed: readonly unknown[] = parsed.installs;
    return listed.flatMap((entry) => {
      const known = parseInstallRecord(JSON.stringify(entry));
      return known === null ? [] : [known];
    });
  } catch {
    return [];
  }
}

/** The install record in a build folder (`INSTALL_FILE`): which browser profile the folder belongs to. */
export async function folderRecord(dir: string): Promise<InstallRecord | null> {
  const text = await readText(path.join(dir, INSTALL_FILE));
  return text === null ? null : parseInstallRecord(text);
}

export function sameProfile(a: Pick<InstallRecord, 'browser' | 'profile'>, b: Pick<InstallRecord, 'browser' | 'profile'>): boolean {
  return a.browser === b.browser && a.profile.directory === b.profile.directory;
}

/** How long a run waits for another to finish writing `nightly.json`, which takes moments. */
const STATE_WAIT_MS = 30_000;

/**
 * One entry per profile and per folder: the latest install of either replaces the one before. Runs for different
 * profiles share the file, so its read and write happen under a lock of its own, or one run's entry would be lost.
 */
export async function recordInstall(stateDir: string, record: InstallRecord): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  const lock = folderLock(stateDir, 'nightly.json.lock');
  const token = `geld-nightly-installer-${randomUUID()}`;
  const giveUpAt = Date.now() + STATE_WAIT_MS;
  while (!(await claimLock(lock, token))) {
    if (Date.now() > giveUpAt) throw new Error(`Another geld-nightly run is still writing ${path.join(stateDir, 'nightly.json')}. Run this again once it is done.`);
    await new Promise((resolve) => setTimeout(resolve, 250 + Math.random() * 500));
  }
  try {
    const installs = (await readInstalls(stateDir)).filter((known) => known.folder !== record.folder && !sameProfile(known, record));
    const state: InstallerState = { installs: [...installs, record] };
    await writeWhole(path.join(stateDir, 'nightly.json'), `${JSON.stringify(state, null, 2)}\n`);
  } finally {
    await releaseLock(lock, token);
  }
}
