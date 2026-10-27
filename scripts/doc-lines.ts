/**
 * Keep the agent guides one sentence per line (`pnpm docs:lines`), or with
 * `--check` fail when a sentence shares a line with the next one
 * (`pnpm docs:lines:check`, part of `pnpm check`).
 *
 * Git merges by line. Written as one line per bullet, AGENTS.md had bullets
 * tens of kilobytes long, so two pull requests touching different sentences
 * of the same bullet always conflicted. One sentence per line (semantic line
 * breaks) renders the same, since a line break inside a paragraph is a space,
 * and two edits to different sentences then merge on their own.
 *
 * A line is broken after a sentence's end (`.`, `?` or `!`, closing marks
 * after it) when the next sentence starts with a capital, `**`, a code span
 * or a quote, and after a `;` when the clause after it cannot open a block;
 * never inside a code span or a fenced block, and the new line is indented to
 * its list item's content, so the Markdown means what it did. Run over a file
 * already split, it changes nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILES = ['AGENTS.md', '.cursor/BUGBOT.md'];
const ABBREVIATIONS = new Set(['e.g', 'i.e', 'vs', 'etc', 'cf', 'approx']);
const CLOSERS = new Set([')', '"', "'", '*', '_', ']']);

/** Where a sentence that starts at `at` may begin a line: a capital, bold, a code span (not a fence) or a quoted capital. */
function startsSentence(text: string, at: number): boolean {
  const char = text[at] ?? '';
  if (/[A-Z]/.test(char)) return true;
  if (text.startsWith('**', at)) return /[A-Z`"]/.test(text[at + 2] ?? '');
  if (char === '`') return !text.startsWith('```', at);
  if (char === '"') return /[A-Z]/.test(text[at + 1] ?? '');
  return false;
}

/** A clause may start a line unless its start could open a block (a list item, heading, quote, table, fence, HTML). */
function opensNoBlock(text: string, at: number): boolean {
  return at < text.length && !/^(?:[-+*#>|<=_]|\d+[.)]|```|~~~|\s)/.test(text.slice(at, at + 4));
}

function abbreviationBefore(text: string, dot: number): boolean {
  const word = /([A-Za-z.]+)$/.exec(text.slice(Math.max(0, dot - 8), dot))?.[1] ?? '';
  return ABBREVIATIONS.has(word.toLowerCase()) || /^[A-Z]$/.test(word);
}

/** The last offset of the code span opened by the backtick run at `at`, or of the run itself when nothing closes it (then it is literal, as CommonMark reads it). */
function codeSpanEnd(text: string, at: number): number {
  let run = 1;
  while (text[at + run] === '`') run++;
  for (let i = at + run; i < text.length; i++) {
    if (text[i] !== '`') continue;
    let close = 1;
    while (text[i + close] === '`') close++;
    if (close === run) return i + close - 1;
    i += close - 1;
  }
  return at + run - 1;
}

/** The offsets, in `text`, of the spaces to break at. */
function breaks(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '`') {
      i = codeSpanEnd(text, i);
      continue;
    }
    if (text[i] === ';' && text[i + 1] === ' ' && opensNoBlock(text, i + 2)) {
      out.push(i + 1);
      continue;
    }
    if (!'.?!'.includes(text[i] ?? '')) continue;
    if (text[i] === '.' && abbreviationBefore(text, i)) continue;
    let end = i + 1;
    while (CLOSERS.has(text[end] ?? '')) end++;
    if (text[end] === ' ' && startsSentence(text, end + 1)) out.push(end);
  }
  return out;
}

function splitLine(line: string): string[] {
  const indent = /^(\s*(?:[-*+]\s+|\d+[.)]\s+)?)/.exec(line)?.[1] ?? '';
  const content = line.slice(indent.length);
  if (content === '' || content.startsWith('#') || content.startsWith('|')) return [line];
  const spaces = ' '.repeat(indent.length);
  const at = breaks(content);
  if (at.length === 0) return [line];
  const pieces: string[] = [];
  let from = 0;
  for (const space of at) {
    pieces.push(content.slice(from, space));
    from = space + 1;
  }
  pieces.push(content.slice(from));
  return pieces.map((piece, index) => (index === 0 ? indent : spaces) + piece);
}

export function splitSentences(text: string): string {
  let fenced = false;
  return text
    .split('\n')
    .flatMap((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return [line];
      }
      return fenced ? [line] : splitLine(line);
    })
    .join('\n');
}

const check = process.argv.includes('--check');
const root = new URL('../', import.meta.url);
const stale: string[] = [];
for (const file of FILES) {
  const path = fileURLToPath(new URL(file, root));
  const text = readFileSync(path, 'utf8');
  const split = splitSentences(text);
  if (split === text) continue;
  if (check) stale.push(file);
  else writeFileSync(path, split);
}
if (stale.length > 0) {
  console.error(`One sentence per line: ${stale.join(', ')} has sentences sharing a line. Run \`pnpm docs:lines\`.`);
  process.exit(1);
}
