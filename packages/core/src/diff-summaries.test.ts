import { describe, expect, it } from 'vitest';
import { diffSummariesUrl, parseDiffSummaries } from './diff-summaries';

describe('parseDiffSummaries', () => {
  it('reads every file of the files tab payload as FileStats', () => {
    const document = {
      meta: { title: 'x' },
      payload: {
        pullRequestsChangesRoute: {
          diffSummaries: [
            { changeType: 'MODIFIED', linesAdded: 4, linesChanged: 7, linesDeleted: 3, path: 'docs/.vitepress/loaders/cli.data.ts', pathDigest: 'bc35' },
            { changeType: 'ADDED', linesAdded: 12, linesChanged: 12, linesDeleted: 0, path: 'src/new.ts', pathDigest: 'aa' },
            { changeType: 'DELETED', linesAdded: 0, linesChanged: 9, linesDeleted: 9, path: 'src/old.ts', pathDigest: 'bb' },
            { changeType: 'RENAMED', linesAdded: 0, linesChanged: 0, linesDeleted: 0, path: 'src/moved.ts', pathDigest: 'cc' },
            { changeType: 'RENAMED', linesAdded: 2, linesChanged: 3, linesDeleted: 1, path: 'src/moved-edited.ts', pathDigest: 'dd' },
            { path: '', linesAdded: 1 },
          ],
          diffContents: [{ path: 'docs/.vitepress/loaders/cli.data.ts', diffLines: [] }],
        },
      },
    };
    expect(parseDiffSummaries(document)).toEqual([
      { path: 'docs/.vitepress/loaders/cli.data.ts', additions: 4, deletions: 3, status: 'modified' },
      { path: 'src/new.ts', additions: 12, deletions: 0, status: 'added' },
      { path: 'src/old.ts', additions: 0, deletions: 9, status: 'deleted', kinds: ['deleted'] },
      { path: 'src/moved.ts', additions: 0, deletions: 0, status: 'renamed', kinds: ['renames'] },
      { path: 'src/moved-edited.ts', additions: 2, deletions: 1, status: 'renamed' },
    ]);
  });

  it('answers null for anything that is not that document', () => {
    expect(parseDiffSummaries(null)).toBeNull();
    expect(parseDiffSummaries({ payload: { somethingElse: [] } })).toBeNull();
    expect(parseDiffSummaries('<!DOCTYPE html>')).toBeNull();
  });

  it('knows the files tab URL only for a pull request diff', () => {
    expect(diffSummariesUrl('https://github.com/wxt-dev/wxt/pull/2544.diff')).toBe('https://github.com/wxt-dev/wxt/pull/2544/changes?_json=1');
    expect(diffSummariesUrl('https://ghe.example.com/org/repo/pull/7.diff')).toBe('https://ghe.example.com/org/repo/pull/7/changes?_json=1');
    expect(diffSummariesUrl('https://github.com/wxt-dev/wxt/commit/d05ac55ba78b7d01c5ab9feb0e862775e45509ef.diff')).toBeNull();
  });
});
