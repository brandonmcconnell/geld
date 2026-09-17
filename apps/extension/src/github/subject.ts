/**
 * A commit or pull request named by a GitHub URL — the thing whose `.diff`
 * Geld would fetch to count it — read from hrefs and hovercard target URLs
 * around the page (diffstat surfaces, commit links).
 */
export interface Subject {
  readonly repo: string;
  readonly diffUrl: string;
  /** Commit SHA when the subject is a commit (pins the cache); PRs are keyed by URL. */
  readonly sha: string | null;
}

const COMMIT_PATH = /\/([^/\s]+)\/([^/\s]+)\/commit\/([0-9a-f]{7,40})(?:[/?#]|$)/i;
/**
 * A commit viewed inside a pull request: `/pull/N/commits/<sha>` (the
 * timeline, the classic Commits tab) or `/pull/N/changes/<sha>` (the React
 * Commits tab links each commit to the Changes tab with it selected).
 */
const PULL_COMMIT_PATH = /\/([^/\s]+)\/([^/\s]+)\/pull\/\d+\/(?:commits|changes|files)\/([0-9a-f]{7,40})(?:[/?#]|$)/i;
const PULL_PATH = /\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#]|$)/;

export function subjectFrom(value: string | null): Subject | null {
  if (value === null) return null;
  const commit = COMMIT_PATH.exec(value) ?? PULL_COMMIT_PATH.exec(value);
  if (commit?.[1] !== undefined && commit[2] !== undefined && commit[3] !== undefined) {
    return {
      repo: `${commit[1]}/${commit[2]}`,
      diffUrl: `${window.location.origin}/${commit[1]}/${commit[2]}/commit/${commit[3]}.diff`,
      sha: commit[3].toLowerCase(),
    };
  }
  const pull = PULL_PATH.exec(value);
  if (pull?.[1] !== undefined && pull[2] !== undefined && pull[3] !== undefined) {
    return { repo: `${pull[1]}/${pull[2]}`, diffUrl: `${window.location.origin}/${pull[1]}/${pull[2]}/pull/${pull[3]}.diff`, sha: null };
  }
  return null;
}

/** The commit a link points at, if it is a link to one (a PR link is not a commit). */
export function commitSubjectFrom(value: string | null): Subject | null {
  const subject = subjectFrom(value);
  return subject?.sha === null ? null : subject;
}
