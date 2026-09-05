/**
 * A small, dependency-free glob implementation tuned for matching repository
 * file paths (always forward-slash separated, never starting with "/").
 *
 * Supported syntax:
 * - `*`        any run of characters within a single path segment
 * - `?`        exactly one character within a path segment
 * - `**`       any number of path segments (including none) when used as a
 *              whole segment (`**\/foo`, `foo/**`, `a/**\/b`)
 * - `{a,b}`    alternation (may be nested)
 * - `[abc]`    character classes, passed through to the regular expression
 * - `!pattern` negation (handled by {@link compileGlobs}, not here)
 *
 * Semantics borrowed from gitignore:
 * - A pattern without a slash matches the basename at any depth
 *   (`*.snap` == `**\/*.snap`).
 * - A pattern ending in a slash matches a directory at any depth and
 *   everything inside it (`tests/` == `**\/tests/**`).
 * - A pattern containing a slash (but not starting with `**\/`) is matched
 *   against the whole path, relative to the repository root.
 */

export interface GlobOptions {
  /** Defaults to `true`. */
  readonly caseSensitive?: boolean;
}

const REGEXP_SPECIAL = /[\\^$.+()|[\]]/g;

function escapeRegExp(text: string): string {
  return text.replace(REGEXP_SPECIAL, '\\$&');
}

/** Split on top-level commas inside a `{...}` group. */
function splitAlternatives(body: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/** Expand `{a,b}` groups into a flat list of plain glob patterns. */
export function expandBraces(pattern: string): readonly string[] {
  const open = pattern.indexOf('{');
  if (open === -1) return [pattern];

  let depth = 0;
  let close = -1;
  for (let index = open; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close === -1) return [pattern];

  const prefix = pattern.slice(0, open);
  const suffix = pattern.slice(close + 1);
  const alternatives = splitAlternatives(pattern.slice(open + 1, close));
  const expanded: string[] = [];
  for (const alternative of alternatives) {
    for (const tail of expandBraces(alternative + suffix)) {
      expanded.push(prefix + tail);
    }
  }
  return expanded;
}

/** Convert a single (brace-free) glob segment to regular expression source. */
function segmentToRegExpSource(segment: string): string {
  let source = '';
  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index];
    if (char === undefined) break;
    if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else if (char === '[') {
      const end = segment.indexOf(']', index + 1);
      if (end === -1) {
        source += '\\[';
      } else {
        let body = segment.slice(index + 1, end);
        if (body.startsWith('!')) body = `^${body.slice(1)}`;
        source += `[${body.replace(/\\/g, '\\\\')}]`;
        index = end;
      }
    } else {
      source += escapeRegExp(char);
    }
  }
  return source;
}

/** Convert a brace-free glob to regular expression source. */
function plainGlobToRegExpSource(glob: string): string {
  let pattern = glob.trim();
  if (pattern.startsWith('/')) pattern = pattern.slice(1);

  const matchesDirectory = pattern.endsWith('/');
  if (matchesDirectory) pattern = pattern.slice(0, -1);

  // Basename-only patterns (and directory patterns) match at any depth.
  const anchoredAnywhere = !pattern.includes('/') || matchesDirectory;
  if (anchoredAnywhere && !pattern.startsWith('**/')) pattern = `**/${pattern}`;

  const segments = pattern.split('/');
  let source = '^';
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) continue;
    const isLast = index === segments.length - 1;
    if (segment === '**') {
      // Zero or more whole segments.
      source += isLast ? '.*' : '(?:[^/]+/)*';
      continue;
    }
    source += segmentToRegExpSource(segment);
    if (!isLast) source += '/';
  }

  if (matchesDirectory) source += '(?:/.*)?';
  source += '$';
  return source;
}

export function globToRegExp(pattern: string, options: GlobOptions = {}): RegExp {
  const alternatives = expandBraces(pattern).map(plainGlobToRegExpSource);
  const source = alternatives.length === 1 ? alternatives[0] ?? '' : `(?:${alternatives.join('|')})`;
  return new RegExp(source, options.caseSensitive === false ? 'i' : '');
}

export interface CompiledGlobs {
  /** Returns `true` when the path matches an include pattern and no exclude pattern. */
  test(path: string): boolean;
  /** Returns the first include pattern that matched (ignoring excludes), or `null`. */
  firstMatch(path: string): string | null;
}

/**
 * Compile a list of glob patterns, where patterns prefixed with `!` act as
 * exclusions that veto any include match.
 */
export function compileGlobs(patterns: readonly string[], options: GlobOptions = {}): CompiledGlobs {
  const includes: Array<{ readonly pattern: string; readonly regExp: RegExp }> = [];
  const excludes: RegExp[] = [];
  for (const raw of patterns) {
    const pattern = raw.trim();
    if (pattern === '' || pattern.startsWith('#')) continue;
    if (pattern.startsWith('!')) {
      excludes.push(globToRegExp(pattern.slice(1), options));
    } else {
      includes.push({ pattern, regExp: globToRegExp(pattern, options) });
    }
  }

  const normalize = (path: string): string => path.replace(/\\/g, '/').replace(/^\.?\//, '');

  const firstMatch = (path: string): string | null => {
    const normalized = normalize(path);
    for (const include of includes) {
      if (include.regExp.test(normalized)) return include.pattern;
    }
    return null;
  };

  return {
    firstMatch,
    test(path: string): boolean {
      const normalized = normalize(path);
      if (firstMatch(normalized) === null) return false;
      return !excludes.some((exclude) => exclude.test(normalized));
    },
  };
}
