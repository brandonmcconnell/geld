import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FILE_LIST, INSTALL_FILE, isNightlyManifest, LOCK_FILE, lockedOut, parseFileList, parseInstallRecord, parseLock, stalePaths, writeOrder } from '@geld/core/nightly';
import type { InstallRecord, ZipEntry } from '@geld/core/nightly';

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
  return manifest !== null && isNightlyManifest(manifest) ? 'nightly' : 'other';
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

/** Mirrors LOCK_SETTLE_MS in apps/extension/src/nightly/writers.ts, whose lock this one shares. */
const LOCK_SETTLE_MS = 500;
const INSTALLER_TOKEN = 'geld-nightly-installer';

/**
 * The extension's updater may be writing into the same folder (an update found while the installer runs), so
 * the installer takes the same lock the extension does (@geld/core/nightly `LOCK_FILE`).
 */
async function lock(dir: string): Promise<void> {
  const file = path.join(dir, LOCK_FILE);
  const busy = 'Geld Nightly is installing an update into this folder from the browser. Try again in a few minutes.';
  if (lockedOut(parseLock(await readText(file)), INSTALLER_TOKEN, Date.now())) throw new Error(busy);
  await writeFile(file, JSON.stringify({ token: INSTALLER_TOKEN, at: Date.now() }));
  await new Promise((resolve) => setTimeout(resolve, LOCK_SETTLE_MS));
  if (parseLock(await readText(file))?.token !== INSTALLER_TOKEN) throw new Error(busy);
}

export async function writeBuild(dir: string, entries: readonly ZipEntry[], record: InstallRecord): Promise<void> {
  const state = await inspectTarget(dir);
  if (state === 'other') throw new Error(`${dir} already holds something that is not Geld Nightly. Geld never writes over it. Pick another folder with --dir.`);
  await mkdir(dir, { recursive: true });
  await lock(dir);
  try {
    const current = await listFiles(dir);
    const owned = parseFileList((await readText(path.join(dir, FILE_LIST))) ?? '') ?? [];
    for (const entry of writeOrder(entries, current)) {
      const file = path.join(dir, ...entry.path.split('/'));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, entry.data);
    }
    for (const stale of stalePaths(owned, entries.map((entry) => entry.path))) {
      await rm(path.join(dir, ...stale.split('/')), { force: true });
    }
    await writeFile(path.join(dir, INSTALL_FILE), `${JSON.stringify(record, null, 2)}\n`);
  } finally {
    await rm(path.join(dir, LOCK_FILE), { force: true });
  }
}

/** Installer state lives in ~/.geld, never in a build folder, which belongs to the extension. */
export interface InstallerState {
  readonly installs: readonly InstallRecord[];
}

export async function recordInstall(stateDir: string, record: InstallRecord): Promise<void> {
  const file = path.join(stateDir, 'nightly.json');
  let installs: InstallRecord[] = [];
  const previous = await readText(file);
  if (previous !== null) {
    try {
      const parsed: unknown = JSON.parse(previous);
      if (typeof parsed === 'object' && parsed !== null && 'installs' in parsed && Array.isArray(parsed.installs)) {
        const listed: readonly unknown[] = parsed.installs;
        installs = listed.flatMap((entry) => {
          const known = parseInstallRecord(JSON.stringify(entry));
          return known === null || known.folder === record.folder ? [] : [known];
        });
      }
    } catch {
      installs = [];
    }
  }
  await mkdir(stateDir, { recursive: true });
  const state: InstallerState = { installs: [...installs, record] };
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`);
}
