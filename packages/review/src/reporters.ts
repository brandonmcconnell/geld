/**
 * Reporter bots: CI-side tools that post a report on the pull request
 * (test failures on their runners, coverage, bundle size) rather than a
 * review of its code. A reporter never has a verdict, never counts as a
 * review, and never opens findings; its latest report per reporter is shown
 * in the panel's Reports row, where the comment opens in place.
 */

export type ReportState = 'failed' | 'passed' | 'info';

/** What a reporter's comment says, read from its text. */
export interface ReportReading {
  readonly state: ReportState;
  /** The report in a few words ("2 test failures"), as the pill and the line say it. */
  readonly headline: string;
  /** How many of the thing the report counts, when it counts something. */
  readonly count?: number;
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
        return { state: 'failed', headline: plural(count, 'test failure'), count };
      }
      if (/\b(?:all tests passed|no (?:test )?failures)\b/i.test(body)) return { state: 'passed', headline: 'Tests passed' };
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
  for (const entry of all) latestByKey.set(key(entry), entry);
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
  /** Hosts of the Details link, matched on the URL's hostname (with or without `www.`). */
  readonly hosts: readonly string[];
  /** The project the check is about, from its name ("UI Tests: mint" → "mint"); null leaves the name as the project. */
  readonly project: (name: string) => string | null;
  /** A status of this service that reports nothing a reviewer needs (Chromatic's "Storybook Publish"). */
  readonly ignore?: (name: string) => boolean;
}

export const CHECK_REPORTERS: readonly CheckReporter[] = [
  {
    id: 'chromatic',
    title: 'Chromatic',
    hosts: ['chromatic.com'],
    project: (name) => /^UI (?:Tests|Review)(?::\s*(.+))?$/i.exec(name)?.[1]?.trim() ?? null,
    // "Storybook Publish: project — 624 stories published" says the build uploaded, not what the tests found.
    ignore: (name) => /^Storybook Publish\b/i.test(name),
  },
];

export interface CheckForReport {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly detailsUrl?: string;
  readonly description?: string;
}

function checkReporterFor(url: string): CheckReporter | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  return CHECK_REPORTERS.find((reporter) => reporter.hosts.some((known) => host === known || host.endsWith(`.${known}`))) ?? null;
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
  const reporter = checkReporterFor(check.detailsUrl);
  if (reporter === null || reporter.ignore?.(check.name) === true) return null;
  const conclusion = (check.conclusion ?? '').toLowerCase();
  // A skipped or cancelled run reported nothing; a neutral one is the service standing aside.
  if (/^(?:skipped|cancelled|neutral|stale)$/.test(conclusion)) return null;
  const state: ReportState = check.status !== 'completed' ? 'info' : /^(?:failure|action_required|timed_out|error)$/.test(conclusion) ? 'failed' : conclusion === 'success' ? 'passed' : 'info';
  const project = reporter.project(check.name) ?? check.name;
  return { reporter: reporter.id, title: reporter.title, anchor: `check:${check.name}`, author: '', state, headline: headlineOf(check.description, state), project, url: check.detailsUrl };
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
