import { createMatcher } from "@geld/core/matcher";
import { DEFAULT_SETTINGS } from "@geld/core/settings";
import { describe, expect, it } from "vitest";
import { nextInGuide, reviewGuide } from "./review-guide";

const matcher = createMatcher(DEFAULT_SETTINGS);
const file = (filename: string, additions = 1, deletions = 0) => ({
  filename,
  status: "modified",
  additions,
  deletions,
});

describe("reviewGuide", () => {
  const steps = reviewGuide(
    [
      file("src/__tests__/sse.test.ts", 40),
      file("README.md", 2),
      file("src/transport/small.ts", 3),
      file("src/transport/sse.ts", 30, 12),
      file("src/types.ts", 5),
    ],
    matcher
  );

  it("reads contracts, then the change, then docs, then what is set aside", () => {
    expect(steps.map((step) => step.id)).toEqual([
      "contracts",
      "changes",
      "docs",
      "aside:tests",
    ]);
    expect(steps.map((step) => step.skim)).toEqual([false, false, false, true]);
  });

  it("puts the largest file of a step first", () => {
    expect(steps[1]?.files.map((entry) => entry.path)).toEqual([
      "src/transport/sse.ts",
      "src/transport/small.ts",
    ]);
  });

  it("leaves out steps with no files", () => {
    expect(
      reviewGuide([file("src/a.ts")], matcher).map((step) => step.id)
    ).toEqual(["changes"]);
  });

  it("names the next file not yet viewed, in guide order", () => {
    expect(nextInGuide(steps, () => false)).toBe("src/types.ts");
    expect(nextInGuide(steps, (path) => path === "src/types.ts")).toBe(
      "src/transport/sse.ts"
    );
    expect(nextInGuide(steps, () => true)).toBeNull();
  });
});
