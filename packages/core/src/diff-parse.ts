/** Per-file line statistics. */
export interface FileStats {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
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
  let current: { path: string; additions: number; deletions: number } | null = null;
  let inHunk = false;

  const flush = (): void => {
    if (current !== null) files.push({ ...current });
    current = null;
  };

  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      const path = pathFromGitHeader(line);
      current = path === null ? null : { path, additions: 0, deletions: 0 };
      inHunk = false;
      continue;
    }
    if (current === null) continue;

    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      // Renames without content changes have no hunks; the `rename to` line
      // is the most accurate path in that case.
      if (line.startsWith('rename to ')) current.path = line.slice('rename to '.length);
      continue;
    }
    // File headers (`---`/`+++`) only appear before the first hunk, so inside a
    // hunk every `+`/`-` prefix is a real change (even `--- sql comment`).
    if (line.startsWith('+')) current.additions += 1;
    else if (line.startsWith('-')) current.deletions += 1;
  }
  flush();
  return files;
}
