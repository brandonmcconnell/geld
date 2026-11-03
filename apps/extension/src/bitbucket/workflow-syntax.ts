import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import type { Scalar, YAMLMap } from 'yaml';
import { SHELL_SCOPES, paintBlock, sameLines, textNodes } from '../lib/shell-highlight';
import type { ShellLine, ShellRanges, SourceText } from '../lib/shell-highlight';
import type { ProviderDiffEntry } from '../providers/types';

interface LocatedLine { readonly line: ShellLine; readonly start: number; readonly end: number }
interface Source { readonly text: string; readonly lines: readonly LocatedLine[] }
interface PaintedFile { readonly lines: readonly ShellLine[]; readonly beforeCount: number; readonly ranges: ShellRanges }
const painted = new Map<HTMLElement, PaintedFile>();
const PREFIX = 'geld-bitbucket-shell-';

function linesOf(entry: ProviderDiffEntry, side: 'old' | 'new'): ShellLine[] {
  const result: ShellLine[] = [];
  for (const row of entry.readLines?.() ?? []) {
    const number = side === 'old' ? row.oldLine : row.newLine;
    const text = side === 'old' ? row.oldText : row.newText;
    if (number === null || text === null || row.kind === 'hunk') continue;
    const content = row.root.querySelector<HTMLElement>('[data-line-type]');
    if (content === null || content.closest('[data-geld-ui]') !== null) continue;
    const nodes = textNodes(content);
    // Refuse a changed/mismatched native surface rather than paint line numbers or markers.
    if (nodes.map((part) => part.text).join('') !== text) continue;
    result.push({ number, text, nodes });
  }
  return result;
}

function sourceOf(lines: readonly ShellLine[]): Source {
  let offset = 0;
  return { text: lines.map((line) => line.text).join('\n') + '\n', lines: lines.map((line) => {
    const start = offset;
    offset += line.text.length + 1;
    return { line, start, end: offset - 1 };
  }) };
}

function sliced(line: ShellLine, start: number, end: number): ShellLine {
  let offset = 0;
  const nodes: SourceText[] = [];
  for (const part of line.nodes) {
    const first = Math.max(start, offset);
    const last = Math.min(end, offset + part.text.length);
    if (first < last) nodes.push({ node: part.node, text: part.text.slice(first - offset, last - offset), offset: (part.offset ?? 0) + first - offset });
    offset += part.text.length;
  }
  return { number: line.number, text: line.text.slice(start, end), nodes };
}

function keyOf(value: unknown): string | null {
  return isScalar(value) && typeof value.value === 'string' ? value.value : null;
}

function field(map: YAMLMap, key: string): unknown {
  return map.items.find((pair) => keyOf(pair.key) === key)?.value;
}

function hasMerge(map: YAMLMap): boolean {
  return map.items.some((pair) => keyOf(pair.key) === '<<');
}

/** Hosted Docker steps use /bin/sh; an explicit Linux Shell runner uses Bash.
 * A complete visible mapping is required before absence of runs-on/merge is meaningful. */
function supportedShell(step: YAMLMap): boolean {
  if (hasMerge(step) || step.tag !== undefined || step.flow === true) return false;
  const runner = step.items.find((pair) => keyOf(pair.key) === 'runs-on');
  if (runner === undefined) return true;
  if (!isSeq(runner.value)) return false;
  const labels: string[] = [];
  for (const item of runner.value.items) {
    if (!isScalar(item) || typeof item.value !== 'string' || item.tag !== undefined || item.anchor !== undefined ||
      !['PLAIN', 'QUOTE_SINGLE', 'QUOTE_DOUBLE'].includes(item.type ?? '') || item.value.includes('$') || item.value.includes('`')) return false;
    labels.push(item.value);
  }
  return labels.includes('self.hosted') && labels.includes('linux.shell') &&
    !labels.some((label) => /^(?:windows|macos|linux)(?:\.|$)/.test(label) && label !== 'linux.shell');
}

function completeStep(source: Source, key: unknown, step: YAMLMap, base: number, contextStart: number): boolean {
  if (!isScalar(key) || key.range == null || step.range == null) return false;
  const start = key.range[0] + base;
  const keyLine = source.lines.find((line) => line.start <= start && line.end >= start);
  if (keyLine === undefined) return false;
  const indent = start - keyLine.start;
  const end = step.range[1] + base;
  // End-of-hunk is not end-of-step: later hidden keys may select Windows or inherit a merge.
  const next = source.lines.find((line) => line.start >= end && line.line.text.trim() !== '' && !line.line.text.trimStart().startsWith('#'));
  if (next === undefined || next.line.text.search(/\S/) > indent) return false;
  const context = source.lines.filter((line) => line.end >= contextStart && line.start <= next.start);
  return context.length > 0 && context.every((line, index) => index === 0 || line.line.number === (context[index - 1]?.line.number ?? 0) + 1);
}

function scalarLines(value: Scalar, source: Source, base: number): readonly ShellLine[] | null {
  if (typeof value.value !== 'string' || value.range == null || value.tag !== undefined || value.anchor !== undefined) return null;
  const start = value.range[0] + base;
  const end = value.range[1] + base;
  if (value.type === 'PLAIN') {
    const line = source.lines.find((part) => part.start <= start && part.end >= end);
    const raw = source.text.slice(start, end);
    if (line === undefined || raw !== value.value) return null;
    return [sliced(line.line, start - line.start, end - line.start)];
  }
  if (value.type !== 'BLOCK_LITERAL') return null;
  const headerEnd = source.text.indexOf('\n', start);
  if (headerEnd < 0 || headerEnd >= end) return null;
  const body = source.lines.filter((line) => line.start > headerEnd && line.start < end);
  const nonempty = body.filter((line) => line.line.text.trim() !== '');
  if (nonempty.length === 0) return null;
  const indent = Math.min(...nonempty.map((line) => line.line.text.search(/\S/)));
  const lines = body.map((line) => sliced(line.line, Math.min(indent, line.line.text.length), line.line.text.length));
  // Chomping only affects terminal newlines. Any other decoding difference needs a richer source map.
  if (lines.map((line) => line.text).join('\n').replace(/\n+$/, '') !== value.value.replace(/\n+$/, '')) return null;
  return lines;
}

function paintCommands(value: unknown, source: Source, base: number, ranges: ShellRanges, skip: ReadonlySet<Text>): void {
  if (!isSeq(value) || value.tag !== undefined || value.flow === true) return;
  let program: ShellLine[] = [];
  const flush = (): void => { if (program.length > 0) paintBlock(program, ranges, skip); program = []; };
  for (const command of value.items) {
    const lines = isScalar(command) ? scalarLines(command, source, base) : null;
    // Pipe/variables mappings, aliases, quotes and folded YAML remain native and break shell state.
    if (lines === null) flush();
    else program.push(...lines);
  }
  flush();
}

function paintSection(root: YAMLMap, source: Source, base: number, ranges: ShellRanges, skip: ReadonlySet<Text>): void {
  const step = (map: YAMLMap, contextStart: number): void => {
    if (hasMerge(map) || map.flow === true || map.tag !== undefined) return;
    const pair = map.items.find((item) => keyOf(item.key) === 'step');
    if (pair === undefined || !isMap(pair.value) || !completeStep(source, pair.key, pair.value, base, contextStart) || !supportedShell(pair.value)) return;
    paintCommands(field(pair.value, 'script'), source, base, ranges, skip);
    // after-script is a distinct shell execution phase, never a continuation of script.
    paintCommands(field(pair.value, 'after-script'), source, base, ranges, skip);
  };
  const item = (value: unknown, depth: number, contextStart: number): void => {
    if (depth > 20 || !isMap(value) || hasMerge(value) || value.flow === true || value.tag !== undefined) return;
    step(value, contextStart);
    const parallel = field(value, 'parallel');
    if (isSeq(parallel)) sequence(parallel, depth + 1, contextStart);
    else if (isMap(parallel) && !hasMerge(parallel)) sequence(field(parallel, 'steps'), depth + 1, contextStart);
    const stage = field(value, 'stage');
    if (isMap(stage) && !hasMerge(stage)) sequence(field(stage, 'steps'), depth + 1, contextStart);
  };
  const sequence = (value: unknown, depth: number, contextStart: number): void => {
    if (isSeq(value) && value.tag === undefined) for (const child of value.items) item(child, depth + 1, contextStart);
  };
  for (const pair of root.items) {
    const key = keyOf(pair.key);
    if (!isScalar(pair.key) || pair.key.range == null) continue;
    const contextStart = pair.key.range[0] + base;
    if (key === 'definitions' && isMap(pair.value) && !hasMerge(pair.value)) sequence(field(pair.value, 'steps'), 0, contextStart);
    else if (key === 'pipelines' && isMap(pair.value) && !hasMerge(pair.value)) {
      for (const pipeline of pair.value.items) {
        const name = keyOf(pipeline.key);
        if (name === 'default') sequence(pipeline.value, 0, contextStart);
        else if (['branches', 'tags', 'pull-requests', 'custom'].includes(name ?? '') && isMap(pipeline.value) && !hasMerge(pipeline.value)) {
          for (const selector of pipeline.value.items) sequence(selector.value, 0, contextStart);
        }
      }
    } else if (isMap(pair.value) && pair.value.anchor !== undefined && !['image', 'options', 'clone', 'definitions', 'pipelines', 'variables', 'export'].includes(key ?? '')) item(pair.value, 0, contextStart);
  }
}

function parsedSection(text: string): YAMLMap | null {
  try {
    const document = parseDocument(text, { keepSourceTokens: true, uniqueKeys: true });
    return document.errors.length === 0 && document.warnings.length === 0 && isMap(document.contents) ? document.contents : null;
  } catch {
    // Native source is untrusted. A malformed/deep parser input must leave the diff readable.
    return null;
  }
}

function highlightSide(lines: readonly ShellLine[], ranges: ShellRanges, skip: ReadonlySet<Text>): void {
  // Missing native text may open a quoted scalar before an apparent declaration. Never recover
  // schema context after a gap, even if the assembled projection would parse as a mapping.
  if (lines[0]?.number !== 1) return;
  let end = 1;
  while (end < lines.length && lines[end]?.number === (lines[end - 1]?.number ?? 0) + 1) end += 1;
  const source = sourceOf(lines.slice(0, end));
  if (source.text.length > 100_000) return;
  const root = parsedSection(source.text);
  if (root !== null) paintSection(root, source, 0, ranges, skip);
  // The entire eligible prefix is parsed before choosing declarations, never regex-split out
  // of scalar text. Declared anchors do not resolve later alias/callsite runner overrides.
}

function setHighlights(): void {
  for (const scope of SHELL_SCOPES) {
    const highlight = new Highlight();
    for (const file of painted.values()) for (const range of file.ranges.get(scope) ?? []) highlight.add(range);
    if (highlight.size === 0) CSS.highlights.delete(PREFIX + scope);
    else CSS.highlights.set(PREFIX + scope, highlight);
  }
}

export function applyBitbucketWorkflowSyntax(entries: readonly ProviderDiffEntry[]): void {
  if (typeof CSS === 'undefined' || CSS.highlights === undefined || typeof Highlight === 'undefined' || typeof StaticRange === 'undefined') {
    removeBitbucketWorkflowSyntax();
    return;
  }
  let changed = false;
  const roots = new Set<HTMLElement>();
  for (const entry of entries) {
    if (entry.path !== 'bitbucket-pipelines.yml' || !entry.root.isConnected) continue;
    roots.add(entry.root);
    const before = linesOf(entry, 'old');
    const after = linesOf(entry, 'new');
    const lines = [...before, ...after];
    const cached = painted.get(entry.root);
    if (cached !== undefined && cached.beforeCount === before.length && sameLines(cached.lines, lines)) continue;
    const ranges: ShellRanges = new Map();
    highlightSide(before, ranges, new Set(after.flatMap((line) => line.nodes.map((part) => part.node))));
    highlightSide(after, ranges, new Set());
    painted.set(entry.root, { lines, beforeCount: before.length, ranges });
    changed = true;
  }
  for (const root of painted.keys()) if (!roots.has(root)) { painted.delete(root); changed = true; }
  if (changed) setHighlights();
}

export function removeBitbucketWorkflowSyntax(): void {
  painted.clear();
  if (typeof CSS === 'undefined' || CSS.highlights === undefined) return;
  for (const scope of SHELL_SCOPES) CSS.highlights.delete(PREFIX + scope);
}
