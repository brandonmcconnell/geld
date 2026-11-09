import type { ZipEntry } from '@geld/core/nightly';

/**
 * IndexedDB, for what extension storage cannot hold: the folder handle the nightly page connected, and a copy
 * of the build that was running before the last install, so a broken install can be put back after a reload.
 */

const DB = 'geld-nightly';
const HANDLES = 'handles';
const BACKUPS = 'backups';
const FOLDER = 'folder';
const PREVIOUS = 'previous';

export interface BuildBackup {
  readonly version: string;
  readonly files: readonly ZipEntry[];
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 2);
    request.onupgradeneeded = () => {
      for (const store of [HANDLES, BACKUPS]) {
        if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
  });
}

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

async function read(store: string, key: string): Promise<unknown> {
  const db = await open();
  try {
    return await settle(db.transaction(store).objectStore(store).get(key));
  } finally {
    db.close();
  }
}

async function write(store: string, key: string, value: unknown): Promise<void> {
  const db = await open();
  try {
    const objects = db.transaction(store, 'readwrite').objectStore(store);
    if (value === null) await settle(objects.delete(key));
    else await settle(objects.put(value, key));
  } finally {
    db.close();
  }
}

export async function loadFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
  const value = await read(HANDLES, FOLDER);
  return value instanceof FileSystemDirectoryHandle ? value : null;
}

export function saveFolderHandle(handle: FileSystemDirectoryHandle | null): Promise<void> {
  return write(HANDLES, FOLDER, handle);
}

function isEntryList(value: unknown): value is readonly ZipEntry[] {
  if (!Array.isArray(value)) return false;
  const list: readonly unknown[] = value;
  return list.every(isEntry);
}

function isEntry(value: unknown): value is ZipEntry {
  return typeof value === 'object' && value !== null && 'path' in value && typeof value.path === 'string' && 'data' in value && value.data instanceof Uint8Array;
}

export async function loadBackup(): Promise<BuildBackup | null> {
  const value = await read(BACKUPS, PREVIOUS);
  if (typeof value !== 'object' || value === null || !('version' in value) || !('files' in value)) return null;
  const { version, files } = value;
  if (typeof version !== 'string' || !isEntryList(files)) return null;
  return { version, files };
}

export function saveBackup(backup: BuildBackup | null): Promise<void> {
  return write(BACKUPS, PREVIOUS, backup === null ? null : { version: backup.version, files: backup.files.map((file) => ({ path: file.path, data: file.data })) });
}
