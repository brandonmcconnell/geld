import { createMatcher, DEFAULT_SETTINGS } from "@geld/core";
import { describe, expect, it } from "vitest";
import { hiddenLabel, pullSignalsFrom, type SignalFile } from "./pull-signals";

function file(
  filename: string,
  additions: number,
  deletions: number,
  status = "modified"
): SignalFile {
  return { filename, status, additions, deletions };
}

const defaults = createMatcher(DEFAULT_SETTINGS, "acme/app");

describe("pullSignalsFrom", () => {
  it("splits the lines between what is left to review and tests", () => {
    const signals = pullSignalsFrom(
      [
        file("src/queue.ts", 40, 12),
        file("src/queue.test.ts", 120, 3),
        file("e2e/queue.spec.ts", 30, 0),
      ],
      defaults
    );
    expect(signals.total).toEqual({ files: 3, additions: 190, deletions: 15 });
    expect(signals.essential).toEqual({
      files: 1,
      additions: 40,
      deletions: 12,
    });
    expect(signals.hidden).toHaveLength(1);
    expect(signals.hidden[0]?.id).toBe("tests");
    expect(signals.hidden[0]?.totals).toEqual({
      files: 2,
      additions: 150,
      deletions: 3,
    });
    expect(hiddenLabel(signals)).toBe("2 tests");
  });

  it("has no label when nothing is set aside", () => {
    const signals = pullSignalsFrom([file("src/queue.ts", 1, 1)], defaults);
    expect(signals.hidden).toEqual([]);
    expect(hiddenLabel(signals)).toBeNull();
  });

  it("names no single category when several hide files", () => {
    const matcher = createMatcher(
      {
        ...DEFAULT_SETTINGS,
        categories: { ...DEFAULT_SETTINGS.categories, generated: true },
      },
      "acme/app"
    );
    const signals = pullSignalsFrom(
      [
        file("src/a.test.ts", 5, 0),
        file("pnpm-lock.yaml", 300, 280),
        file("src/a.ts", 2, 1),
      ],
      matcher
    );
    expect(signals.hidden.map((entry) => entry.id)).toEqual([
      "tests",
      "generated",
    ]);
    expect(hiddenLabel(signals)).toBe("2 hidden");
  });

  it("weighs a deleted file as a change kind when that category is on", () => {
    const matcher = createMatcher(
      {
        ...DEFAULT_SETTINGS,
        categories: { ...DEFAULT_SETTINGS.categories, trivial: true },
      },
      "acme/app"
    );
    const signals = pullSignalsFrom(
      [file("src/old.ts", 0, 80, "removed"), file("src/new.ts", 60, 0)],
      matcher
    );
    expect(signals.essential.files).toBe(1);
    expect(signals.hidden[0]?.id).toBe("trivial");
  });

  it("carries the partial mark", () => {
    expect(pullSignalsFrom([], defaults, true).partial).toBe(true);
  });
});
