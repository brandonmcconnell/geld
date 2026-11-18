import { categoryById } from '@geld/core';
import { describe, expect, it } from 'vitest';
import { buildBreakdown, filesCountedLike, hiddenLabel, hiddenNounPlural } from './breakdown';

const tests = categoryById('tests');
const generated = categoryById('generated');

describe('hidden wording', () => {
  it('names the single present category even when several are enabled', () => {
    const breakdown = buildBreakdown([
      { path: 'dist/a.js', category: generated, stats: { additions: 3, deletions: 1 } },
      { path: 'dist/b.js', category: generated, stats: { additions: 3, deletions: 1 } },
      { path: 'src/c.ts', category: null, stats: { additions: 1, deletions: 0 } },
    ]);
    expect(hiddenLabel(breakdown, [tests, generated])).toBe('2 generated');
    expect(hiddenNounPlural([tests, generated], breakdown)).toBe(generated.nounPlural);
  });

  it('says "hidden" when more than one category is present', () => {
    const breakdown = buildBreakdown([
      { path: 'dist/a.js', category: generated, stats: { additions: 3, deletions: 1 } },
      { path: 'src/c.test.ts', category: tests, stats: { additions: 1, deletions: 0 } },
    ]);
    expect(hiddenLabel(breakdown, [tests, generated])).toBe('2 hidden');
    expect(hiddenNounPlural([tests, generated], breakdown)).toBe('hidden files');
  });

  it('keeps the single enabled category when nothing is hidden yet', () => {
    expect(hiddenLabel(buildBreakdown([]), [tests])).toBe('0 tests');
    expect(hiddenLabel(buildBreakdown([]), [tests, generated])).toBe('0 hidden');
  });
});

describe('filesCountedLike', () => {
  // A workflow edit and a re-indented test config: GitHub hiding whitespace counts +18 −11, the raw diff +28 −21.
  const files = [
    { path: '.github/workflows/e2e.yml', additions: 6, deletions: 5 },
    { path: 'apps/web/playwright.config.ts', additions: 22, deletions: 16, ignoringWhitespace: { additions: 12, deletions: 6 } },
  ];

  it('reads the files with whitespace ignored when GitHub\u2019s totals do', () => {
    expect(filesCountedLike(files, { files: 2, additions: 18, deletions: 11 }).map((file) => [file.additions, file.deletions])).toEqual([[6, 5], [12, 6]]);
  });

  it('keeps the raw counts when GitHub\u2019s totals are raw, or not known', () => {
    expect(filesCountedLike(files, { files: 2, additions: 28, deletions: 21 })).toBe(files);
    expect(filesCountedLike(files, null)).toBe(files);
  });

  it('takes the nearer reading when neither adds up exactly', () => {
    expect(filesCountedLike(files, { files: 2, additions: 19, deletions: 11 })[1]?.additions).toBe(12);
    expect(filesCountedLike(files, { files: 2, additions: 27, deletions: 21 })[1]?.additions).toBe(22);
  });
});
