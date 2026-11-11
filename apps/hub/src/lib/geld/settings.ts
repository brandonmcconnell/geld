import { DEFAULT_SETTINGS, type GeldSettings } from "@geld/core/settings";
import { validateSettingsDocument } from "@geld/core/settings-validate";

export type ReaderSettings = {
  settings: GeldSettings;
  /** The saved settings could not be read as Geld's, so the defaults stand in. */
  invalid: boolean;
};

/** What a saved settings value means: empty is "never set", anything unreadable falls back to the defaults. */
export function readerSettingsFrom(saved: unknown): ReaderSettings {
  if (
    typeof saved !== "object" ||
    saved === null ||
    Object.keys(saved).length === 0
  ) {
    return { settings: DEFAULT_SETTINGS, invalid: false };
  }
  const validated = validateSettingsDocument(JSON.stringify(saved));
  return validated.ok
    ? { settings: validated.settings, invalid: false }
    : { settings: DEFAULT_SETTINGS, invalid: true };
}
