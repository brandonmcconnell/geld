/**
 * Where a line sits in its file: the chain of declarations enclosing it
 * ("export function foldOutlineTail(" › "for (const event of tail) {"),
 * read from the file's text with no parser. A hunk's three lines of context
 * start at some line in the middle of a function; the Review tab heads each
 * hunk with this chain, pinned while the hunk scrolls, so the reader never
 * loses where they are (what editors call sticky scroll).
 *
 * Two readings. Indented languages (everything that is code): walking up
 * from the line, every non-blank line indented less than everything seen so
 * far is an enclosing line, unless it only closes something (`}`, `)`,
 * `end`); a closing line that also opens (`) {`, `} else {`) stands for the
 * line that began it, found by the same indentation above. Markdown: the
 * headings above the line, each of a lower level than the next, with fenced
 * code left out. Both are heuristics and say so by being short.
 */

export interface ScopeLine {
  /** 1-based line number in the file. */
  readonly line: number;
  /** The line's text, trimmed and shortened. */
  readonly text: string;
}

/** The most enclosing lines reported, outermost first. */
export const MAX_SCOPES = 3;
const MAX_SCOPE_CHARS = 120;

const MARKDOWN = /\.(md|mdx|markdown|mkd)$/i;
const HEADING = /^(#{1,6})\s+\S/;
const FENCE = /^\s*(```|~~~)/;
/** A line that only closes or only opens something (`}`, a JSON document's `{`), or is a comment: it names nothing, so it encloses nothing worth saying. */
const CLOSER_ONLY = /^(?:[}\])]+;?|[{(\[]+,?|end|fi|done|esac|else|\/\/.*|\/\*.*|\*.*|#.*|<!--.*)$/;
/** A closing line that opens the next part of the same construct: `) {`, `} else {`, `} catch (e) {`, `end).then do`. */
const CLOSES_THEN_OPENS = /^[}\])]/;
const OPENS = /[{(\[:]\s*$|\b(?:do|then|=>)\s*$/;

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_SCOPE_CHARS ? `${flat.slice(0, MAX_SCOPE_CHARS - 1)}…` : flat;
}

function indentOf(line: string): number {
  const match = /^[\t ]*/.exec(line);
  return match === null ? 0 : match[0].length;
}

function markdownScopes(lines: readonly string[], line: number, max: number): readonly ScopeLine[] {
  const stack: Array<ScopeLine & { readonly level: number }> = [];
  let fenced = false;
  const end = Math.min(line, lines.length);
  for (let index = 0; index < end; index += 1) {
    const text = lines[index] ?? '';
    if (FENCE.test(text)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = HEADING.exec(text);
    if (heading === null) continue;
    const level = heading[1]?.length ?? 1;
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) stack.pop();
    // The target line being a heading itself: the chain is what is above it.
    if (index === line - 1) break;
    stack.push({ line: index + 1, text: shorten(text), level });
  }
  return cap(
    stack.map(({ line: at, text }) => ({ line: at, text })),
    max,
  );
}

function indentedScopes(lines: readonly string[], line: number, max: number): readonly ScopeLine[] {
  // The reference indentation: the target line's, or the nearest non-blank line's at or after it.
  let reference = line - 1;
  while (reference < lines.length && (lines[reference] ?? '').trim() === '') reference += 1;
  if (reference >= lines.length) reference = line - 1;
  let min = indentOf(lines[reference] ?? '');
  const scopes: ScopeLine[] = [];
  for (let index = Math.min(line, lines.length) - 2; index >= 0 && min > 0; index -= 1) {
    const raw = lines[index] ?? '';
    const text = raw.trim();
    if (text === '') continue;
    const indent = indentOf(raw);
    if (indent >= min) continue;
    if (CLOSER_ONLY.test(text)) continue;
    let at = index;
    if (CLOSES_THEN_OPENS.test(text) && OPENS.test(text)) {
      // `) {` closes a signature that began above at the same indentation: that line is the scope.
      let up = index - 1;
      while (up >= 0) {
        const candidate = lines[up] ?? '';
        if (candidate.trim() !== '' && indentOf(candidate) <= indent && !CLOSES_THEN_OPENS.test(candidate.trim())) break;
        up -= 1;
      }
      if (up >= 0 && indentOf(lines[up] ?? '') === indent) at = up;
      else continue;
    }
    scopes.push({ line: at + 1, text: shorten(lines[at] ?? '') });
    min = indent;
    index = at;
  }
  return cap(scopes.reverse(), max);
}

/** Over the cap, the outermost line (the function) and the innermost ones stay; the middle goes. */
function cap(scopes: readonly ScopeLine[], max: number): readonly ScopeLine[] {
  if (scopes.length <= max) return scopes;
  const first = scopes[0];
  return first === undefined || max < 2 ? scopes.slice(-Math.max(1, max)) : [first, ...scopes.slice(-(max - 1))];
}

/**
 * The lines enclosing `line` (1-based) in `text`, outermost first, at most
 * `max`; empty at the top level. `path` picks the Markdown reading.
 */
export function enclosingScopes(text: string, line: number, path = '', max = MAX_SCOPES): readonly ScopeLine[] {
  if (line < 1) return [];
  const lines = text.split('\n');
  if (line > lines.length) return [];
  return MARKDOWN.test(path) ? markdownScopes(lines, line, max) : indentedScopes(lines, line, max);
}
