import { describe, expect, it } from "vitest";
import { defaultFileCategory } from "./file-category";

describe("defaultFileCategory", () => {
  it("names the category of a test file", () => {
    expect(defaultFileCategory("src/__tests__/sse.test.ts")).toBe("Tests");
  });

  it("leaves source files to review", () => {
    expect(defaultFileCategory("src/transport/sse.ts")).toBeNull();
    expect(defaultFileCategory("pnpm-lock.yaml")).toBeNull();
  });
});
