import {
  addTotals,
  type ChangeKindId,
  type ChangeTotals,
  EMPTY_TOTALS,
  type PathMatcher,
  pluralize,
} from "@geld/core";

export type SignalFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
};

export type HiddenSignal = {
  id: string;
  title: string;
  noun: string;
  nounPlural: string;
  totals: ChangeTotals;
};

export type PullSignals = {
  total: ChangeTotals;
  essential: ChangeTotals;
  hidden: HiddenSignal[];
  /** The pull request has more files than were read, so the split is of the files read. */
  partial: boolean;
};

function kindsOf(file: SignalFile): ChangeKindId[] {
  if (file.status === "removed") return ["deleted"];
  if (file.status === "renamed" && file.additions + file.deletions === 0) {
    return ["renames"];
  }
  return [];
}

export function pullSignalsFrom(
  files: readonly SignalFile[],
  matcher: PathMatcher,
  partial = false
): PullSignals {
  let total = EMPTY_TOTALS;
  let essential = EMPTY_TOTALS;
  const hidden = new Map<string, HiddenSignal>();
  for (const file of files) {
    const totals = {
      files: 1,
      additions: file.additions,
      deletions: file.deletions,
    };
    total = addTotals(total, totals);
    const category = matcher.categorizeFile({
      path: file.filename,
      additions: file.additions,
      deletions: file.deletions,
      kinds: kindsOf(file),
    });
    if (category === null) {
      essential = addTotals(essential, totals);
      continue;
    }
    const entry = hidden.get(category.id);
    hidden.set(category.id, {
      id: category.id,
      title: category.title,
      noun: category.shortNoun,
      nounPlural: category.shortNounPlural,
      totals: addTotals(entry?.totals ?? EMPTY_TOTALS, totals),
    });
  }
  const order: string[] = matcher.activeCategories.map(
    (category) => category.id
  );
  return {
    total,
    essential,
    hidden: [...hidden.values()].sort(
      (a, b) => order.indexOf(a.id) - order.indexOf(b.id)
    ),
    partial,
  };
}

export function hiddenTotals(signals: PullSignals): ChangeTotals {
  return signals.hidden.reduce(
    (sum, entry) => addTotals(sum, entry.totals),
    EMPTY_TOTALS
  );
}

/** "6 tests" when one category holds every hidden file, otherwise "9 hidden". */
export function hiddenLabel(signals: PullSignals): string | null {
  const [only, ...rest] = signals.hidden;
  if (only === undefined) return null;
  if (rest.length === 0) {
    return pluralize(only.totals.files, only.noun, only.nounPlural);
  }
  return `${hiddenTotals(signals).files} hidden`;
}
