import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import type { DiffEntry } from './model';

hljs.registerLanguage('bash', bash);

const SCOPES = ['plain', 'keyword', 'built_in', 'literal', 'number', 'string', 'comment', 'variable', 'subst', 'title', 'meta', 'attr'] as const;
type Scope = (typeof SCOPES)[number];
type SyntaxRanges = Map<Scope, StaticRange[]>;
interface SourceText { readonly node: Text; readonly text: string }
interface Line { readonly number: number; readonly nodes: readonly SourceText[]; readonly text: string }
interface PaintedFile { readonly lines: readonly Line[]; readonly beforeCount: number; readonly ranges: SyntaxRanges }
const painted = new Map<HTMLElement, PaintedFile>();

function textNodes(root: Node): SourceText[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: SourceText[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Text) nodes.push({ node, text: node.data });
  }
  return nodes;
}

function linesOf(root: HTMLElement, side: 'L' | 'R'): Line[] {
  const lines: Line[] = [];
  for (const content of root.querySelectorAll<HTMLElement>('.blob-code-inner[data-code-marker], .diff-text:not(.hunk) .diff-text-inner')) {
    const cell = content.closest('td');
    if (cell === null) continue;
    const code = content.closest('.diff-text');
    const deleted = cell.classList.contains('blob-code-deletion') || code?.classList.contains('deletion') === true;
    const added = cell.classList.contains('blob-code-addition') || code?.classList.contains('addition') === true;
    if ((side === 'L' && added) || (side === 'R' && deleted)) continue;
    const numbers: Element[] = [];
    for (let sibling = cell.previousElementSibling; sibling !== null; sibling = sibling.previousElementSibling) {
      if (sibling.matches('.blob-code, .diff-text-cell')) break;
      if (sibling.matches('.blob-num, .diff-line-number')) numbers.unshift(sibling);
    }
    const anchor = /([LR])(\d+)$/.exec(cell.getAttribute('data-line-anchor') ?? '');
    const numbered = numbers.find((number) => /([LR])\d+$/.exec(number.id)?.[1] === side);
    let number: number;
    if (numbered !== undefined) number = Number(numbered.getAttribute('data-line-number'));
    else if (numbers.length === 2) number = Number(numbers[side === 'L' ? 0 : 1]?.textContent);
    else if (anchor?.[1] === side) number = Number(anchor[2]);
    else continue;
    if (!Number.isInteger(number) || number <= 0) continue;
    const nodes = textNodes(content);
    lines.push({ number, nodes, text: nodes.map((part) => part.text).join('') });
  }
  return lines;
}

function sameLines(before: readonly Line[], after: readonly Line[]): boolean {
  return before.length === after.length && before.every((line, i) => {
    const next = after[i];
    return next !== undefined && line.number === next.number && line.nodes.length === next.nodes.length &&
      line.nodes.every((part, j) => part.node === next.nodes[j]?.node && part.text === next.nodes[j]?.text);
  });
}

function scopeOf(node: Node): Scope {
  for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
    for (const scope of SCOPES) if (parent.classList.contains(`hljs-${scope}`)) return scope;
  }
  return 'plain';
}

function paintBlock(lines: readonly Line[], ranges: SyntaxRanges, skipNodes: ReadonlySet<Text>): void {
  const source = lines.map((line) => line.text).join('\n');
  if (source.length > 100_000) return;
  // Only highlight.js's escaped output is parsed, in a detached template. GitHub's nodes stay untouched.
  const template = document.createElement('template');
  template.innerHTML = hljs.highlight(source, { language: 'bash', ignoreIllegals: true }).value;
  const sourceNodes: { readonly node: Text; readonly start: number; readonly end: number }[] = [];
  let offset = 0;
  for (const line of lines) {
    for (const part of line.nodes) {
      sourceNodes.push({ node: part.node, start: offset, end: offset + part.text.length });
      offset += part.text.length;
    }
    offset += 1;
  }
  let index = 0;
  offset = 0;
  for (const part of textNodes(template.content)) {
    const end = offset + part.text.length;
    const scope = scopeOf(part.node);
    while (index < sourceNodes.length) {
      const original = sourceNodes[index];
      if (original === undefined || original.start >= end) break;
      const start = Math.max(offset, original.start);
      const stop = Math.min(end, original.end);
      if (start < stop && !skipNodes.has(original.node)) {
        const range = new StaticRange({
          startContainer: original.node, startOffset: start - original.start,
          endContainer: original.node, endOffset: stop - original.start,
        });
        const group = ranges.get(scope) ?? [];
        group.push(range);
        ranges.set(scope, group);
      }
      if (original.end > end) break;
      index += 1;
    }
    offset = end;
  }
}

/**
 * Every multiline `run` block on one side, painted with the shell GitHub would run it with: the step's own
 * `shell`, else the job's `defaults.run.shell`, else the workflow's, else the runner's default (PowerShell on a
 * Windows runner, Bash otherwise). The blocks are collected first and their shell chosen once the whole visible
 * side is read, since YAML key order changes nothing: a job may name its runner or its defaults after its steps,
 * and a step its shell after its script.
 */
function highlightRuns(lines: readonly Line[], ranges: SyntaxRanges, skipNodes: ReadonlySet<Text>): void {
  const blocks: { readonly lines: readonly Line[]; readonly job: number; readonly step: number }[] = [];
  const stepShells = new Map<number, string>();
  const jobShells = new Map<number, string>();
  const runnerShells = new Map<number, string>();
  // A job section that follows a gap in the diff: the gap may hide the next job's name, so what it reads is its own,
  // and it only falls back on what the section before it read.
  const parents = new Map<number, number>();
  let workflowShell = '';
  let block: Line[] = [];
  let runIndent = -1;
  let stepIndent = -1;
  let jobIndent = -1;
  let jobsIndent = -1;
  // Another block scalar's text (`script: |`): its lines are a string, never keys.
  let scalarIndent = -1;
  // The keys the current line stands under, by indent, so a default shell is told from any other `shell` key.
  const keys: { readonly indent: number; readonly key: string }[] = [];
  let job = 0;
  let step = 0;
  let previous = 0;
  const flush = (): void => {
    if (block.length > 0) blocks.push({ lines: block, job, step });
    block = [];
    runIndent = -1;
  };
  for (const line of lines) {
    const indent = line.text.search(/\S/);
    if (line.number !== previous + 1) {
      flush();
      stepIndent = -1;
      scalarIndent = -1;
      keys.length = 0;
      step += 1;
      parents.set(job + 1, job);
      job += 1;
    }
    previous = line.number;
    if (runIndent >= 0 && (indent === -1 || indent > runIndent)) {
      block.push(line);
      continue;
    }
    runIndent = -1;
    if (scalarIndent >= 0 && (indent === -1 || indent > scalarIndent)) continue;
    scalarIndent = -1;
    // A key may be quoted (`'defaults':`, `"runs-on":`); it is the same key, so it is read unquoted.
    const text = line.text.replace(/^(\s*(?:-\s+)?)(['"])([\w.-]+)\2(\s*:)/, '$1$3$4');
    const keyMatch = /^(\s*(?:-\s+)?)([\w.-]+)\s*:(.*)$/.exec(text);
    if (keyMatch !== null) {
      const keyIndent = keyMatch[1]?.length ?? 0;
      while ((keys[keys.length - 1]?.indent ?? -1) >= keyIndent) keys.pop();
      keys.push({ indent: keyIndent, key: keyMatch[2] ?? '' });
      if (keyMatch[2] !== 'run' && /^\s*[|>][1-9+-]*\s*(?:#.*)?$/.test(keyMatch[3] ?? '')) scalarIndent = keyIndent;
    }
    const jobs = /^(\s*)jobs:\s*(?:#.*)?$/.exec(text);
    if (jobs !== null) jobsIndent = jobs[1]?.length ?? 0;
    else if (jobsIndent >= 0 && jobIndent < 0 && indent > jobsIndent && !text.trimStart().startsWith('#')) jobIndent = indent;
    if (jobIndent >= 0 && indent >= 0 && indent <= jobIndent) {
      flush();
      stepIndent = -1;
      job += 1;
      step += 1;
    }
    const runner = /^(\s*)runs-on:\s*(.*)$/.exec(text);
    if (runner !== null) {
      jobIndent = (runner[1]?.length ?? 0) - 2;
      runnerShells.set(job, /windows/i.test(runner[2] ?? '') ? 'pwsh' : /\$\{\{/.test(runner[2] ?? '') ? 'unknown' : '');
    }
    const stepLine = /^(\s*)-\s+\w[^:]*:/.exec(text);
    if (stepLine !== null || (stepIndent >= 0 && indent >= 0 && indent <= stepIndent)) {
      flush();
      stepIndent = stepLine?.[1]?.length ?? -1;
      step += 1;
    }
    const shellMatch = /^\s*(?:-\s+)?shell:\s*['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/.exec(text);
    if (shellMatch?.[1] !== undefined && (stepIndent < 0 || indent === stepIndent + 2 || (stepLine !== null && indent === stepIndent))) {
      const shell = shellMatch[1].trim();
      // Outside a step only `defaults.run.shell` chooses a shell (a `shell` under `env` is a variable): the
      // workflow's when `defaults` is a top-level key, a job's otherwise.
      const defaults = keys[keys.length - 3];
      if (stepIndent >= 0) stepShells.set(step, shell);
      else if (keys[keys.length - 2]?.key === 'run' && defaults?.key === 'defaults') {
        if (defaults.indent === 0) workflowShell = shell;
        else jobShells.set(job, shell);
      }
    }
    const run = /^(\s*)(-\s+)?run:\s*[|>][1-9+-]*\s*(?:#.*)?$/.exec(text);
    if (run !== null) {
      runIndent = (run[1]?.length ?? 0) + (run[2]?.length ?? 0);
      if (stepIndent < 0) stepIndent = runIndent - 2;
    }
  }
  flush();
  const inherited = (settings: ReadonlyMap<number, string>, from: number): string | undefined => {
    for (let at: number | undefined = from; at !== undefined; at = parents.get(at)) if (settings.has(at)) return settings.get(at);
    return undefined;
  };
  for (const found of blocks) {
    const shell = stepShells.get(found.step) ?? inherited(jobShells, found.job) ?? (workflowShell || inherited(runnerShells, found.job) || '');
    if (shell === '' || /^(?:bash|sh)(?:\s|$)/.test(shell)) paintBlock(found.lines, ranges, skipNodes);
  }
}

function setHighlights(): void {
  for (const scope of SCOPES) {
    const highlight = new Highlight();
    for (const file of painted.values()) for (const range of file.ranges.get(scope) ?? []) highlight.add(range);
    if (highlight.size === 0) CSS.highlights.delete(`geld-shell-${scope}`);
    else CSS.highlights.set(`geld-shell-${scope}`, highlight);
  }
}

export function applyWorkflowSyntax(entries: readonly DiffEntry[]): void {
  if (typeof CSS === 'undefined' || CSS.highlights === undefined || typeof Highlight === 'undefined' || typeof StaticRange === 'undefined') return;
  const roots = new Set<HTMLElement>();
  let changed = false;
  for (const entry of entries) {
    if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(entry.path)) continue;
    roots.add(entry.root);
    const before = linesOf(entry.root, 'L');
    const after = linesOf(entry.root, 'R');
    const lines = [...before, ...after];
    const cached = painted.get(entry.root);
    if (cached !== undefined && cached.beforeCount === before.length && sameLines(cached.lines, lines)) continue;
    const ranges: SyntaxRanges = new Map();
    // Shared context is painted from the new side, where an edited quote may give it a different meaning.
    highlightRuns(before, ranges, new Set(after.flatMap((line) => line.nodes.map((part) => part.node))));
    highlightRuns(after, ranges, new Set());
    painted.set(entry.root, { lines, beforeCount: before.length, ranges });
    changed = true;
  }
  for (const root of painted.keys()) if (!roots.has(root)) { painted.delete(root); changed = true; }
  if (changed) setHighlights();
}

export function removeWorkflowSyntax(): void {
  painted.clear();
  if (typeof CSS === 'undefined' || CSS.highlights === undefined) return;
  for (const scope of SCOPES) CSS.highlights.delete(`geld-shell-${scope}`);
}
