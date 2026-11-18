/**
 * The triage's suggested fixes. Each open finding sits on a review thread whose lines GitHub knows, and a fix is a
 * replacement for exactly those lines: it can then be posted as a `suggestion` in that thread and committed with
 * GitHub's own suggestion machinery, so nothing outside the lines the reviewer pointed at is ever touched. A fix the
 * lines cannot hold is left as a sentence for a coding agent instead. Findings that report one problem share one fix.
 */

import { z } from 'zod';

export const SUGGEST_SYSTEM = `You propose code fixes for the open review findings on a pull request, for a reviewer to preview, apply or discard.
You get the pull request's title and description (what it sets out to do) and, per finding, what the reviewers said and the code around it.
Rules:
- Each finding has "target": the lines its review thread is on ("start" to "end", inclusive) and "text", those lines exactly. A fix replaces exactly the target lines: "replacement" is the full new text of those lines, indented as the file is. It may have more or fewer lines than the target.
- Propose a fix only when the finding is right, the change follows from what was said and the code, and it fits inside the target lines. Otherwise set "replacement" to null and say in "summary" what change is needed and where.
- "summary": one sentence, what the fix does or what is needed. Wrap code, symbols and file names in backticks.
- Findings that report the same problem (two reviewers on one bug, or listed in "sameProblemAs"): one entry with all their ids, first the id whose target the replacement fills.
- Every finding id appears in exactly one entry. Never invent findings. Return JSON only, matching the schema.`;

export interface SuggestTarget {
  readonly start: number;
  readonly end: number;
  /** The target lines exactly, joined with newlines. */
  readonly text: string;
}

export interface SuggestInputItem {
  /** The thread's key: its first comment's anchor, which stays when replies join. */
  readonly id: string;
  readonly title: string;
  readonly context?: string;
  readonly path: string;
  /** What each reviewer said, trimmed. */
  readonly excerpts: readonly string[];
  readonly target: SuggestTarget;
  /** The lines around the target, each led by its number. */
  readonly around: string;
  readonly sameProblemAs?: readonly string[];
}

export interface SuggestPullRequest {
  readonly title: string;
  readonly description: string;
}

export function suggestUserPrompt(pull: SuggestPullRequest, items: readonly SuggestInputItem[]): string {
  return JSON.stringify({ pullRequest: pull, findings: items }, null, 2);
}

export const SUGGEST_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestions'],
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ids', 'summary', 'replacement'],
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
          replacement: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
    },
  },
} as const;

const suggestOutputSchema = z.object({
  suggestions: z.array(
    z.object({
      ids: z.array(z.string().min(1)).min(1),
      summary: z.string().max(600),
      replacement: z.string().max(20_000).nullish(),
    }),
  ),
});

export interface SuggestOutput {
  /** The findings this answers, the first being the thread the replacement is for. */
  readonly ids: readonly string[];
  readonly summary: string;
  /** The new text of the first finding's target lines, or null when no fix fits there. */
  readonly replacement: readonly string[] | null;
}

/** The text as lines, without the one newline a model adds at the end. */
export function textLines(text: string): readonly string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * The model's answer, kept to what can be trusted: known ids only, each in one entry (the first that names it), every
 * asked id answered (a finding the model skipped gets an entry saying nothing fits, so it is not asked again), and a
 * replacement that changes nothing dropped.
 */
export function parseSuggestOutput(text: string, items: readonly SuggestInputItem[]): readonly SuggestOutput[] | null {
  let json: unknown;
  try {
    json = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, ''));
  } catch {
    return null;
  }
  const parsed = suggestOutputSchema.safeParse(json);
  if (!parsed.success) return null;
  const byId = new Map(items.map((item) => [item.id, item]));
  const taken = new Set<string>();
  const out: SuggestOutput[] = [];
  for (const entry of parsed.data.suggestions) {
    const ids = [...new Set(entry.ids)].filter((id) => byId.has(id) && !taken.has(id));
    const primary = ids[0] === undefined ? undefined : byId.get(ids[0]);
    if (primary === undefined) continue;
    for (const id of ids) taken.add(id);
    const replacement = entry.replacement === null || entry.replacement === undefined ? null : textLines(entry.replacement);
    const unchanged = replacement !== null && replacement.join('\n') === textLines(primary.target.text).join('\n');
    out.push({ ids, summary: entry.summary.trim(), replacement: unchanged ? null : replacement });
  }
  for (const item of items) if (!taken.has(item.id)) out.push({ ids: [item.id], summary: '', replacement: null });
  return out;
}

export const BODY_SYSTEM = `You read one comment on a pull request (a review's own words, a bot's run summary or a person's remark) and list the code changes it asks for, for a coding agent to make.
The comment's threads are listed under "threads": they are reported on their own, so leave out anything they cover.
Rules:
- One entry per change asked for: findings outside the diff, failed checks, requests in the comment's own words.
- "title": what is wrong, a few words, sentence case, no period. "task": one or two sentences saying what to change and where. Wrap code, symbols and file names in backticks.
- "path" and "line": the file and the line the change is at when the comment names them, else null.
- Leave out praise, walkthroughs, summaries of what the pull request does, and questions that ask for no change.
- Return {"findings": []} when it asks for nothing. Never invent findings. Return JSON only, matching the schema.`;

export interface BodyInput {
  readonly author: string;
  readonly text: string;
  /** The titles of the threads the comment came with. */
  readonly threads: readonly string[];
}

export function bodyUserPrompt(pull: SuggestPullRequest, input: BodyInput): string {
  return JSON.stringify({ pullRequest: pull, comment: { author: input.author, text: input.text }, threads: input.threads }, null, 2);
}

export const BODY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'task', 'path', 'line'],
        properties: {
          title: { type: 'string' },
          task: { type: 'string' },
          path: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          line: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
        },
      },
    },
  },
} as const;

const bodyOutputSchema = z.object({
  findings: z.array(
    z.object({
      title: z.string().max(200),
      task: z.string().max(1_000),
      path: z.string().max(500).nullish(),
      line: z.number().int().nullish(),
    }),
  ),
});

/** A change a comment asks for outside its threads: no thread holds it, so it goes to an agent rather than a suggestion. */
export interface BodyFinding {
  readonly title: string;
  readonly task: string;
  readonly path: string | null;
  readonly line: number | null;
}

/** The model's findings, each with a title and a task; at most 12, since one comment asking for more is a plan, not findings. */
export function parseBodyOutput(text: string): readonly BodyFinding[] | null {
  let json: unknown;
  try {
    json = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, ''));
  } catch {
    return null;
  }
  const parsed = bodyOutputSchema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data.findings
    .map((finding) => ({ title: finding.title.trim(), task: finding.task.trim(), path: finding.path?.trim() || null, line: finding.line !== null && finding.line !== undefined && finding.line > 0 ? finding.line : null }))
    .filter((finding) => finding.title !== '' && finding.task !== '')
    .slice(0, 12);
}

export type DiffLineKind = 'context' | 'del' | 'add';

export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly text: string;
  /** The line's number in the file before the change (context and deleted lines). */
  readonly before?: number;
  /** Its number after the change (context and added lines). */
  readonly after?: number;
}

const MAX_DIFF_CELLS = 250_000;

/** A line diff of `before` (starting at line `start` of the file) and `after`, by longest common subsequence. */
export function lineDiff(before: readonly string[], after: readonly string[], start = 1): readonly DiffLine[] {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail += 1;
  const a = before.slice(head, before.length - tail);
  const b = after.slice(head, after.length - tail);
  const middle: Array<{ readonly kind: DiffLineKind; readonly text: string }> = [];
  if (a.length * b.length > MAX_DIFF_CELLS) {
    for (const text of a) middle.push({ kind: 'del', text });
    for (const text of b) middle.push({ kind: 'add', text });
  } else {
    const width = b.length + 1;
    const table = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        table[i * width + j] = a[i] === b[j] ? (table[(i + 1) * width + j + 1] ?? 0) + 1 : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
      }
    }
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
      const left = a[i];
      const right = b[j];
      if (left !== undefined && right !== undefined && left === right) {
        middle.push({ kind: 'context', text: left });
        i += 1;
        j += 1;
      } else if (right === undefined || (left !== undefined && (table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0))) {
        middle.push({ kind: 'del', text: left ?? '' });
        i += 1;
      } else {
        middle.push({ kind: 'add', text: right });
        j += 1;
      }
    }
  }
  const lines = [...before.slice(0, head).map((text) => ({ kind: 'context' as const, text })), ...middle, ...before.slice(before.length - tail).map((text) => ({ kind: 'context' as const, text }))];
  let old = start;
  let neu = start;
  return lines.map((line) => {
    if (line.kind === 'context') return { kind: line.kind, text: line.text, before: old++, after: neu++ };
    if (line.kind === 'del') return { kind: line.kind, text: line.text, before: old++ };
    return { kind: line.kind, text: line.text, after: neu++ };
  });
}

/** A diff row as shown: a line, or unchanged lines folded away between two changes. */
export type DiffRow = DiffLine | { readonly kind: 'gap'; readonly hidden: number };

/**
 * The diff as GitHub shows a hunk: `context` unchanged lines kept on each side of a change, and a longer unchanged
 * stretch between two changes folded into one gap row, so a fix across a wide range reads as its changes. Unchanged
 * lines before the first change and after the last are left out, not folded: the line numbers say where the snippet
 * starts, and a gap row at an edge read as lines missing from the file.
 */
export function diffHunks(lines: readonly DiffLine[], context = 3): readonly DiffRow[] {
  const keep = lines.map((_, index) => lines.slice(Math.max(0, index - context), index + context + 1).some((line) => line.kind !== 'context'));
  // A fold of one line hides nothing worth folding.
  keep.forEach((kept, index) => {
    if (!kept && keep[index - 1] !== false && keep[index + 1] !== false) keep[index] = true;
  });
  const rows: DiffRow[] = [];
  let hidden = 0;
  lines.forEach((line, index) => {
    if (keep[index] === true) {
      if (hidden > 0 && rows.length > 0) rows.push({ kind: 'gap', hidden });
      hidden = 0;
      rows.push(line);
    } else hidden += 1;
  });
  return rows;
}

export function diffCounts(lines: readonly DiffLine[]): { readonly added: number; readonly removed: number } {
  return { added: lines.filter((line) => line.kind === 'add').length, removed: lines.filter((line) => line.kind === 'del').length };
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Model prose with the pull request's file names in code spans, where the model left them bare: every path given and
 * its last segment, never inside an existing code span or the middle of a longer word or path.
 */
export function codeSpans(text: string, paths: readonly string[]): string {
  const names = [...new Set(paths.flatMap((path) => [path, path.split('/').pop() ?? '']))].filter((name) => name.length >= 3 && /[./]/.test(name)).sort((a, b) => b.length - a.length);
  if (names.length === 0) return text;
  const pattern = new RegExp(`(?<![\\w./@-])(${names.map(escapeRegExp).join('|')})(?![\\w/-]|\\.\\w)`, 'g');
  return text
    .split(/(`[^`]*`)/)
    .map((part) => (part.startsWith('`') && part.endsWith('`') && part.length > 1 ? part : part.replace(pattern, '`$1`')))
    .join('');
}

/** A reply to the finding's thread proposing `replacement` for its lines, as GitHub renders and commits a suggestion. */
export function suggestionReplyBody(replacement: readonly string[], summary: string): string {
  const longest = Math.max(0, ...[...replacement.join('\n').matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  const lead = summary.trim() === '' ? 'Suggested fix from Geld triage.' : `Suggested fix from Geld triage: ${summary.trim()}`;
  return `${lead}\n\n${fence}suggestion\n${replacement.join('\n')}\n${fence}`;
}

/** The lines `start`..`end` with their numbers, and `margin` lines either side, as the model is shown them. */
export function numberedLines(lines: readonly string[], start: number, end: number, margin: number): string {
  const from = Math.max(1, start - margin);
  const to = Math.min(lines.length, end + margin);
  const width = String(to).length;
  const out: string[] = [];
  for (let number = from; number <= to; number += 1) out.push(`${String(number).padStart(width, ' ')}${number >= start && number <= end ? '>' : ' '} ${lines[number - 1] ?? ''}`);
  return out.join('\n');
}
