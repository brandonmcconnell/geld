import { describe, expect, it } from 'vitest';
import { hiddenFilesLabel, type QueueInsight } from './queue-insight';
function counts(files: number, categories: QueueInsight['categories']): QueueInsight {
  return {
    headSha: 'head',
    essential: { files: 1, additions: 1, deletions: 0 },
    hidden: { files, additions: 1, deletions: 0 },
    categories,
    requesters: null,
  };
}
const tests = { id: 'tests', label: 'Tests', files: 1, additions: 1, deletions: 0 };
describe('hidden file labels', () => {
  it('matches extension singular, plural, mixed and custom category nouns', () => {
    expect(hiddenFilesLabel(counts(1, [tests]))).toBe('1 test');
    expect(hiddenFilesLabel(counts(2, [{ ...tests, files: 2 }]))).toBe('2 tests');
    expect(hiddenFilesLabel(counts(2, [tests, { ...tests, id: 'docs' }]))).toBe('2 hidden');
    expect(
      hiddenFilesLabel(counts(2, [{ ...tests, id: 'custom', shortNoun: 'snapshot', shortNounPlural: 'snapshots' }])),
    ).toBe('2 snapshots');
    expect(hiddenFilesLabel(counts(2, [{ ...tests, id: 'unknown' }]))).toBe('2 hidden');
  });
});
