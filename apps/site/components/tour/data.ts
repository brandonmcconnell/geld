import type { ChangeTotals } from '@geld/core';
import { addTotals, EMPTY_TOTALS } from '@geld/core';

export interface TourFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

/** The tour's pull request, in GitHub's file order. Which file lands in which category is the real matcher's call. */
export const TOUR_FILES: readonly TourFile[] = [
  { path: '.github/workflows/ci.yml', additions: 3, deletions: 1 },
  { path: 'CHANGELOG.md', additions: 4, deletions: 0 },
  { path: 'README.md', additions: 3, deletions: 2 },
  { path: 'docs/button.mdx', additions: 22, deletions: 4 },
  { path: 'e2e/button.cy.ts', additions: 7, deletions: 3 },
  { path: 'pnpm-lock.yaml', additions: 212, deletions: 148 },
  { path: 'src/Button.test.tsx', additions: 38, deletions: 12 },
  { path: 'src/Button.tsx', additions: 18, deletions: 9 },
  { path: 'src/__snapshots__/Button.test.tsx.snap', additions: 6, deletions: 8 },
  { path: 'src/api/__generated__/schema.ts', additions: 64, deletions: 20 },
  { path: 'src/hooks/useToggle.test.ts', additions: 11, deletions: 5 },
  { path: 'src/hooks/useToggle.ts', additions: 8, deletions: 7 },
  { path: 'src/index.ts', additions: 2, deletions: 1 },
  { path: 'src/types.ts', additions: 5, deletions: 3 },
];

export function totalsOf(files: readonly TourFile[]): ChangeTotals {
  return files.reduce<ChangeTotals>((sum, file) => addTotals(sum, { files: 1, additions: file.additions, deletions: file.deletions }), EMPTY_TOTALS);
}
