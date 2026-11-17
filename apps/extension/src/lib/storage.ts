import { storage } from 'wxt/utils/storage';
import type { GeldSettings } from '@geld/core';
import { DEFAULT_SETTINGS, normalizeSettings, SETTINGS_STORAGE_KEY } from '@geld/core';

/**
 * The single persisted settings object. Values are validated on the way out so
 * a corrupted or outdated payload never crashes the extension.
 */
const rawSettingsItem = storage.defineItem<GeldSettings>(SETTINGS_STORAGE_KEY, {
  fallback: DEFAULT_SETTINGS,
  version: 1,
});

/** Writes are serialised so two quick toggles cannot overwrite each other. */
let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * The queue above is one page's: the popup, the options page and the background each have their own, and each write
 * reads and writes the whole settings object, so a write from one page landing between another's read and write was
 * lost (the privacy answer, say, put back unanswered). A Web Lock, shared by every page of the extension's origin,
 * holds the whole read and write.
 */
function locked<T>(task: () => Promise<T>): Promise<T> {
  // Some environments (happy-dom among them) name `locks` but leave it null.
  const locks: LockManager | null | undefined = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (locks === null || locks === undefined) return task();
  // The DOM typings give `request` the callback's own return type, a promise, though the lock resolves it.
  return locks.request('geld:settings', task).then((result) => result);
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const held = (): Promise<T> => locked(task);
  const run = writeQueue.then(held, held);
  writeQueue = run.catch(() => undefined);
  return run;
}

export const settingsItem = {
  async getValue(): Promise<GeldSettings> {
    return normalizeSettings(await rawSettingsItem.getValue());
  },
  setValue(settings: GeldSettings): Promise<void> {
    return enqueue(() => rawSettingsItem.setValue(normalizeSettings(settings)));
  },
  /** Shallow-merge `changes` onto the stored value (read and write happen atomically relative to other calls). */
  patch(changes: Partial<GeldSettings>): Promise<GeldSettings> {
    return this.update(() => changes);
  },
  /** Compute changes from the freshest stored value; use for nested maps like `categories`. */
  update(updater: (current: GeldSettings) => Partial<GeldSettings>): Promise<GeldSettings> {
    return enqueue(async () => {
      const current = normalizeSettings(await rawSettingsItem.getValue());
      const next = normalizeSettings({ ...current, ...updater(current) });
      await rawSettingsItem.setValue(next);
      return next;
    });
  },
  watch(callback: (settings: GeldSettings) => void): () => void {
    return rawSettingsItem.watch((value) => callback(normalizeSettings(value)));
  },
};
