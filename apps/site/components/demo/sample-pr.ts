import type { ChangeTotals, HiddenCategory } from '@geld/core';
import { addTotals, createMatcher, DEFAULT_SETTINGS, EMPTY_TOTALS, subtractTotals } from '@geld/core';

/**
 * The pull request drawn on the home page. Which files count as tests is
 * decided by the real matcher with default settings, so the picture can never
 * disagree with the extension.
 */
export interface SampleFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

export interface ClassifiedFile extends SampleFile {
  readonly category: HiddenCategory | null;
}

const FILES: readonly SampleFile[] = [
  { path: 'e2e/button.cy.ts', additions: 7, deletions: 3 },
  { path: 'README.md', additions: 3, deletions: 2 },
  { path: 'src/Button.css', additions: 6, deletions: 4 },
  { path: 'src/Button.test.tsx', additions: 14, deletions: 6 },
  { path: 'src/Button.tsx', additions: 18, deletions: 9 },
  { path: 'src/__snapshots__/Button.test.tsx.snap', additions: 6, deletions: 8 },
  { path: 'src/__tests__/Button.a11y.test.tsx', additions: 9, deletions: 4 },
  { path: 'src/hooks/useToggle.test.ts', additions: 11, deletions: 5 },
  { path: 'src/hooks/useToggle.ts', additions: 8, deletions: 7 },
  { path: 'src/index.ts', additions: 2, deletions: 1 },
  { path: 'src/types.ts', additions: 5, deletions: 3 },
  { path: 'vitest.config.ts', additions: 4, deletions: 1 },
];

const matcher = createMatcher(DEFAULT_SETTINGS);

export const SAMPLE_FILES: readonly ClassifiedFile[] = FILES.map((file) => ({ ...file, category: matcher.categorize(file.path) }));

export const VISIBLE_FILES: readonly ClassifiedFile[] = SAMPLE_FILES.filter((file) => file.category === null);
export const HIDDEN_FILES: readonly ClassifiedFile[] = SAMPLE_FILES.filter((file) => file.category !== null);

function totalsOf(files: readonly ClassifiedFile[]): ChangeTotals {
  return files.reduce<ChangeTotals>((sum, file) => addTotals(sum, { files: 1, additions: file.additions, deletions: file.deletions }), EMPTY_TOTALS);
}

export const ALL_TOTALS: ChangeTotals = totalsOf(SAMPLE_FILES);
export const HIDDEN_TOTALS: ChangeTotals = totalsOf(HIDDEN_FILES);
export const VISIBLE_TOTALS: ChangeTotals = subtractTotals(ALL_TOTALS, HIDDEN_TOTALS);

/** Split a path into directory prefix and basename for GitHub-style rendering. */
export function splitPath(path: string): { readonly directory: string; readonly basename: string } {
  const index = path.lastIndexOf('/');
  if (index === -1) return { directory: '', basename: path };
  return { directory: path.slice(0, index + 1), basename: path.slice(index + 1) };
}
