import { describe, expect, it } from 'vitest';
import { latestReports, readCheckReport, readReport, reportsFrom, reportsFromChecks, reportsHealth } from './reporters';

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

describe('check reporters', () => {
  it('reads a Chromatic status by its Details host, with the project and GitHub words as the headline', () => {
    const report = readCheckReport({ name: 'UI Tests: mint', status: 'completed', conclusion: 'failure', detailsUrl: 'https://www.chromatic.com/test?appId=1&id=2', description: '— Failed test' });
    expect(report).toMatchObject({ reporter: 'chromatic', title: 'Chromatic', project: 'mint', state: 'failed', headline: 'Failed test', url: 'https://www.chromatic.com/test?appId=1&id=2', anchor: 'check:UI Tests: mint' });
  });

  it('skips a skipped build, a check without details, and a GitHub Actions job named Chromatic', () => {
    expect(readCheckReport({ name: 'UI Tests: widget', status: 'completed', conclusion: 'skipped', detailsUrl: 'https://www.chromatic.com/build?x', description: '— Skipped build.' })).toBeNull();
    expect(readCheckReport({ name: 'UI Tests: widget', status: 'completed', conclusion: 'failure' })).toBeNull();
    expect(readCheckReport({ name: 'Chromatic Client / chromatic-client (pull_request)', status: 'completed', conclusion: 'failure', detailsUrl: 'https://github.com/o/r/actions/runs/1/job/2', description: 'Failing after 6m' })).toBeNull();
    expect(readCheckReport({ name: 'Storybook Publish: mint', status: 'completed', conclusion: 'success', detailsUrl: 'https://www.chromatic.com/build?id=3', description: '— 624 stories published' })).toBeNull();
  });

  it('keeps one report per reporter and project', () => {
    const all = reportsFromChecks([
      { name: 'UI Tests: mint', status: 'completed', conclusion: 'failure', detailsUrl: 'https://www.chromatic.com/test?id=1', description: '— Failed test' },
      { name: 'UI Tests: widget', status: 'completed', conclusion: 'success', detailsUrl: 'https://www.chromatic.com/build?id=2', description: '— Passed' },
    ]);
    expect(latestReports(all).latest.map((entry) => `${entry.project}:${entry.state}:${entry.headline}`)).toEqual(['mint:failed:Failed test', 'widget:passed:Passed']);
  });
});
