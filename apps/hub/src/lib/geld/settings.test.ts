import { DEFAULT_SETTINGS } from "@geld/core/settings";
import { describe, expect, it } from "vitest";
import { readerSettingsFrom } from "./settings";

describe("readerSettingsFrom", () => {
  it("takes the defaults for an account that never saved any", () => {
    expect(readerSettingsFrom({})).toEqual({
      settings: DEFAULT_SETTINGS,
      invalid: false,
    });
    expect(readerSettingsFrom(null).settings).toBe(DEFAULT_SETTINGS);
  });

  it("reads saved categories", () => {
    const read = readerSettingsFrom({
      ...DEFAULT_SETTINGS,
      categories: { tests: false, generated: true },
    });
    expect(read.invalid).toBe(false);
    expect(read.settings.categories.generated).toBe(true);
    expect(read.settings.categories.tests).toBe(false);
  });

  it("falls back to the defaults and says so when the saved value is not Geld's", () => {
    const read = readerSettingsFrom({ categories: { tests: "yes" } });
    expect(read).toEqual({ settings: DEFAULT_SETTINGS, invalid: true });
  });
});
