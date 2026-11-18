import type { ChangeKindId } from './change-kinds';
import type { CommentLines, CommentScanState, CommentSyntax } from './comment-lines';
import { commentSyntaxFor, isCommentOnlyLine, newCommentScanState } from './comment-lines';
import { canReadImports, importSpecifiers } from './file-flow';

/** What happened to the file as a whole — the icon GitHub's file tree shows for it. */
export type FileStatus = 'added' | 'deleted' | 'renamed' | 'modified';

/** Per-file line statistics. */
export interface FileStats {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  /** Absent in cache entries written before this existed (treat as `modified`). */
  readonly status?: FileStatus;
  /**
   * What the diff revealed about the change besides its size: a rename or a
   * mode change with no edited lines, a binary or deleted file, edits that
   * only touch whitespace. Absent when nothing of the sort applies (and in
   * cache entries written before this existed).
   */
  readonly kinds?: readonly ChangeKindId[];
  /**
   * Changed lines that only touch comments (see `comment-lines.ts`), by the
   * line numbers GitHub shows. Absent when there are none, when the language
   * is unknown, or when there are too many to be worth carrying around.
   */
  readonly commentLines?: CommentLines;
  /**
   * The import specifiers the diff's removed lines name (`importSpecifiers`), for files whose imports Geld can read:
   * all of a deleted file's, and those a surviving file dropped or rewrote. Read against the merge base, as the diff
   * is. Absent when there are none (and in cache entries written before this existed).
   */
  readonly removedImports?: readonly string[];
  /**
   * From GitHub's files-tab summaries (`parseDiffSummaries`), not the diff: counts, status and the kinds those show,
   * with no line-level facts (comment lines, removed imports), so their absence here says nothing about the change.
   */
  readonly summaryOnly?: true;
  /**
   * The counts with whitespace ignored, as GitHub shows them while it hides whitespace changes (`?w=1`, or the
   * reader's saved preference): what `git diff -w` would count. Absent when they are the raw counts (and in cache
   * entries written before this existed).
   */
  readonly ignoringWhitespace?: { readonly additions: number; readonly deletions: number };
}

/**
 * Raised whenever `parseUnifiedDiff` learns a new fact: a cached diff parsed by an earlier version is shown, and read
 * again in the background (the extension's `DiffCache`).
 */
export const DIFF_PARSE_VERSION = 2;

/** Above this many comment-only lines in one file the list is dropped (the `comments` kind still applies). */
const MAX_COMMENT_LINES = 2000;
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Extract the post-image path from a `diff --git a/x b/y` header line.
 * Falls back to the pre-image path for deletions (`b/` is `/dev/null` then).
 */
export function pathFromGitHeader(line: string, side: 'old' | 'new' = 'new'): string | null {
  const rest = line.slice('diff --git '.length);
  // Quoted paths (contain spaces or special characters) look like:
  //   diff --git "a/with space.ts" "b/with space.ts"
  if (rest.startsWith('"')) {
    const quoted = rest.match(/^"a\/((?:\\.|[^"\\])*)" "b\/((?:\\.|[^"\\])*)"$/);
    if (quoted) return unescapeGitPath((side === 'old' ? quoted[1] : quoted[2]) ?? '');
    return null;
  }
  // Unquoted: paths cannot contain spaces here, but be defensive about the
  // "a/foo b/foo" split by finding the " b/" that mirrors the "a/" prefix.
  const halfway = rest.indexOf(' b/');
  if (halfway === -1) return null;
  const aPath = rest.slice('a/'.length, halfway);
  const bPath = rest.slice(halfway + ' b/'.length);
  return side === 'old' ? aPath : bPath || aPath;
}

function unescapeGitPath(text: string): string {
  return text.replace(/\\(.)/g, (_match, char: string) => {
    if (char === 'n') return '\n';
    if (char === 't') return '\t';
    return char;
  });
}

/**
 * Parse a unified diff (as served by `https://github.com/<owner>/<repo>/pull/<n>.diff`)
 * into per-file addition/deletion counts. Binary files count as zero lines,
 * matching how GitHub reports them.
 */
export function parseUnifiedDiff(diffText: string): readonly FileStats[] {
  const files: FileStats[] = [];
  interface Current {
    path: string;
    additions: number;
    deletions: number;
    renamed: boolean;
    modeChanged: boolean;
    deleted: boolean;
    created: boolean;
    binary: boolean;
    hunks: number;
    /** Removed and added text of every hunk with whitespace stripped, to spot whitespace-only edits. */
    removed: string[];
    added: string[];
    /** Comment tracking: the language (null = unknown), the line counters and the block state of each side. */
    syntax: CommentSyntax | null;
    oldLine: number;
    newLine: number;
    oldState: CommentScanState;
    newState: CommentScanState;
    commentAdded: number[];
    commentRemoved: number[];
    /**
     * Each hunk's old and new side as written (context lines on both), for a file whose imports can be read (else
     * null): removed imports are read with the context around them, so a removed line inside a comment that stays is
     * not taken for an import.
     */
    oldSide: string[][] | null;
    newSide: string[][] | null;
    /** The current hunk's old and new side with whitespace stripped, context included, and the counts read so far. */
    hunkOld: string[];
    hunkNew: string[];
    wsAdditions: number;
    wsDeletions: number;
  }
  let current: Current | null = null;
  let inHunk = false;

  const closeHunk = (): void => {
    if (current === null || (current.hunkOld.length === 0 && current.hunkNew.length === 0)) return;
    const kept = commonLines(current.hunkOld, current.hunkNew);
    current.wsAdditions += current.hunkNew.length - kept;
    current.wsDeletions += current.hunkOld.length - kept;
    current.hunkOld = [];
    current.hunkNew = [];
  };

  const flush = (): void => {
    closeHunk();
    if (current !== null) {
      const kinds: ChangeKindId[] = [];
      if (current.renamed && current.hunks === 0) kinds.push('renames');
      if (current.modeChanged && current.hunks === 0) kinds.push('modes');
      if (current.binary) kinds.push('binary');
      if (current.deleted) kinds.push('deleted');
      if (current.hunks > 0 && !current.binary && current.removed.join('') === current.added.join('')) kinds.push('whitespace');
      const commentCount = current.commentAdded.length + current.commentRemoved.length;
      if (commentCount > 0 && commentCount === current.additions + current.deletions) kinds.push('comments');
      const status: FileStatus = current.deleted ? 'deleted' : current.created ? 'added' : current.renamed ? 'renamed' : 'modified';
      let stats: FileStats = { path: current.path, additions: current.additions, deletions: current.deletions, status };
      if (kinds.length > 0) stats = { ...stats, kinds };
      if (commentCount > 0 && commentCount <= MAX_COMMENT_LINES) stats = { ...stats, commentLines: { added: current.commentAdded, removed: current.commentRemoved } };
      if (current.oldSide !== null && current.newSide !== null && current.deletions > 0) {
        // Each hunk is read on its own: the lines between hunks are not in the diff, so a comment one hunk opens
        // must not run on into the next.
        const path = current.path;
        const named = (hunks: readonly string[][]): string[] => hunks.flatMap((hunk) => importSpecifiers(path, hunk.join('\n')));
        const kept = new Set(named(current.newSide));
        const removedImports = [...new Set(named(current.oldSide))].filter((specifier) => !kept.has(specifier));
        if (removedImports.length > 0) stats = { ...stats, removedImports };
      }
      if (!current.binary && (current.wsAdditions !== current.additions || current.wsDeletions !== current.deletions)) {
        stats = { ...stats, ignoringWhitespace: { additions: current.wsAdditions, deletions: current.wsDeletions } };
      }
      files.push(stats);
    }
    current = null;
  };

  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      const path = pathFromGitHeader(line);
      current =
        path === null
          ? null
          : {
              path,
              additions: 0,
              deletions: 0,
              renamed: false,
              modeChanged: false,
              deleted: false,
              created: false,
              binary: false,
              hunks: 0,
              removed: [],
              added: [],
              syntax: commentSyntaxFor(path),
              oldLine: 0,
              newLine: 0,
              oldState: newCommentScanState(),
              newState: newCommentScanState(),
              commentAdded: [],
              commentRemoved: [],
              oldSide: canReadImports(path) ? [] : null,
              newSide: canReadImports(path) ? [] : null,
              hunkOld: [],
              hunkNew: [],
              wsAdditions: 0,
              wsDeletions: 0,
            };
      inHunk = false;
      continue;
    }
    if (current === null) continue;

    if (line.startsWith('@@')) {
      closeHunk();
      inHunk = true;
      current.hunks += 1;
      current.oldSide?.push([]);
      current.newSide?.push([]);
      const header = HUNK_HEADER.exec(line);
      current.oldLine = Number(header?.[1] ?? 1);
      current.newLine = Number(header?.[2] ?? 1);
      // A hunk may start inside a block comment we never saw; assume it does not.
      current.oldState = newCommentScanState();
      current.newState = newCommentScanState();
      continue;
    }
    if (!inHunk) {
      // Renames without content changes have no hunks; the `rename to` line
      // is the most accurate path in that case.
      if (line.startsWith('rename to ')) {
        current.path = line.slice('rename to '.length);
        current.renamed = true;
        current.syntax = commentSyntaxFor(current.path);
      } else if (line.startsWith('rename from ')) current.renamed = true;
      else if (line.startsWith('old mode ') || line.startsWith('new mode ')) current.modeChanged = true;
      else if (line.startsWith('deleted file mode ')) current.deleted = true;
      else if (line.startsWith('new file mode ')) current.created = true;
      else if (line.startsWith('Binary files ') || line === 'GIT binary patch') current.binary = true;
      continue;
    }
    // File headers (`---`/`+++`) only appear before the first hunk, so inside a
    // hunk every `+`/`-` prefix is a real change (even `--- sql comment`).
    if (line.startsWith('+')) {
      current.additions += 1;
      const text = line.slice(1);
      current.added.push(text.replace(WHITESPACE, ''));
      current.hunkNew.push(text.replace(WHITESPACE, ''));
      current.newSide?.at(-1)?.push(text);
      if (current.syntax !== null && isCommentOnlyLine(text, current.syntax, current.newState)) current.commentAdded.push(current.newLine);
      current.newLine += 1;
    } else if (line.startsWith('-')) {
      current.deletions += 1;
      const text = line.slice(1);
      current.removed.push(text.replace(WHITESPACE, ''));
      current.hunkOld.push(text.replace(WHITESPACE, ''));
      current.oldSide?.at(-1)?.push(text);
      if (current.syntax !== null && isCommentOnlyLine(text, current.syntax, current.oldState)) current.commentRemoved.push(current.oldLine);
      current.oldLine += 1;
    } else if (line.startsWith(' ') || line === '') {
      // Context: advances both sides and carries block-comment state along.
      const text = line.slice(1);
      const stripped = text.replace(WHITESPACE, '');
      current.hunkOld.push(stripped);
      current.hunkNew.push(stripped);
      current.oldSide?.at(-1)?.push(text);
      current.newSide?.at(-1)?.push(text);
      if (current.syntax !== null) {
        isCommentOnlyLine(text, current.syntax, current.oldState);
        isCommentOnlyLine(text, current.syntax, current.newState);
      }
      current.oldLine += 1;
      current.newLine += 1;
    }
  }
  flush();
  return files;
}

const WHITESPACE = /\s+/g;

/** Past this many cells the middle of a hunk is matched line for line, not by the longest common subsequence. */
const MAX_LCS_CELLS = 4_000_000;

/**
 * How many lines a hunk's old and new side share, in order: the lines `git diff -w` would leave as context. Common
 * ends are trimmed first; a middle too large to compare in full is matched as a multiset instead (a close count).
 */
function commonLines(old: readonly string[], next: readonly string[]): number {
  let start = 0;
  while (start < old.length && start < next.length && old[start] === next[start]) start += 1;
  let end = 0;
  while (end < old.length - start && end < next.length - start && old[old.length - 1 - end] === next[next.length - 1 - end]) end += 1;
  const a = old.slice(start, old.length - end);
  const b = next.slice(start, next.length - end);
  if (a.length === 0 || b.length === 0) return start + end;
  if (a.length * b.length > MAX_LCS_CELLS) {
    const left = new Map<string, number>();
    for (const line of a) left.set(line, (left.get(line) ?? 0) + 1);
    let matched = 0;
    for (const line of b) {
      const count = left.get(line) ?? 0;
      if (count === 0) continue;
      left.set(line, count - 1);
      matched += 1;
    }
    return start + end + matched;
  }
  let previous = new Uint32Array(b.length + 1);
  let row = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = a[i - 1] === b[j - 1] ? (previous[j - 1] ?? 0) + 1 : Math.max(previous[j] ?? 0, row[j - 1] ?? 0);
    }
    [previous, row] = [row, previous];
  }
  return start + end + (previous[b.length] ?? 0);
}
