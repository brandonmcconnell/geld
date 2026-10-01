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
  readonly anchor: string;
  readonly author: string;
  readonly createdAt?: string;
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
  const latestByReporter = new Map<string, Report>();
  for (const entry of all) latestByReporter.set(entry.reporter, entry);
  const latest = [...latestByReporter.values()];
  const archived = all.filter((entry) => latestByReporter.get(entry.reporter) !== entry).reverse();
  return { latest, archived };
}

export function reportsHealth(reports: readonly Report[]): 'bad' | 'good' | 'pending' {
  if (reports.some((entry) => entry.state === 'failed')) return 'bad';
  if (reports.some((entry) => entry.state === 'passed')) return 'good';
  return 'pending';
}
