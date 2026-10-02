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

describe('report short forms', () => {
  const short = (name: string, detailsUrl: string, description: string, conclusion = 'failure') => readCheckReport({ name, status: 'completed', conclusion, detailsUrl, description })?.short;

  it('keeps the numbers and drops the sentence', () => {
    expect(short('percy/app', 'https://percy.io/o/app/builds/1', '4 visual changes need review')).toEqual([{ text: '4 changes' }]);
    expect(short('UI Tests: mint', 'https://www.chromatic.com/test?id=1', '— 3 changes must be accepted')).toEqual([{ text: '3 changes' }]);
    expect(short('UI Tests: mint', 'https://www.chromatic.com/build?appId=1&number=2', 'Waiting for status to be reported — 1 visual and accessibility change must be accepted as baseline', 'pending')).toEqual([{ text: '1 change' }]);
    expect(short('codecov/patch', 'https://codecov.io/gh/o/r', '62.50% of diff hit (target 80.00%)')).toEqual([{ text: '62.50%' }]);
    expect(short('codecov/project', 'https://codecov.io/gh/o/r', '80.12% (+0.03%) compared to abc1234', 'success')).toEqual([{ text: '80.12% (+0.03%)' }]);
    expect(short('happo', 'https://happo.io/a/1', '2 diffs')).toEqual([{ text: '2 diffs' }]);
  });

  it('shows counts of several kinds with their own glyphs', () => {
    expect(short('Cypress Cloud', 'https://cloud.cypress.io/p/1', 'Failed: 2 • Passed: 41 • Pending: 0 • Skipped: 1')).toEqual([
      { text: '2', glyph: 'x', tone: 'bad' },
      { text: '41', glyph: 'check', tone: 'good' },
    ]);
    expect(short('security/snyk - package.json', 'https://snyk.io/p/1', '2 new issues (1 high, 1 medium)')).toEqual([{ text: '2 issues' }, { text: '1', glyph: 'dot', tone: 'bad' }]);
  });

  it('says nothing beside the light when the words are only a verdict', () => {
    expect(short('SonarCloud Code Analysis', 'https://sonarcloud.io/d?id=x', 'Quality Gate failed')).toEqual([]);
    expect(short('UI Tests: mint', 'https://www.chromatic.com/test?id=1', '— Failed test')).toEqual([]);
    expect(short('UI Tests: mint', 'https://www.chromatic.com/test?id=1', '— 411 tests unchanged', 'success')).toEqual([]);
    expect(short('security/snyk - package.json', 'https://snyk.io/p/1', 'No new issues', 'success')).toEqual([]);
    expect(readReport({ author: 'blacksmith-sh[bot]', body: 'Found 2 test failures on Blacksmith runners:', anchor: 'c' })?.short).toEqual([{ text: '2 failures' }]);
  });
});

describe('security reporters', () => {
  const socketAlerts = `> [!CAUTION]
> **Review the following alerts detected in dependencies.**
<table><thead><tr><th>Action</th><th>Severity</th><th>Alert</th></tr></thead>
<tbody>
<tr><td valign="top"><strong>Block</strong></td><td>Medium</td><td><details open><summary><strong>Recently published</strong>: github brave/pull-merge</summary></details></td></tr>
<tr><td valign="top"><strong>Warn</strong></td><td>Low</td><td><details><summary><strong>New author</strong>: npm/left-pad</summary></details></td></tr>
</tbody></table>`;

  it('reads Socket alerts, the resolved notice and the dependency overview', () => {
    expect(readReport({ author: 'socket-security[bot]', body: socketAlerts, anchor: 'a' })).toMatchObject({ reporter: 'socket', title: 'Socket', state: 'failed', headline: '2 alerts in dependencies', count: 2, short: [{ text: '2 alerts' }, { text: '1', glyph: 'dot', tone: 'bad' }] });
    expect(readReport({ author: 'socket-security[bot]', body: '**All alerts resolved.** Learn more about [Socket for GitHub](https://socket.dev).\n\nThis PR previously contained dependency changes with security issues that have been resolved, removed, or ignored.', anchor: 'b' })).toMatchObject({ state: 'passed', headline: 'All alerts resolved', short: [] });
    const overview = `<!-- overview-comment -->
**New and removed dependencies detected.** Learn more about [Socket for GitHub ↗︎](https://socket.dev?utm_medium=gh)

| Package | New capabilities | Transitives | Size | Publisher |
|:--- |:--- |:--- |:--- |:--- |
| [npm/reflect-metadata@0.2.2](https://socket.dev/npm/package/reflect-metadata/overview/0.2.2) | None | 0 | 241 kB | rbuckton |
| [npm/left-pad@1.3.0](https://socket.dev/npm/package/left-pad/overview/1.3.0) | None | 0 | 4 kB | stevemao |

**🚮 Removed packages:** [npm/reflect-metadata@0.2.1](https://socket.dev/npm/package/reflect-metadata/overview/0.2.1)`;
    expect(readReport({ author: 'socket-security[bot]', body: overview, anchor: 'c' })).toMatchObject({ state: 'info', count: 2, short: [{ text: '2 new packages' }] });
  });

  it('reads the same Socket reports from the page text (bold as **, cells glued per row)', () => {
    const alertsText = `Caution\n**Review the following alerts detected in dependencies.**\nAccording to your organization's Security Policy, you must resolve all **"Block"** alerts before proceeding.\n\nAction\nSeverity\nAlert\n\n**Block**\n\n**Recently published**: github brave/pull-merge published 48 minutes ago\n\n**Warn**\n\n**New author**: npm/left-pad\n`;
    expect(readReport({ author: 'socket-security[bot]', body: alertsText, anchor: 'a' })).toMatchObject({ state: 'failed', count: 2, short: [{ text: '2 alerts' }, { text: '1', glyph: 'dot', tone: 'bad' }] });
    const overviewText = `**New and removed dependencies detected.** Learn more about Socket for GitHub\n\nPackageNew capabilitiesTransitivesSizePublisher\nnpm/reflect-metadata@0.2.2None0241 kBrbuckton\nnpm/left-pad@1.3.0None04 kBstevemao\n\n**🚮 Removed packages:** npm/reflect-metadata@0.2.1\n`;
    expect(readReport({ author: 'socket-security[bot]', body: overviewText, anchor: 'c' })).toMatchObject({ state: 'info', count: 2, short: [{ text: '2 new packages' }] });
  });

  it('reads Socket checks by their host, drops the Project Report, and shows the comment over the check', () => {
    const alerts = readCheckReport({ name: 'Socket Security: Pull Request Alerts', status: 'completed', conclusion: 'failure', detailsUrl: 'https://socket.dev', description: 'Pull Request #1231 Alerts: Complete with warnings' });
    expect(alerts).toMatchObject({ reporter: 'socket', state: 'failed', headline: 'Complete with warnings', short: [] });
    expect(readCheckReport({ name: 'Socket Security: Project Report', status: 'completed', conclusion: 'success', detailsUrl: 'https://socket.dev/dashboard/org/o/sbom/1', description: 'Project Report: Success' })).toBeNull();
    expect(readCheckReport({ name: 'Socket Security: Pull Request Alerts', status: 'completed', conclusion: 'success', detailsUrl: 'https://socket.dev', description: 'Pull Request #275 Alerts: Skipped' })).toBeNull();
    expect(readCheckReport({ name: 'Socket Security: Pull Request Alerts', status: 'completed', conclusion: 'success', detailsUrl: 'https://socket.dev', description: 'Pull Request #5906 Alerts: Success' })).toMatchObject({ state: 'passed', headline: 'Success' });
    const comment = readReport({ author: 'socket-security[bot]', body: socketAlerts, anchor: 'issuecomment-9' });
    expect(comment).not.toBeNull();
    const { latest } = latestReports([...(comment === null ? [] : [comment]), ...(alerts === null ? [] : [alerts])]);
    expect(latest.map((entry) => entry.anchor)).toEqual(['issuecomment-9']);
  });

  it('reads GitGuardian secrets from the comment and the check', () => {
    expect(readReport({ author: 'gitguardian[bot]', body: '#### ⚠️ GitGuardian has uncovered 1 secret following the scan of your pull request.\n\nPlease consider investigating', anchor: 'g' })).toMatchObject({ reporter: 'gitguardian', state: 'failed', headline: '1 secret in the changes', count: 1, short: [{ text: '1 secret' }] });
    expect(readCheckReport({ name: 'GitGuardian Security Checks', status: 'completed', conclusion: 'failure', detailsUrl: 'https://dashboard.gitguardian.com/workspace/1/incidents', description: '2 policy breaks detected' })).toMatchObject({ reporter: 'gitguardian', short: [{ text: '2 policy breaks' }] });
  });

  it('reads code scanning by its words, with the tool as the project and the state from the count', () => {
    const clean = readCheckReport({ name: 'CodeQL', status: 'completed', conclusion: 'success', detailsUrl: 'https://github.com/o/r/runs/110760561661', description: 'No new alerts in code changed by this pull request' });
    expect(clean).toMatchObject({ reporter: 'code-scanning', title: 'Code scanning', project: 'CodeQL', state: 'passed', short: [] });
    const found = readCheckReport({ name: 'CodeQL', status: 'completed', conclusion: 'success', detailsUrl: 'https://github.com/o/r/runs/2', description: '2 new alerts including 1 high severity security vulnerability in code changed by this pull request' });
    expect(found).toMatchObject({ state: 'failed', short: [{ text: '2 alerts' }, { text: '1', glyph: 'dot', tone: 'bad' }] });
    // Any other check on github.com is CI, not a report.
    expect(readCheckReport({ name: 'build', status: 'completed', conclusion: 'success', detailsUrl: 'https://github.com/o/r/runs/3', description: 'Successful in 2m' })).toBeNull();
  });

  it('reads Aikido, Gecko and Semgrep statuses', () => {
    expect(readCheckReport({ name: 'Aikido Security: check code', status: 'completed', conclusion: 'failure', detailsUrl: 'https://app.aikido.dev/featurebranch/scan/1?groupId=2', description: 'Scan completed' })).toMatchObject({ reporter: 'aikido', project: 'check code', state: 'failed', short: [] });
    expect(readCheckReport({ name: 'Gecko Security Review', status: 'completed', conclusion: 'success', detailsUrl: 'https://app.gecko.security', description: 'No vulnerabilities found' })).toMatchObject({ reporter: 'gecko', state: 'passed', short: [] });
    expect(readCheckReport({ name: 'Semgrep OSS', status: 'completed', conclusion: 'failure', detailsUrl: 'https://semgrep.dev/orgs/o/findings?repo=r', description: '3 findings' })).toMatchObject({ reporter: 'semgrep', short: [{ text: '3 findings' }] });
  });
});
