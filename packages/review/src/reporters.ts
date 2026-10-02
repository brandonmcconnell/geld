/**
 * Reporter bots: CI-side tools that post a report on the pull request
 * (test failures on their runners, coverage, bundle size) rather than a
 * review of its code. A reporter never has a verdict, never counts as a
 * review, and never opens findings; its latest report per reporter is shown
 * in the panel's Reports row, where the comment opens in place.
 */

export type ReportState = 'failed' | 'passed' | 'info';

/**
 * One piece of a report's short form on its pill: a few words, with a glyph
 * and tone when the piece is a count of one kind among others ("✗ 2 ✓ 41").
 */
export interface ReportPart {
  readonly text: string;
  readonly glyph?: 'x' | 'check' | 'dot';
  readonly tone?: 'bad' | 'good' | 'warn' | 'muted';
}

/** What a reporter's comment or status says, read from its text. */
export interface ReportReading {
  readonly state: ReportState;
  /** The report in the service's own words ("4 visual changes need review"), as the line says it. */
  readonly headline: string;
  /** How many of the thing the report counts, when it counts something. */
  readonly count?: number;
  /**
   * The pill's short form ("4 changes"; "✗ 2 ✓ 41"): the numbers without the sentence, since the state light says
   * the rest and the line has the words. Empty when the headline is only a verdict ("Quality Gate failed"), so the
   * pill is the service and its light.
   */
  readonly short?: readonly ReportPart[];
}

export interface Reporter {
  readonly id: string;
  readonly title: string;
  readonly logins: readonly string[];
  /** Read a comment by this reporter; null when the comment is not a report (a reply, a notice). */
  readonly read: (body: string) => ReportReading | null;
}

export interface Report extends ReportReading {
  readonly reporter: string;
  readonly title: string;
  /** The comment the report is (a reporter bot's), or the check's name (a check reporter's): its identity on the page. */
  readonly anchor: string;
  readonly author: string;
  readonly createdAt?: string;
  /** A report posted as a check or commit status rather than a comment: the project it is about, and where its details are. */
  readonly project?: string;
  readonly url?: string;
}

function plural(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

export const REPORTERS: readonly Reporter[] = [
  {
    // Blacksmith (blacksmith.sh): CI runners; its bot posts "Found N test failures on Blacksmith runners:" with the
    // failing tests and their logs, and a "Fix in [code]smith" call to action.
    id: 'blacksmith',
    title: 'Blacksmith',
    logins: ['blacksmith-sh[bot]', 'blacksmith[bot]'],
    read: (body) => {
      const failures = /\bfound (\d+) (?:test )?failures?\b/i.exec(body);
      if (failures !== null) {
        const count = Number(failures[1]);
        return { state: 'failed', headline: plural(count, 'test failure'), count, short: [{ text: plural(count, 'failure') }] };
      }
      if (/\b(?:all tests passed|no (?:test )?failures)\b/i.test(body)) return { state: 'passed', headline: 'Tests passed', short: [] };
      return null;
    },
  },
  {
    // Socket (socket.dev): supply-chain security. Its bot keeps one comment per pull request current: with alerts,
    // "Review the following alerts detected in dependencies" over a table whose rows start with the policy action
    // (Block / Warn / Monitor); once fixed or ignored, "All alerts resolved"; and, when the policy says so, an
    // overview "New and removed dependencies detected" with a table of the new packages.
    id: 'socket',
    title: 'Socket',
    logins: ['socket-security[bot]', 'socket-security-staging[bot]'],
    read: (body) => {
      if (/\breview the following alerts\b/i.test(body)) {
        // One row per alert, led by the policy's action in bold: `<strong>Block</strong>` in the raw Markdown, `**Block**`
        // once the page's text is read back (the preamble's `**"Block"**` has quotes and does not count).
        const rows = body.match(/(?:\*\*|<strong>)(Block|Warn|Monitor|Ignore)(?:\*\*|<\/strong>)/g) ?? [];
        const count = rows.length;
        const blocked = rows.filter((row) => /Block/.test(row)).length;
        const parts: ReportPart[] = count > 0 ? [{ text: plural(count, 'alert') }] : [];
        if (blocked > 0) parts.push({ text: String(blocked), glyph: 'dot', tone: 'bad' });
        return { state: 'failed', headline: count > 0 ? `${plural(count, 'alert')} in dependencies` : 'Alerts in dependencies', ...(count > 0 ? { count } : {}), short: parts };
      }
      if (/\ball alerts resolved\b/i.test(body)) return { state: 'passed', headline: 'All alerts resolved', short: [] };
      if (/\bnew and removed dependencies detected\b/i.test(body) || /\bnew dependencies detected\b/i.test(body)) {
        // One table row per new package, "npm/name@version" first in the row (linked in the raw Markdown, bare in the
        // page's text); the removed ones are listed after "Removed packages:" on one line and are not rows.
        const added = (body.match(/^(?:\|\s*\[)?(?:npm|pypi|golang|go|github|maven|cargo|gem|rubygems|nuget|huggingface|chrome|vscode|actions)\/[^\s@\]|]+@/gim) ?? []).length;
        return { state: 'info', headline: 'New and removed dependencies detected', ...(added > 0 ? { count: added } : {}), short: added > 0 ? [{ text: plural(added, 'new package') }] : [] };
      }
      return null;
    },
  },
  {
    // GitGuardian: secrets. "GitGuardian has uncovered 1 secret following the scan of your pull request" with a
    // table of incidents; the same comment is edited to say the secret was revoked or ignored.
    id: 'gitguardian',
    title: 'GitGuardian',
    logins: ['gitguardian[bot]'],
    read: (body) => {
      const found = /\buncovered (\d+) (?:hardcoded )?secrets?\b/i.exec(body);
      if (found !== null) {
        const count = Number(found[1]);
        return { state: 'failed', headline: `${plural(count, 'secret')} in the changes`, count, short: [{ text: plural(count, 'secret') }] };
      }
      if (/\bno secrets? (?:have been |were )?(?:found|detected)\b/i.test(body)) return { state: 'passed', headline: 'No secrets found', short: [] };
      return null;
    },
  },
];

const LOGIN_INDEX = new Map<string, Reporter>();
for (const reporter of REPORTERS) {
  for (const login of reporter.logins) LOGIN_INDEX.set(login.toLowerCase(), reporter);
}

export function reporterByLogin(login: string): Reporter | null {
  return LOGIN_INDEX.get(login.toLowerCase()) ?? null;
}

export function reporterById(id: string): Reporter | null {
  return REPORTERS.find((reporter) => reporter.id === id) ?? null;
}

export interface ReportSource {
  readonly author: string;
  readonly body: string;
  readonly anchor: string;
  readonly createdAt?: string;
}

/** The report a comment is, when its author is a reporter and its text reads as one. */
export function readReport(comment: ReportSource): Report | null {
  const reporter = reporterByLogin(comment.author);
  if (reporter === null) return null;
  const reading = reporter.read(comment.body);
  if (reading === null) return null;
  return { ...reading, reporter: reporter.id, title: reporter.title, anchor: comment.anchor, author: comment.author, ...(comment.createdAt === undefined ? {} : { createdAt: comment.createdAt }) };
}

/** Every report among the comments, in the order given. */
export function reportsFrom(comments: readonly ReportSource[]): readonly Report[] {
  return comments.flatMap((comment) => {
    const report = readReport(comment);
    return report === null ? [] : [report];
  });
}

/**
 * A reporter's latest report supersedes its earlier ones (Blacksmith posts
 * one per push and minimizes the old ones): the row shows one per reporter,
 * the earlier ones stay in their rounds.
 */
export function latestReports(all: readonly Report[]): { readonly latest: readonly Report[]; readonly archived: readonly Report[] } {
  const key = (entry: Report): string => `${entry.reporter}:${entry.project ?? ''}`;
  const latestByKey = new Map<string, Report>();
  for (const entry of all) {
    // A service that both comments and sets a check (Socket) is shown once, as its comment: the comment holds the
    // details and opens in place, the check only points at the site. Among comments, the later one wins.
    const current = latestByKey.get(key(entry));
    if (current !== undefined && current.url === undefined && entry.url !== undefined) continue;
    latestByKey.set(key(entry), entry);
  }
  const latest = [...latestByKey.values()];
  const archived = all.filter((entry) => latestByKey.get(key(entry)) !== entry).reverse();
  return { latest, archived };
}

/**
 * Check reporters: services that report through a commit status or check
 * run whose Details lead to their site (Chromatic's "UI Tests: project" with
 * a chromatic.com link). GitHub lists them among the CI checks, where a
 * failed visual test reads like any failed job; the Reports row names the
 * service, what it found and where to look. Known by the Details host, not
 * the check's name, which the repository chooses.
 */
export interface CheckReporter {
  readonly id: string;
  readonly title: string;
  /** Hosts of the Details link, matched on the URL's hostname (with or without `www.`, subdomains included). */
  readonly hosts: readonly string[];
  /** When the host alone is too broad (a shared pages host), the Details path must match this too. */
  readonly path?: RegExp;
  /** The project or facet the check is about, from its name ("UI Tests: mint" → "mint", "codecov/patch" → "patch"); null for none. */
  readonly project: (name: string) => string | null;
  /** A status of this service that reports nothing a reviewer needs (Chromatic's "Storybook Publish", Socket's "Alerts: Skipped" when no dependency changed). */
  readonly ignore?: (name: string, description: string) => boolean;
  /** The pill's short form from GitHub's description (see `ReportReading.short`); absent, the pill shows the headline. */
  readonly short?: (description: string) => readonly ReportPart[];
  /**
   * When the host alone says nothing (GitHub's own code scanning links to `github.com/…/runs/N`), the description
   * must match this too: the words are the service's, whatever the check is called.
   */
  readonly description?: RegExp;
  /** The description with the service's preamble taken off ("Pull Request #12 Alerts: " before Socket's verdict). */
  readonly rephrase?: (description: string) => string;
  /**
   * The state read from the words rather than the conclusion, when they disagree: code scanning passes a check with
   * "2 new alerts" when none reaches the failure threshold, and a reviewer still wants to see them.
   */
  readonly state?: (description: string, fromConclusion: ReportState) => ReportState;
}

/**
 * "N <noun>" when the words count that thing ("3 changes must be accepted", "2 unresolved diffs"), or nothing
 * to say: "411 tests unchanged" counts tests that did not change, which is the light's job, not a number's.
 */
function counted(words: string, noun: string, pattern: RegExp): readonly ReportPart[] {
  const match = pattern.exec(words);
  return match?.[1] === undefined ? [] : [{ text: plural(Number(match[1]), noun) }];
}

// Chromatic also writes "1 visual and accessibility change must be accepted as baseline".
const CHANGES = /(\d+) (?:visual |ui )?(?:and accessibility )?changes?\b/i;
const DIFFS = /(\d+) (?:unresolved |visual |new )?(?:diffs?|differences?)\b/i;

/** The first percentage in the words, with a parenthesised change right after it when there is one ("80.12% (+0.03%)"). */
function percent(words: string): readonly ReportPart[] {
  const match = /(\d+(?:\.\d+)?%)(\s*\([+−-]\d+(?:\.\d+)?%\))?/.exec(words);
  return match === null ? [] : [{ text: `${match[1]}${match[2] === undefined ? '' : ` ${match[2].trim()}`}` }];
}

/** "service/project" and "service/project (extra)": the part after the service's slash, or null. */
const afterSlash =
  (service: RegExp) =>
  (name: string): string | null => {
    const match = service.exec(name);
    if (match === null) return null;
    const rest = name.slice(match[0].length).replace(/\s*\([^)]*\)\s*$/, '').trim();
    return rest === '' ? null : rest;
  };

/** Services that report through a status or check with Details on their own site. */
export const CHECK_REPORTERS: readonly CheckReporter[] = [
  {
    // Visual tests per Storybook project: "UI Tests: project — Failed test" / "— 3 changes must be accepted".
    id: 'chromatic',
    title: 'Chromatic',
    hosts: ['chromatic.com'],
    project: (name) => /^UI (?:Tests|Review)(?::\s*(.+))?$/i.exec(name)?.[1]?.trim() ?? null,
    // "Storybook Publish: project — 624 stories published" says the build uploaded, not what the tests found.
    ignore: (name) => /^Storybook Publish\b/i.test(name),
    // "3 changes must be accepted" → "3 changes"; "Failed test" / "Passed" / "411 tests unchanged" → the light alone.
    short: (words) => counted(words, 'change', CHANGES),
  },
  {
    // Visual review: "percy/project — 4 visual changes need review" / "— Visual review automatically approved".
    id: 'percy',
    title: 'Percy',
    hosts: ['percy.io'],
    project: afterSlash(/^percy\//i),
    short: (words) => counted(words, 'change', CHANGES),
  },
  {
    // Coverage: "codecov/project — 80.12% (+0.03%) compared to abc1234", "codecov/patch — 62.50% of diff hit (target 80.00%)";
    // flags add a third segment ("codecov/project/ui"). The facet after "codecov/" is the project here.
    id: 'codecov',
    title: 'Codecov',
    hosts: ['codecov.io'],
    project: afterSlash(/^codecov\//i),
    // "62.50% of diff hit (target 80.00%)" → "62.50%"; "80.12% (+0.03%) compared to abc" → "80.12% (+0.03%)".
    short: percent,
  },
  {
    // "SonarCloud Code Analysis" / "SonarQube Cloud Code Analysis" — "Quality Gate passed" / "Quality Gate failed".
    id: 'sonar',
    title: 'Sonar',
    hosts: ['sonarcloud.io', 'sonarqube.com', 'sonarqube.io', 'sonarsource.com'],
    project: () => null,
    // "Quality Gate passed" / "failed": the light says it.
    short: () => [],
  },
  {
    // "security/snyk - package.json (org)" / "license/snyk - …" — "No new issues" / "2 new issues (1 high)".
    id: 'snyk',
    title: 'Snyk',
    hosts: ['snyk.io'],
    project: afterSlash(/^(?:security|license|code)\/snyk\s*-\s*/i),
    // "2 new issues (1 high, 1 medium)" → "2 issues" and a red-dotted count of the high ones; "No new issues" → the light.
    short: (words) => {
      const issues = /(\d+) new issues?/i.exec(words);
      if (issues === null) return [];
      const parts: ReportPart[] = [{ text: plural(Number(issues[1]), 'issue') }];
      const high = /(\d+) (?:high|critical)/i.exec(words);
      if (high !== null) parts.push({ text: high[1] ?? '', glyph: 'dot', tone: 'bad' });
      return parts;
    },
  },
  {
    // "Cypress Cloud" — "Failed: 2 • Passed: 41 • Pending: 0 • Skipped: 1" with the run's dashboard link.
    id: 'cypress',
    title: 'Cypress Cloud',
    hosts: ['cypress.io'],
    project: afterSlash(/^cypress(?: cloud)?\s*[/:-]\s*/i),
    // "Failed: 2 • Passed: 41 • Pending: 0 • Skipped: 1" → "✗ 2 ✓ 41" (a pending count with a dot; zeros and skips left out).
    short: (words) => {
      const read = (key: string): number | null => {
        const match = new RegExp(`${key}:?\\s*(\\d+)`, 'i').exec(words);
        return match === null ? null : Number(match[1]);
      };
      const parts: ReportPart[] = [];
      const failed = read('failed');
      const passed = read('passed');
      const pending = read('pending');
      if (failed !== null && failed > 0) parts.push({ text: String(failed), glyph: 'x', tone: 'bad' });
      if (passed !== null && passed > 0) parts.push({ text: String(passed), glyph: 'check', tone: 'good' });
      if (pending !== null && pending > 0) parts.push({ text: String(pending), glyph: 'dot', tone: 'warn' });
      return parts;
    },
  },
  {
    // "argos" — "3 changes, waiting for your decision" / "No change detected".
    id: 'argos',
    title: 'Argos',
    hosts: ['argos-ci.com'],
    project: afterSlash(/^argos\//i),
    short: (words) => counted(words, 'change', CHANGES),
  },
  {
    // "happo" / "happo/project" — "2 diffs" / "No diffs".
    id: 'happo',
    title: 'Happo',
    hosts: ['happo.io'],
    project: afterSlash(/^happo\//i),
    short: (words) => counted(words, 'diff', DIFFS),
  },
  {
    // Applitools Eyes — "3 unresolved diffs" / "All tests passed".
    id: 'applitools',
    title: 'Applitools',
    hosts: ['applitools.com'],
    project: afterSlash(/^(?:applitools|eyes)\//i),
    short: (words) => counted(words, 'diff', DIFFS),
  },
  {
    // "lost-pixel" — "N differences found".
    id: 'lost-pixel',
    title: 'Lost Pixel',
    hosts: ['lost-pixel.com'],
    project: afterSlash(/^lost-pixel\//i),
    short: (words) => counted(words, 'diff', DIFFS),
  },
  {
    // Lighthouse CI's public report viewer lives on GitHub Pages, so the path is checked as well as the host; a
    // self-hosted LHCI server has no host to know, and is left to the check's name.
    id: 'lighthouse',
    title: 'Lighthouse CI',
    hosts: ['googlechrome.github.io'],
    path: /\/lighthouse-ci\//i,
    project: afterSlash(/^lhci\//i),
    short: (words) => counted(words, 'assertion', /(\d+) (?:failed )?assertions?\b/i),
  },
  {
    // Socket's checks: "Socket Security: Pull Request Alerts — Pull Request #12 Alerts: Success | Skipped | Complete
    // with warnings" (Details: socket.dev) and "Socket Security: Project Report — Project Report: Success", which is
    // about every dependency in the project, not this pull request. When Socket also commented, the comment is shown
    // instead (`latestReports`).
    id: 'socket',
    title: 'Socket',
    hosts: ['socket.dev'],
    project: () => null,
    // "Skipped": the pull request changes no dependency, so there is nothing to report.
    ignore: (name, description) => /\bProject Report\b/i.test(name) || /\bAlerts:\s*Skipped\b/i.test(description),
    rephrase: (words) => words.replace(/^Pull Request #\d+ Alerts:\s*/i, ''),
    // "Complete with warnings" / "Success" / "Skipped": the light says it.
    short: () => [],
  },
  {
    // "GitGuardian Security Checks — 2 policy breaks detected" / "No policy breaks detected" (Details: dashboard.gitguardian.com).
    id: 'gitguardian',
    title: 'GitGuardian',
    hosts: ['gitguardian.com'],
    project: () => null,
    short: (words) => {
      const match = /(\d+) (secrets?|policy breaks?|incidents?)\b/i.exec(words);
      if (match?.[1] === undefined) return [];
      const noun = /^policy/i.test(match[2] ?? '') ? 'policy break' : /^incident/i.test(match[2] ?? '') ? 'incident' : 'secret';
      return [{ text: plural(Number(match[1]), noun) }];
    },
  },
  {
    // "Semgrep OSS" / "Semgrep Code" / "Semgrep Cloud Platform" — "N findings" (Details: semgrep.dev).
    id: 'semgrep',
    title: 'Semgrep',
    hosts: ['semgrep.dev'],
    project: afterSlash(/^Semgrep(?: OSS| Code| Cloud Platform)?\s*[/:-]\s*/i),
    short: (words) => counted(words, 'finding', /(\d+) (?:new |blocking )?findings?\b/i),
  },
  {
    // "Aikido Security: check code" / "check dependencies" — "Scan completed" (Details: app.aikido.dev); the facet after
    // the colon is the project, the conclusion says whether it found anything.
    id: 'aikido',
    title: 'Aikido',
    hosts: ['aikido.dev'],
    project: afterSlash(/^Aikido(?: Security)?\s*[/:-]\s*/i),
    short: (words) => counted(words, 'issue', /(\d+) (?:new )?(?:issues?|vulnerabilit(?:y|ies))\b/i),
  },
  {
    // "Gecko Security Review" — "No vulnerabilities found" / "N vulnerabilities found" (Details: app.gecko.security).
    id: 'gecko',
    title: 'Gecko',
    hosts: ['gecko.security'],
    project: () => null,
    short: (words) => counted(words, 'vulnerability', /(\d+) (?:new )?vulnerabilit(?:y|ies)\b/i),
  },
  {
    // GitHub's own code scanning ("CodeQL", or any uploaded tool's name): Details is a plain `github.com/…/runs/N`,
    // so the words identify it — "No new alerts in code changed by this pull request" / "2 new alerts including 1
    // high severity security vulnerability". The tool's name is the project. The check passes unless an alert reaches
    // the repository's failure threshold, so the state is read from the count.
    id: 'code-scanning',
    title: 'Code scanning',
    hosts: ['github.com'],
    path: /\/runs\/\d+/,
    description: /\bcode changed by this pull request\b/i,
    project: (name) => (name.trim() === '' ? null : name.trim()),
    state: (words, fromConclusion) => (/\b([1-9]\d*) new alerts?\b/i.test(words) ? 'failed' : fromConclusion),
    short: (words) => {
      const alerts = /\b(\d+) new alerts?\b/i.exec(words);
      if (alerts?.[1] === undefined || Number(alerts[1]) === 0) return [];
      const parts: ReportPart[] = [{ text: plural(Number(alerts[1]), 'alert') }];
      const severe = /\b(\d+) (?:critical|high)\b/i.exec(words);
      if (severe?.[1] !== undefined) parts.push({ text: severe[1], glyph: 'dot', tone: 'bad' });
      return parts;
    },
  },
];

export interface CheckForReport {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly detailsUrl?: string;
  readonly description?: string;
}

function checkReporterFor(url: string, description: string): CheckReporter | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  return (
    CHECK_REPORTERS.find(
      (reporter) =>
        reporter.hosts.some((known) => host === known || host.endsWith(`.${known}`)) &&
        (reporter.path === undefined || reporter.path.test(parsed.pathname)) &&
        (reporter.description === undefined || reporter.description.test(description)),
    ) ?? null
  );
}

/** GitHub's description for a status ("— Failed test", "Failing after 6m") as the report's headline. */
function headlineOf(description: string | undefined, state: ReportState): string {
  const words = (description ?? '').replace(/^[\s—–-]+/, '').replace(/\.$/, '').trim();
  if (words !== '' && !/^(?:failing|successful|in progress|queued|pending)\b/i.test(words)) return words;
  return state === 'failed' ? 'Failed' : state === 'passed' ? 'Passed' : 'Running';
}

/** The report a check is, when its Details lead to a known reporter and it has something to say. */
export function readCheckReport(check: CheckForReport): Report | null {
  if (check.detailsUrl === undefined) return null;
  const rawWords = (check.description ?? '').replace(/^[\s—–-]+/, '').trim();
  const reporter = checkReporterFor(check.detailsUrl, rawWords);
  if (reporter === null || reporter.ignore?.(check.name, rawWords) === true) return null;
  const conclusion = (check.conclusion ?? '').toLowerCase();
  // A skipped or cancelled run reported nothing; a neutral one is the service standing aside.
  if (/^(?:skipped|cancelled|neutral|stale)$/.test(conclusion)) return null;
  const words = reporter.rephrase === undefined ? rawWords : reporter.rephrase(rawWords);
  const fromConclusion: ReportState = check.status !== 'completed' ? 'info' : /^(?:failure|action_required|timed_out|error)$/.test(conclusion) ? 'failed' : conclusion === 'success' ? 'passed' : 'info';
  const state = reporter.state === undefined ? fromConclusion : reporter.state(words, fromConclusion);
  const project = reporter.project(check.name);
  const headline = headlineOf(words, state);
  // The short form reads GitHub's words, not the fallback verdict; a verdict alone leaves the light to say it.
  const short = reporter.short === undefined ? undefined : reporter.short(words);
  return { reporter: reporter.id, title: reporter.title, anchor: `check:${check.name}`, author: '', state, headline, ...(project === null ? {} : { project }), ...(short === undefined ? {} : { short }), url: check.detailsUrl };
}

export function reportsFromChecks(checks: readonly CheckForReport[]): readonly Report[] {
  return checks.flatMap((check) => {
    const report = readCheckReport(check);
    return report === null ? [] : [report];
  });
}

export function reportsHealth(reports: readonly Report[]): 'bad' | 'good' | 'pending' {
  if (reports.some((entry) => entry.state === 'failed')) return 'bad';
  if (reports.some((entry) => entry.state === 'passed')) return 'good';
  return 'pending';
}
