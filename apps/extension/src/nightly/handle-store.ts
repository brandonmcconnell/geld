/** The folder handle the nightly page connected, kept in IndexedDB: extension storage cannot hold a handle. */

const DB = 'geld-nightly';
const STORE = 'handles';
const KEY = 'folder';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
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

export async function loadFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await open();
  try {
    const value: unknown = await settle(db.transaction(STORE).objectStore(STORE).get(KEY));
    return value instanceof FileSystemDirectoryHandle ? value : null;
  } finally {
    db.close();
  }
}

export async function saveFolderHandle(handle: FileSystemDirectoryHandle | null): Promise<void> {
  const db = await open();
  try {
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    if (handle === null) await settle(store.delete(KEY));
    else await settle(store.put(handle, KEY));
  } finally {
    db.close();
  }
}
