import { describe, expect, it } from 'vitest';
import { latestReports, readReport, reportsFrom, reportsHealth } from './reporters';

describe('reporters', () => {
  it('reads Blacksmith test failures as a failed report with the count', () => {
    const report = readReport({ author: 'blacksmith-sh[bot]', body: 'Found 2 test failures on Blacksmith runners:\n\n| Test | View Logs |', anchor: 'issuecomment-1' });
    expect(report).toMatchObject({ reporter: 'blacksmith', title: 'Blacksmith', state: 'failed', headline: '2 test failures', count: 2, anchor: 'issuecomment-1' });
  });

  it('reads one failure in the singular', () => {
    expect(readReport({ author: 'blacksmith-sh[bot]', body: 'Found 1 test failure on Blacksmith runners:', anchor: 'c' })?.headline).toBe('1 test failure');
  });

  it('ignores a reporter comment that is not a report, and every other author', () => {
    expect(readReport({ author: 'blacksmith-sh[bot]', body: 'Thanks for the feedback!', anchor: 'c' })).toBeNull();
    expect(readReport({ author: 'cursor[bot]', body: 'Found 2 test failures', anchor: 'c' })).toBeNull();
  });

  it('keeps the latest report per reporter and archives the earlier ones', () => {
    const all = reportsFrom([
      { author: 'blacksmith-sh[bot]', body: 'Found 3 test failures on Blacksmith runners:', anchor: 'a' },
      { author: 'someone', body: 'Found 9 test failures', anchor: 'b' },
      { author: 'blacksmith-sh[bot]', body: 'Found 1 test failure on Blacksmith runners:', anchor: 'c' },
    ]);
    expect(all.map((entry) => entry.anchor)).toEqual(['a', 'c']);
    const { latest, archived } = latestReports(all);
    expect(latest.map((entry) => entry.anchor)).toEqual(['c']);
    expect(archived.map((entry) => entry.anchor)).toEqual(['a']);
    expect(reportsHealth(latest)).toBe('bad');
  });
});
