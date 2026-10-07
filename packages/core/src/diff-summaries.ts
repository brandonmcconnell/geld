/**
 * Per-file statistics from GitHub's own files-tab data. The React files view
 * loads `/owner/repo/pull/N/changes?_json=1`, whose payload carries a
 * `diffSummaries` entry per file of the pull request: `path`, `changeType`,
 * `linesAdded`, `linesDeleted`. It is served by github.com itself with the
 * session cookie, so it answers for private repositories and does not go
 * through the patch-diff host, which answers 503 for a while to a pull
 * request whose `.diff` nobody has asked for yet. It says nothing about
 * binary files, mode changes, whitespace or comment-only lines: what it
 * yields stands in for the diff until the diff itself lands.
 */

import type { FileStats, FileStatus } from './diff-parse';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const STATUS_BY_CHANGE_TYPE: Readonly<Record<string, FileStatus>> = {
  ADDED: 'added',
  DELETED: 'deleted',
  RENAMED: 'renamed',
  MODIFIED: 'modified',
  CHANGED: 'modified',
  COPIED: 'added',
};

/** Every `diffSummaries` entry anywhere in the payload, whatever route object GitHub nests them under. */
function findSummaries(value: unknown, depth = 0): readonly unknown[] | null {
  if (depth > 6 || !isRecord(value)) return null;
  if (Array.isArray(value.diffSummaries)) return value.diffSummaries;
  for (const child of Object.values(value)) {
    const found = findSummaries(child, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/**
 * The files of the pull request as `FileStats`, from the files tab's JSON
 * document; null when the document is not that shape (signed out, an
 * Enterprise version without the React view, a changed payload).
 */
export function parseDiffSummaries(document: unknown): readonly FileStats[] | null {
  const summaries = findSummaries(isRecord(document) ? document.payload : null);
  if (summaries === null) return null;
  const files: FileStats[] = [];
  for (const entry of summaries) {
    if (!isRecord(entry) || typeof entry.path !== 'string' || entry.path === '') continue;
    const additions = typeof entry.linesAdded === 'number' && Number.isFinite(entry.linesAdded) ? entry.linesAdded : 0;
    const deletions = typeof entry.linesDeleted === 'number' && Number.isFinite(entry.linesDeleted) ? entry.linesDeleted : 0;
    const status = typeof entry.changeType === 'string' ? STATUS_BY_CHANGE_TYPE[entry.changeType] : undefined;
    const kinds = status === 'deleted' ? (['deleted'] as const) : status === 'renamed' && additions + deletions === 0 ? (['renames'] as const) : null;
    files.push({ path: entry.path, additions, deletions, ...(status === undefined ? {} : { status }), ...(kinds === null ? {} : { kinds }) });
  }
  return files;
}

/** The files tab's JSON URL for a pull request's `.diff` URL; null for anything else (a commit's diff has no such tab). */
export function diffSummariesUrl(diffUrl: string): string | null {
  const match = /^(https:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/\d+)\.diff$/.exec(diffUrl);
  return match?.[1] === undefined ? null : `${match[1]}/changes?_json=1`;
}
