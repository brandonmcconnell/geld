import { storage } from 'wxt/utils/storage';
import type { GeldSettings } from './settings';
import { DEFAULT_SETTINGS, normalizeSettings, SETTINGS_STORAGE_KEY } from './settings';

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

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
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
