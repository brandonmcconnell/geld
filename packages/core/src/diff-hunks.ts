import type { FileStatus } from './diff-parse';
import { pathFromGitHeader } from './diff-parse';

/**
 * A unified diff read at hunk granularity, for work that needs to know
 * *which lines* changed and not only how many: the Review tab groups a pull
 * request into steps that own hunks, and folds the hunks of other steps out
 * of a file's rendered diff. `parseUnifiedDiff` stays the counts-only reader
 * (it is what the diff cache stores); this one keeps the text of every
 * changed line, so its output is held in memory for the current page only.
 */

export interface DiffHunk {
  /** Position among the file's hunks, from 0. */
  readonly index: number;
  /** The `@@ … @@` line as written, including any function context after the second `@@`. */
  readonly header: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  /** Added lines without their `+` prefix, in order. */
  readonly added: readonly string[];
  /** Removed lines without their `-` prefix, in order. */
  readonly removed: readonly string[];
  /**
   * A short hash of the hunk's changed text (not its position), so a hunk
   * that moved down a file after an unrelated edit above it still answers to
   * the same signature across pushes.
   */
  readonly signature: string;
}

export interface FileHunks {
  /** Post-image path (`rename to` for renames). */
  readonly path: string;
  /** Pre-image path when the file was renamed, else absent. */
  readonly previousPath?: string;
  readonly status: FileStatus;
  readonly binary: boolean;
  readonly hunks: readonly DiffHunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** FNV-1a over the text as a short base-36 key. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}-${hash.toString(36)}`;
}

interface OpenHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  added: string[];
  removed: string[];
}

interface OpenFile {
  path: string;
  previousPath: string | null;
  renamed: boolean;
  deleted: boolean;
  created: boolean;
  binary: boolean;
  hunks: DiffHunk[];
  open: OpenHunk | null;
}

export function parseUnifiedDiffHunks(diffText: string): readonly FileHunks[] {
  const files: FileHunks[] = [];
  let current: OpenFile | null = null;

  const closeHunk = (file: OpenFile): void => {
    const hunk = file.open;
    if (hunk === null) return;
    file.hunks.push({
      index: file.hunks.length,
      header: hunk.header,
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      added: hunk.added,
      removed: hunk.removed,
      signature: hashText(`${file.path}\n-${hunk.removed.join('\n-')}\n+${hunk.added.join('\n+')}`),
    });
    file.open = null;
  };

  const flush = (): void => {
    if (current === null) return;
    closeHunk(current);
    const status: FileStatus = current.deleted ? 'deleted' : current.created ? 'added' : current.renamed ? 'renamed' : 'modified';
    const file: FileHunks = { path: current.path, status, binary: current.binary, hunks: current.hunks };
    files.push(current.previousPath === null || current.previousPath === current.path ? file : { ...file, previousPath: current.previousPath });
    current = null;
  };

  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      const path = pathFromGitHeader(line);
      current = path === null ? null : { path, previousPath: null, renamed: false, deleted: false, created: false, binary: false, hunks: [], open: null };
      continue;
    }
    if (current === null) continue;
    const file: OpenFile = current;

    if (line.startsWith('@@')) {
      closeHunk(file);
      const header = HUNK_HEADER.exec(line);
      file.open = {
        header: line,
        oldStart: Number(header?.[1] ?? 1),
        oldLines: header?.[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header?.[3] ?? 1),
        newLines: header?.[4] === undefined ? 1 : Number(header[4]),
        added: [],
        removed: [],
      };
      continue;
    }
    if (file.open === null) {
      if (line.startsWith('rename to ')) {
        file.path = line.slice('rename to '.length);
        file.renamed = true;
      } else if (line.startsWith('rename from ')) {
        file.previousPath = line.slice('rename from '.length);
        file.renamed = true;
      } else if (line.startsWith('deleted file mode ')) file.deleted = true;
      else if (line.startsWith('new file mode ')) file.created = true;
      else if (line.startsWith('Binary files ') || line === 'GIT binary patch') file.binary = true;
      continue;
    }
    if (line.startsWith('+')) file.open.added.push(line.slice(1));
    else if (line.startsWith('-')) file.open.removed.push(line.slice(1));
    // Context lines, `\ No newline at end of file`, and the blank line a trailing newline leaves add nothing.
  }
  flush();
  return files;
}

/** The new-file line numbers a hunk covers, as `[start, end)`; a pure deletion covers none. */
export function hunkNewRange(hunk: DiffHunk): readonly [number, number] {
  return [hunk.newStart, hunk.newStart + hunk.newLines];
}

/** The old-file line numbers a hunk covers, as `[start, end)`; a pure addition covers none. */
export function hunkOldRange(hunk: DiffHunk): readonly [number, number] {
  return [hunk.oldStart, hunk.oldStart + hunk.oldLines];
}
