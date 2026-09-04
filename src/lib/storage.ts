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

export const settingsItem = {
  async getValue(): Promise<GeldSettings> {
    return normalizeSettings(await rawSettingsItem.getValue());
  },
  async setValue(settings: GeldSettings): Promise<void> {
    await rawSettingsItem.setValue(normalizeSettings(settings));
  },
  async patch(changes: Partial<GeldSettings>): Promise<GeldSettings> {
    const next = normalizeSettings({ ...(await this.getValue()), ...changes });
    await rawSettingsItem.setValue(next);
    return next;
  },
  watch(callback: (settings: GeldSettings) => void): () => void {
    return rawSettingsItem.watch((value) => callback(normalizeSettings(value)));
  },
};
