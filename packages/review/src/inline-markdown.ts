/**
 * The inline subset of Markdown a one-line preview can carry: `code`,
 * **bold**, *italic* / _italic_ and ~~strikethrough~~. Titles and previews
 * are built from comment text (the crawler writes these marks back from
 * GitHub's rendered HTML; the Action reads them from the raw body), so a
 * title keeps the `identifier` or **must** its author wrote, and each surface
 * renders the runs its own way. Nothing block-level is understood here — a
 * preview is one line — and unmatched markers stay as written.
 */

export type InlineMark = 'code' | 'strong' | 'em' | 'del';

export interface InlineRun {
  readonly text: string;
  /** Outermost first; empty for plain text. */
  readonly marks: readonly InlineMark[];
}

interface Delimiter {
  readonly token: string;
  readonly mark: InlineMark;
}

const DELIMITERS: readonly Delimiter[] = [
  { token: '**', mark: 'strong' },
  { token: '__', mark: 'strong' },
  { token: '~~', mark: 'del' },
  { token: '*', mark: 'em' },
  { token: '_', mark: 'em' },
];

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

/**
 * Split `text` into runs. Code spans are found first and never contain other
 * marks; emphasis closes at the nearest matching token and nests; an
 * underscore inside a word (`snake_case`) is a character, not a marker.
 */
export function parseInlineMarkdown(text: string): readonly InlineRun[] {
  const runs: InlineRun[] = [];
  const push = (value: string, marks: readonly InlineMark[]): void => {
    if (value === '') return;
    const last = runs[runs.length - 1];
    if (last !== undefined && sameMarks(last.marks, marks)) runs[runs.length - 1] = { text: last.text + value, marks };
    else runs.push({ text: value, marks });
  };

  const walk = (input: string, marks: readonly InlineMark[]): void => {
    let index = 0;
    let plainStart = 0;
    const flush = (end: number): void => {
      push(input.slice(plainStart, end), marks);
    };
    while (index < input.length) {
      const char = input[index] ?? '';
      if (char === '`') {
        const run = /^`+/.exec(input.slice(index))?.[0] ?? '`';
        const close = input.indexOf(run, index + run.length);
        if (close !== -1) {
          flush(index);
          const inner = input.slice(index + run.length, close);
          // CommonMark strips one space each side when both are present and the span is not all spaces.
          const trimmed = inner.startsWith(' ') && inner.endsWith(' ') && inner.trim() !== '' ? inner.slice(1, -1) : inner;
          push(trimmed, [...marks, 'code']);
          index = close + run.length;
          plainStart = index;
          continue;
        }
        index += run.length;
        continue;
      }
      const delimiter = DELIMITERS.find(({ token }) => input.startsWith(token, index));
      if (delimiter !== undefined && !marks.includes(delimiter.mark)) {
        const { token, mark } = delimiter;
        const before = input[index - 1];
        const after = input[index + token.length];
        // Opens only when it leads into text, and (for underscores) not from inside a word.
        const opens = after !== undefined && !/\s/.test(after) && after !== token[0] && !(token.startsWith('_') && isWordChar(before));
        if (opens) {
          const close = findClose(input, index + token.length, token);
          if (close !== -1) {
            flush(index);
            walk(input.slice(index + token.length, close), [...marks, mark]);
            index = close + token.length;
            plainStart = index;
            continue;
          }
        }
        index += token.length;
        continue;
      }
      index += 1;
    }
    flush(input.length);
  };

  walk(text, []);
  return runs;
}

/** The closing `token` for a span opened before `from`: outside code spans, after non-space, not inside a word for underscores. */
function findClose(input: string, from: number, token: string): number {
  let index = from;
  while (index < input.length) {
    const char = input[index] ?? '';
    if (char === '`') {
      const run = /^`+/.exec(input.slice(index))?.[0] ?? '`';
      const close = input.indexOf(run, index + run.length);
      index = close === -1 ? index + run.length : close + run.length;
      continue;
    }
    if (input.startsWith(token, index)) {
      const before = input[index - 1];
      const after = input[index + token.length];
      const closes = before !== undefined && !/\s/.test(before) && !(token.startsWith('_') && isWordChar(after));
      if (closes) return index;
    }
    index += 1;
  }
  return -1;
}

function sameMarks(a: readonly InlineMark[], b: readonly InlineMark[]): boolean {
  return a.length === b.length && a.every((mark, index) => mark === b[index]);
}

/** The text alone, markers removed — for places that take plain text (tooltips, `aria-label`s, clipboard titles). */
export function stripInlineMarkdown(text: string): string {
  return parseInlineMarkdown(text)
    .map((run) => run.text)
    .join('');
}
