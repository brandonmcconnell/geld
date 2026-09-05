import { parseLineStats } from './dom';
import { replaceCount } from './header-stats';
import { describePage } from './page';

describe('replaceCount', () => {
  it('replaces bare counters', () => {
    expect(replaceCount('18', 12)).toBe('12');
    expect(replaceCount('\u00a0(18)', 1234)).toBe('\u00a0(1,234)');
  });

  it('keeps sentences and fixes plurals', () => {
    expect(replaceCount('18 files changed', 12)).toBe('12 files changed');
    expect(replaceCount('18 files changed', 1)).toBe('1 file changed');
    expect(replaceCount('1 file changed', 0)).toBe('0 files changed');
    expect(replaceCount('18 changed files', 3)).toBe('3 changed files');
    expect(replaceCount('93 additions', 1)).toBe('1 addition');
    expect(replaceCount('1 deletion', 26)).toBe('26 deletions');
  });
});

describe('parseLineStats', () => {
  it('reads every GitHub phrasing', () => {
    expect(parseLineStats('15 changes: 8 additions & 7 deletions')).toEqual({ additions: 8, deletions: 7 });
    expect(parseLineStats('Lines changed: 1 addition & 0 deletions')).toEqual({ additions: 1, deletions: 0 });
    expect(parseLineStats('Showing 18 changed files with 1,093 additions and 53 deletions.')).toEqual({
      additions: 1093,
      deletions: 53,
    });
    expect(parseLineStats('BIN +1.2 KB')).toBeNull();
    expect(parseLineStats(null)).toBeNull();
  });
});

describe('describePage', () => {
  it('recognises pull request tabs', () => {
    const files = describePage(new URL('https://github.com/wxt-dev/wxt/pull/2544/files'));
    expect(files.kind).toBe('pull-files');
    expect(files.diffUrl).toBe('https://github.com/wxt-dev/wxt/pull/2544.diff');
    expect(files.stateKey).toBe('/wxt-dev/wxt/pull/2544');

    expect(describePage(new URL('https://github.com/wxt-dev/wxt/pull/2544')).kind).toBe('pull-conversation');
    expect(describePage(new URL('https://github.com/wxt-dev/wxt/pull/2544/commits')).kind).toBe('pull-other');
    expect(describePage(new URL('https://github.com/wxt-dev/wxt/pull/2544/files/abc123')).kind).toBe('pull-files');
  });

  it('recognises commits and compares', () => {
    const commit = describePage(new URL('https://github.com/o/r/commit/d05ac55ba78b7d01c5ab9feb0e862775e45509ef'));
    expect(commit.kind).toBe('commit');
    expect(commit.diffUrl).toBe('https://github.com/o/r/commit/d05ac55ba78b7d01c5ab9feb0e862775e45509ef.diff');

    const compare = describePage(new URL('https://github.com/o/r/compare/main...feature?expand=1'));
    expect(compare.kind).toBe('compare');
    expect(compare.diffUrl).toBe('https://github.com/o/r/compare/main...feature.diff');
  });

  it('ignores unrelated pages', () => {
    const other = describePage(new URL('https://github.com/o/r/issues/1'));
    expect(other.kind).toBe('other');
    expect(other.diffUrl).toBeNull();
  });
});
