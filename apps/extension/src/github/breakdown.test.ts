import { categoryById } from '@geld/core';
import { describe, expect, it } from 'vitest';
import { buildBreakdown, hiddenLabel, hiddenNounPlural } from './breakdown';

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
