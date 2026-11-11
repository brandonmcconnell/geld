import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@geld/core/settings";
import { fileCategory, setReaderSettings } from "./file-category";

describe("fileCategory", () => {
  it("names the category of a test file", () => {
    expect(fileCategory("src/__tests__/sse.test.ts")).toBe("Tests");
  });

  it("leaves source files to review", () => {
    expect(fileCategory("src/transport/sse.ts")).toBeNull();
    expect(fileCategory("pnpm-lock.yaml")).toBeNull();
  });

  it("follows the reader's settings once they are set", () => {
    setReaderSettings({
      ...DEFAULT_SETTINGS,
      categories: { ...DEFAULT_SETTINGS.categories, generated: true },
    });
    expect(fileCategory("pnpm-lock.yaml")).toBe("Generated");
    setReaderSettings(DEFAULT_SETTINGS);
    expect(fileCategory("pnpm-lock.yaml")).toBeNull();
  });
});
