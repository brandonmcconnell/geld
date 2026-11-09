const numberFormatter = new Intl.NumberFormat('en-US');

/**
 * A count as GitHub prints it, which follows the reader's browser locale: `1234`, `1,234`, `1.234`, `1 234` with a
 * no-break space, `1’234` or `1,23,456`. A regular expression source, to build into a pattern.
 */
export const COUNT_PATTERN = String.raw`\d+(?:[.,'’\u00a0\u202f]\d{2,3})*`;

const GROUP_SEPARATOR = /\d([.,'’\u00a0\u202f])\d{2,3}(?!\d)/;

/** Format like GitHub does: `1,234`. */
export function formatCount(value: number): string {
  return numberFormatter.format(Math.max(0, value));
}

/** {@link formatCount}, grouped as `original`, a count GitHub printed, is grouped: 3776 like `+8.270` is `3.776`. */
export function formatCountLike(original: string, value: number): string {
  const separator = GROUP_SEPARATOR.exec(original)?.[1];
  return separator === undefined ? formatCount(value) : formatCount(value).replace(/,/g, separator);
}

/** Parse a GitHub-formatted count such as `+1,234`, `+1.234`, `−53` or `18`. */
export function parseCount(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const digits = text.replace(/[^\d]/g, '');
  if (digits === '') return null;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? value : null;
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

/** Aggregate additions/deletions/file count. */
export interface ChangeTotals {
  readonly files: number;
  readonly additions: number;
  readonly deletions: number;
}

export const EMPTY_TOTALS: ChangeTotals = { files: 0, additions: 0, deletions: 0 };

export function addTotals(a: ChangeTotals, b: ChangeTotals): ChangeTotals {
  return {
    files: a.files + b.files,
    additions: a.additions + b.additions,
    deletions: a.deletions + b.deletions,
  };
}

export function subtractTotals(a: ChangeTotals, b: ChangeTotals): ChangeTotals {
  return {
    files: Math.max(0, a.files - b.files),
    additions: Math.max(0, a.additions - b.additions),
    deletions: Math.max(0, a.deletions - b.deletions),
  };
}

/** `+93 −53` style summary, using GitHub's typographic minus. */
export function formatDiffstat(totals: ChangeTotals): string {
  return `+${formatCount(totals.additions)} \u2212${formatCount(totals.deletions)}`;
}
