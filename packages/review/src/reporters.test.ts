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

describe('check reporters catalog', () => {
  const read = (name: string, detailsUrl: string, description: string, conclusion = 'failure') => readCheckReport({ name, status: 'completed', conclusion, detailsUrl, description });

  it('reads Percy, Codecov, Snyk and Cypress statuses with their project or facet', () => {
    expect(read('percy/my-app', 'https://percy.io/org/my-app/builds/42', '4 visual changes need review')).toMatchObject({ reporter: 'percy', project: 'my-app', headline: '4 visual changes need review', state: 'failed' });
    expect(read('codecov/patch', 'https://app.codecov.io/gh/o/r/pull/1', '62.50% of diff hit (target 80.00%)')).toMatchObject({ reporter: 'codecov', project: 'patch', headline: '62.50% of diff hit (target 80.00%)' });
    expect(read('codecov/project/ui', 'https://codecov.io/gh/o/r', '80.12% (+0.03%) compared to abc1234', 'success')).toMatchObject({ reporter: 'codecov', project: 'project/ui', state: 'passed' });
    expect(read('security/snyk - package.json (acme)', 'https://app.snyk.io/org/acme/project/1', '2 new issues (1 high)')).toMatchObject({ reporter: 'snyk', project: 'package.json', headline: '2 new issues (1 high)' });
    expect(read('Cypress Cloud', 'https://cloud.cypress.io/projects/abc/runs/7', 'Failed: 2 • Passed: 41')).toMatchObject({ reporter: 'cypress', headline: 'Failed: 2 • Passed: 41' });
    expect(read('Cypress Cloud', 'https://cloud.cypress.io/projects/abc/runs/7', 'Failed: 2')?.project).toBeUndefined();
  });

  it('reads Sonar by host alone, Lighthouse CI only on its viewer path, and knows a GitHub Pages site is not Lighthouse', () => {
    expect(read('SonarCloud Code Analysis', 'https://sonarcloud.io/dashboard?id=x', 'Quality Gate failed')).toMatchObject({ reporter: 'sonar', title: 'Sonar', headline: 'Quality Gate failed' });
    expect(read('lhci/performance', 'https://googlechrome.github.io/lighthouse-ci/viewer/?jsonurl=…', 'Assertions failed')).toMatchObject({ reporter: 'lighthouse', project: 'performance' });
    expect(read('pages', 'https://googlechrome.github.io/samples/', 'Deployed')).toBeNull();
  });

  it('reads the visual services', () => {
    expect(read('argos', 'https://app.argos-ci.com/acme/web/builds/9', '3 changes, waiting for your decision')).toMatchObject({ reporter: 'argos', headline: '3 changes, waiting for your decision' });
    expect(read('happo/web', 'https://happo.io/a/1/compare/x', '2 diffs')).toMatchObject({ reporter: 'happo', project: 'web' });
    expect(read('Applitools', 'https://eyes.applitools.com/app/batches/1', '3 unresolved diffs')).toMatchObject({ reporter: 'applitools' });
    expect(read('lost-pixel', 'https://app.lost-pixel.com/app/project/1', '5 differences found')).toMatchObject({ reporter: 'lost-pixel' });
  });
});
