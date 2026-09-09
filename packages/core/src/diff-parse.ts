import type { ChangeKindId } from './change-kinds';

/** Per-file line statistics. */
export interface FileStats {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  /**
   * What the diff revealed about the change besides its size: a rename or a
   * mode change with no edited lines, a binary or deleted file, edits that
   * only touch whitespace. Absent when nothing of the sort applies (and in
   * cache entries written before this existed).
   */
  readonly kinds?: readonly ChangeKindId[];
}

/**
 * Extract the post-image path from a `diff --git a/x b/y` header line.
 * Falls back to the pre-image path for deletions (`b/` is `/dev/null` then).
 */
function pathFromGitHeader(line: string): string | null {
  const rest = line.slice('diff --git '.length);
  // Quoted paths (contain spaces or special characters) look like:
  //   diff --git "a/with space.ts" "b/with space.ts"
  if (rest.startsWith('"')) {
    const quoted = rest.match(/^"a\/((?:\\.|[^"\\])*)" "b\/((?:\\.|[^"\\])*)"$/);
    if (quoted) return unescapeGitPath(quoted[2] ?? quoted[1] ?? '');
    return null;
  }
  // Unquoted: paths cannot contain spaces here, but be defensive about the
  // "a/foo b/foo" split by finding the " b/" that mirrors the "a/" prefix.
  const halfway = rest.indexOf(' b/');
  if (halfway === -1) return null;
  const aPath = rest.slice('a/'.length, halfway);
  const bPath = rest.slice(halfway + ' b/'.length);
  return bPath || aPath;
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
    binary: boolean;
    hunks: number;
    /** Removed and added text of every hunk with whitespace stripped, to spot whitespace-only edits. */
    removed: string[];
    added: string[];
  }
  let current: Current | null = null;
  let inHunk = false;

  const flush = (): void => {
    if (current !== null) {
      const kinds: ChangeKindId[] = [];
      if (current.renamed && current.hunks === 0) kinds.push('renames');
      if (current.modeChanged && current.hunks === 0) kinds.push('modes');
      if (current.binary) kinds.push('binary');
      if (current.deleted) kinds.push('deleted');
      if (current.hunks > 0 && !current.binary && current.removed.join('') === current.added.join('')) kinds.push('whitespace');
      const stats: FileStats = { path: current.path, additions: current.additions, deletions: current.deletions };
      files.push(kinds.length === 0 ? stats : { ...stats, kinds });
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
          : { path, additions: 0, deletions: 0, renamed: false, modeChanged: false, deleted: false, binary: false, hunks: 0, removed: [], added: [] };
      inHunk = false;
      continue;
    }
    if (current === null) continue;

    if (line.startsWith('@@')) {
      inHunk = true;
      current.hunks += 1;
      continue;
    }
    if (!inHunk) {
      // Renames without content changes have no hunks; the `rename to` line
      // is the most accurate path in that case.
      if (line.startsWith('rename to ')) {
        current.path = line.slice('rename to '.length);
        current.renamed = true;
      } else if (line.startsWith('rename from ')) current.renamed = true;
      else if (line.startsWith('old mode ') || line.startsWith('new mode ')) current.modeChanged = true;
      else if (line.startsWith('deleted file mode ')) current.deleted = true;
      else if (line.startsWith('Binary files ') || line === 'GIT binary patch') current.binary = true;
      continue;
    }
    // File headers (`---`/`+++`) only appear before the first hunk, so inside a
    // hunk every `+`/`-` prefix is a real change (even `--- sql comment`).
    if (line.startsWith('+')) {
      current.additions += 1;
      current.added.push(line.slice(1).replace(WHITESPACE, ''));
    } else if (line.startsWith('-')) {
      current.deletions += 1;
      current.removed.push(line.slice(1).replace(WHITESPACE, ''));
    }
  }
  flush();
  return files;
}

const WHITESPACE = /\s+/g;
