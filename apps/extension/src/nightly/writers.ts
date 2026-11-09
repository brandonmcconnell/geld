import { browser, type Browser } from 'wxt/browser';
import { PROBE_FILE, stalePaths } from './build-check';
import type { ZipEntry } from './unzip';

/**
 * Two ways for an unpacked build to replace its own files, both verified in
 * Chrome 156 (Nov 2026). Folder access (File System Access) works for any
 * folder, but Chrome grants it only while one of Geld's pages is open in a
 * tab and drops it when Geld reloads, so every install asks once. The
 * downloads API needs no grant, but writes only under the download folder.
 */

async function readOwnFile(path: string): Promise<string | null> {
  try {
    const response = await fetch(new URL(`/${path}`, globalThis.location.origin), { cache: 'no-store' });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

async function directoryFor(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle> {
  let dir = root;
  for (const part of path.split('/').slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
  return dir;
}

async function writeFile(root: FileSystemDirectoryHandle, path: string, data: Uint8Array): Promise<void> {
  const dir = await directoryFor(root, path);
  const file = await dir.getFileHandle(path.split('/').pop() ?? path, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(new Uint8Array(data));
  } finally {
    await writable.close();
  }
}

async function listFiles(dir: FileSystemDirectoryHandle, prefix = ''): Promise<string[]> {
  const paths: string[] = [];
  for await (const [name, handle] of dir.entries()) {
    const path = `${prefix}${name}`;
    if (handle instanceof FileSystemDirectoryHandle) paths.push(...(await listFiles(handle, `${path}/`)));
    else paths.push(path);
  }
  return paths;
}

async function removeFile(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  const parts = path.split('/');
  let dir = root;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
  await dir.removeEntry(parts[parts.length - 1] ?? path);
}

export async function folderPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  return (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'denied';
}

/** Whether the folder is the one Geld runs from: a file written there must come back through Geld's own URL. */
export async function folderIsOurs(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const token = crypto.randomUUID();
  await writeFile(handle, PROBE_FILE, new TextEncoder().encode(token));
  try {
    return (await readOwnFile(PROBE_FILE))?.trim() === token;
  } finally {
    await handle.removeEntry(PROBE_FILE).catch(() => undefined);
  }
}

export async function writeToFolder(handle: FileSystemDirectoryHandle, entries: readonly ZipEntry[]): Promise<void> {
  for (const entry of entries) await writeFile(handle, entry.path, entry.data);
  for (const path of stalePaths(await listFiles(handle), entries.map((entry) => entry.path))) {
    await removeFile(handle, path).catch(() => undefined);
  }
}

function base64(data: Uint8Array): string {
  let text = '';
  for (let at = 0; at < data.length; at += 0x8000) text += String.fromCharCode(...data.subarray(at, at + 0x8000));
  return btoa(text);
}

const DOWNLOAD_TIMEOUT_MS = 30_000;
const SAFE: ReadonlySet<string> = /* @__PURE__ */ new Set(['safe', 'accepted']);

/** A download the browser holds for a danger warning never completes on its own, so it is cancelled and reported. */
function settled(id: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (outcome: Error | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      browser.downloads.onChanged.removeListener(listener);
      if (outcome === null) resolve();
      else {
        void browser.downloads.cancel(id).catch(() => undefined);
        reject(outcome);
      }
    };
    const judge = (state: string | undefined, danger: string | undefined, error: string | undefined): void => {
      if (danger !== undefined && !SAFE.has(danger)) finish(new Error(`The browser flagged the file as unsafe (${danger}).`));
      else if (state === 'complete') finish(null);
      else if (state === 'interrupted') finish(new Error(`The browser stopped the download (${error ?? 'interrupted'}).`));
    };
    const listener = (delta: Browser.downloads.DownloadDelta): void => {
      if (delta.id === id) judge(delta.state?.current, delta.danger?.current, delta.error?.current);
    };
    const timer = setTimeout(() => finish(new Error('The download did not finish.')), DOWNLOAD_TIMEOUT_MS);
    browser.downloads.onChanged.addListener(listener);
    void browser.downloads.search({ id }).then(([item]) => {
      if (item !== undefined) judge(item.state, item.danger, item.error);
    });
  });
}

/** Writes one file under the download folder. Forgotten downloads leave chrome://downloads clean but can no longer be removed. */
async function downloadFile(path: string, data: Uint8Array, forget = true): Promise<number> {
  const id = await browser.downloads.download({
    url: `data:application/octet-stream;base64,${base64(data)}`,
    filename: path,
    conflictAction: 'overwrite',
    saveAs: false,
  });
  try {
    await settled(id);
    const [item] = await browser.downloads.search({ id });
    if (item === undefined || !item.filename.replaceAll('\\', '/').endsWith(`/${path}`)) throw new Error(`The browser saved ${path} somewhere else.`);
    return id;
  } finally {
    if (forget) await browser.downloads.erase({ id }).catch(() => undefined);
  }
}

async function quietDownloads<T>(run: () => Promise<T>): Promise<T> {
  await browser.downloads.setUiOptions({ enabled: false }).catch(() => undefined);
  try {
    return await run();
  } finally {
    await browser.downloads.setUiOptions({ enabled: true }).catch(() => undefined);
  }
}

/** Whether the downloads API reaches Geld's folder as `<download folder>/<folder>`. */
export async function downloadsReach(folder: string): Promise<boolean> {
  if (browser.downloads === undefined) return false;
  const token = crypto.randomUUID();
  return quietDownloads(async () => {
    let id: number;
    try {
      id = await downloadFile(`${folder}/${PROBE_FILE}`, new TextEncoder().encode(token), false);
    } catch {
      return false;
    }
    try {
      return (await readOwnFile(PROBE_FILE))?.trim() === token;
    } finally {
      await browser.downloads.removeFile(id).catch(() => undefined);
      await browser.downloads.erase({ id }).catch(() => undefined);
    }
  });
}

/** Files the new build dropped are left in place: the downloads API can only remove files it still lists. */
export async function writeWithDownloads(folder: string, entries: readonly ZipEntry[]): Promise<void> {
  await quietDownloads(async () => {
    const queue = [...entries];
    const worker = async (): Promise<void> => {
      for (let entry = queue.shift(); entry !== undefined; entry = queue.shift()) {
        await downloadFile(`${folder}/${entry.path}`, entry.data);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  });
}
