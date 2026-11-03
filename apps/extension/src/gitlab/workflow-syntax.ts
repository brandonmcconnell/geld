import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import type { Scalar, YAMLMap } from 'yaml';
import { SHELL_SCOPES, paintBlock, sameLines, textNodes } from '../lib/shell-highlight';
import type { ShellLine, ShellRanges, SourceText } from '../lib/shell-highlight';
import { providerFullSha, providerNativeSourceElement, providerSourcePath } from '../providers/source-facts';
import type { ProviderDiffEntry, ProviderDiffSyntax, ProviderDiffView } from '../providers/types';
import { jsonAttribute, record } from './page';
import { gitLabShellSheetMedia, isGitLabShellThemeLink, readGitLabShellPalette } from './shell-palette';

interface LocatedLine { readonly line: ShellLine; readonly start: number; readonly end: number }
interface Source { readonly text: string; readonly lines: readonly LocatedLine[] }
interface Capture { readonly table: HTMLTableElement; readonly text: HTMLElement; readonly before: readonly ShellLine[]; readonly after: readonly ShellLine[]; readonly identity: string }
interface Painted { readonly beforeCount: number; readonly lines: readonly ShellLine[]; readonly identity: string; readonly palette: string; readonly names: readonly string[]; readonly rules: string }
const reserved = new Set(['include', 'stages', 'types', 'variables', 'workflow', 'default', 'spec', 'image', 'services', 'cache', 'before_script', 'after_script']);
let next = 0;

function ciPath(value: unknown): boolean { return providerSourcePath(value) && value.split('/').at(-1) === '.gitlab-ci.yml'; }
function key(value: unknown): string | null { return isScalar(value) && typeof value.value === 'string' ? value.value : null; }
function field(map: YAMLMap, name: string): unknown { return map.items.find((pair) => key(pair.key) === name)?.value; }
function plainMap(value: unknown): value is YAMLMap { return isMap(value) && value.flow !== true && value.tag === undefined && !value.items.some((pair) => key(pair.key) === '<<'); }

// Validate the native run shape without resolving aliases, includes or inherited jobs.
function nativeStep(value: unknown): value is YAMLMap {
  if (!plainMap(value) || value.items.some((pair) => !['name', 'script', 'step', 'env', 'inputs'].includes(key(pair.key) ?? ''))) return false;
  const name = key(field(value, 'name')), script = field(value, 'script'), step = field(value, 'step');
  if (name === null || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || (script === undefined) === (step === undefined)) return false;
  const program = script ?? step;
  if (!isScalar(program) || typeof program.value !== 'string' || program.tag !== undefined) return false;
  const env = field(value, 'env'), inputs = field(value, 'inputs');
  if (env !== undefined && (!plainMap(env) || env.items.some((pair) => key(pair.key) === null || !isScalar(pair.value) || typeof pair.value.value !== 'string' || pair.value.tag !== undefined))) return false;
  return inputs === undefined || (step !== undefined && plainMap(inputs));
}

function sourceOf(lines: readonly ShellLine[]): Source {
  let offset = 0;
  return { text: lines.map((line) => line.text).join('\n') + '\n', lines: lines.map((line) => {
    const start = offset;offset += line.text.length + 1;return { line, start, end: offset - 1 };
  }) };
}

function slice(line: ShellLine, start: number, end: number): ShellLine {
  let offset = 0;const nodes: SourceText[] = [];
  for (const part of line.nodes) {
    const first = Math.max(start, offset), last = Math.min(end, offset + part.text.length);
    if (first < last) nodes.push({ node: part.node, text: part.text.slice(first - offset, last - offset), offset: (part.offset ?? 0) + first - offset });
    offset += part.text.length;
  }
  return { number: line.number, text: line.text.slice(start, end), nodes };
}

function scalarLines(value: Scalar, source: Source): readonly ShellLine[] | null {
  if (typeof value.value !== 'string' || value.range == null || value.tag !== undefined
    || /\$\{\{|\$\[\[/.test(value.value)) return null;
  const [start, end] = value.range;
  if (value.type === 'PLAIN') {
    const line = source.lines.find((part) => part.start <= start && part.end >= end);
    return line !== undefined && source.text.slice(start, end) === value.value ? [slice(line.line, start - line.start, end - line.start)] : null;
  }
  if (value.type !== 'BLOCK_LITERAL') return null;
  const header = source.text.indexOf('\n', start);if (header < 0 || header >= end) return null;
  const body = source.lines.filter((line) => line.start > header && line.start < end), nonempty = body.filter((line) => line.line.text.trim() !== '');
  if (nonempty.length === 0) return null;
  const indent = Math.min(...nonempty.map((line) => line.line.text.search(/\S/)));
  const lines = body.map((line) => slice(line.line, Math.min(indent, line.line.text.length), line.line.text.length));
  return lines.map((line) => line.text).join('\n').replace(/\n+$/, '') === value.value.replace(/\n+$/, '') ? lines : null;
}

function programs(lines: readonly ShellLine[]): readonly (readonly ShellLine[])[] {
  if (lines[0]?.number !== 1) return [];
  let length = 1;while (length < lines.length && lines[length]?.number === (lines[length - 1]?.number ?? 0) + 1) length++;
  const source = sourceOf(lines.slice(0, length));if (source.text.length > 100_000) return [];
  try {
    const doc = parseDocument(source.text, { keepSourceTokens: true, uniqueKeys: true });
    if (doc.errors.length !== 0 || doc.warnings.length !== 0 || !plainMap(doc.contents)) return [];
    const output: (readonly ShellLine[])[] = [];
    for (const pair of doc.contents.items) {
      const name = key(pair.key), job = pair.value;
      if (name === null || reserved.has(name) || !plainMap(job) || job.range == null || !isScalar(pair.key) || pair.key.range == null) continue;
      const closing = source.lines.find((line) => line.start >= job.range![1] && line.line.text.trim() !== '' && !line.line.text.trimStart().startsWith('#'));
      if (closing === undefined || closing.line.text.search(/\S/) !== 0) continue;
      const run = field(job, 'run');
      if (!isSeq(run) || run.flow === true || run.tag !== undefined || !run.items.every(nativeStep)
        || ['script', 'before_script', 'after_script'].some((name) => field(job, name) !== undefined)) continue;
      for (const step of run.items) {
        if (!nativeStep(step) || field(step, 'step') !== undefined) continue;
        const stepName = key(field(step, 'name')), script = field(step, 'script');
        if (stepName === null || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(stepName) || !isScalar(script)) continue;
        const body = scalarLines(script, source);if (body !== null) output.push(body);
      }
    }
    return output;
  } catch { return []; }
}

function linesOf(entry: ProviderDiffEntry, side: 'old' | 'new'): readonly ShellLine[] | null {
  const lines: ShellLine[] = [];let previous = 0;
  for (const row of entry.readLines?.() ?? []) {
    const number = side === 'old' ? row.oldLine : row.newLine, text = side === 'old' ? row.oldText : row.newText;
    if (number === null || text === null || row.kind === 'hunk') continue;
    if (!Number.isSafeInteger(number) || number <= previous || row.root.closest('diff-file') !== entry.root || !providerNativeSourceElement(row.root)) return null;
    const parallel = row.root.matches('tr.rd-hunk-lines-parallel');
    if (!parallel && !row.root.matches('tr.rd-hunk-lines-inline')) return null;
    const cells = row.root.querySelectorAll<HTMLElement>(parallel ? `:scope > td.rd-line-content[data-position="${side}"]` : ':scope > td.rd-line-content');
    const cell = cells[0];if (cells.length !== 1 || cell === undefined) return null;
    const bodies = cell.querySelectorAll<HTMLElement>('.rd-line-text'), body = bodies[0];
    if (bodies.length !== 1 || body === undefined || !providerNativeSourceElement(body)) return null;
    const raw = textNodes(body), joined = raw.map((part) => part.text).join('');
    if (joined !== text && joined !== text + '\n') return null;
    let remaining = text.length;const nodes: SourceText[] = [];
    for (const part of raw) { const length = Math.min(part.text.length, remaining);if (length > 0) nodes.push({ node: part.node, text: part.text.slice(0, length) });remaining -= length; }
    lines.push({ number, text, nodes });previous = number;
  }
  return lines;
}

function capture(view: ProviderDiffView, entry: ProviderDiffEntry): Capture | null {
  try { return readCapture(view, entry); } catch { return null; }
}

function readCapture(view: ProviderDiffView, entry: ProviderDiffEntry): Capture | null {
  const frame = view.readNewSourceFrame?.();if (frame === null || frame === undefined || !frame.current()) return null;
  const witness = frame.read(entry), data = jsonAttribute(entry.root, 'data-file-data');
  if (witness === null || witness.subject.repository.provider !== 'gitlab' || witness.repository.origin !== 'https://gitlab.com' || witness.path !== entry.path
    || !record(data?.diff_refs) || !providerFullSha(data.diff_refs.head_sha) || !providerFullSha(data.diff_refs.base_sha) || !providerFullSha(data.diff_refs.start_sha)
    || data.diff_refs.head_sha.toLowerCase() !== witness.headSha || !providerNativeSourceElement(entry.root)) return null;
  const before = ciPath(data.old_path) ? linesOf(entry, 'old') : [], after = ciPath(entry.path) ? linesOf(entry, 'new') : [];
  if (before === null || after === null || before.length + after.length === 0) return null;
  const tables = [...entry.root.querySelectorAll<HTMLTableElement>('table.rd-text-view-root.code-syntax-highlight-theme')].filter(providerNativeSourceElement);
  const table = tables[0], text = table?.querySelector<HTMLElement>('.rd-line-text');
  if (tables.length !== 1 || table === undefined || text === null || text === undefined || !frame.current()) return null;
  return { table, text, before, after, identity: JSON.stringify([frame.key, entry.path, data.old_path, data.diff_refs]) };
}

export function createGitLabWorkflowSyntax(): ProviderDiffSyntax {
  const painted = new Map<HTMLElement, Painted>();let style: HTMLStyleElement | null = null;
  let current: ProviderDiffView | null = null, watched: Document | null = null;
  const media = new Map<string, MediaQueryList>();
  const repaint = (): void => { if (current !== null) syntax.apply(current); };
  const loaded = (event: Event): void => { if (event.target instanceof HTMLLinkElement && isGitLabShellThemeLink(event.target)) repaint(); };
  const unwatch = (): void => {
    watched?.removeEventListener('load', loaded, true);watched = null;
    for (const query of media.values()) query.removeEventListener('change', repaint);media.clear();
  };
  const watch = (doc: Document): void => {
    if (watched !== doc) { unwatch();watched = doc;doc.addEventListener('load', loaded, true); }
    const queries = new Set(['(prefers-color-scheme: dark)', '(forced-colors: active)']);
    for (const link of doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]')) if (isGitLabShellThemeLink(link)) {
      if (link.media) queries.add(link.media);const effective = gitLabShellSheetMedia(link);if (effective) queries.add(effective);
    }
    for (const [name, query] of media) if (!queries.has(name)) { query.removeEventListener('change', repaint);media.delete(name); }
    for (const name of queries) if (!media.has(name)) {
      const query = doc.defaultView?.matchMedia(name);if (query === undefined) continue;query.addEventListener('change', repaint);media.set(name, query);
    }
  };
  const remove = (root: HTMLElement): void => { const value = painted.get(root);if (value !== undefined && typeof CSS !== 'undefined') for (const name of value.names) CSS.highlights?.delete(name);painted.delete(root); };
  const clear = (): void => { current = null;unwatch();for (const root of painted.keys()) remove(root);style?.remove();style = null; };
  const syntax: ProviderDiffSyntax = {
    apply(view) {
      if (view.kind !== 'gitlab-rapid' || typeof CSS === 'undefined' || CSS.highlights === undefined || typeof Highlight === 'undefined' || typeof StaticRange === 'undefined') { clear();return; }
      current = view;watch(view.container.ownerDocument);
      const roots = new Set<HTMLElement>();let changed = false;
      for (const entry of view.entries) {
        if (!ciPath(entry.path) && !ciPath(jsonAttribute(entry.root, 'data-file-data')?.old_path)) continue;
        const source = capture(view, entry);
        if (source === null) continue;
        const before = programs(source.before), after = programs(source.after);if (before.length + after.length === 0) continue;
        const palette = readGitLabShellPalette(source.table, source.text);if (palette === null) continue;
        const fresh = capture(view, entry);if (fresh === null || fresh.identity !== source.identity || !sameLines(source.before, fresh.before) || !sameLines(source.after, fresh.after)) continue;
        roots.add(entry.root);const lines = [...source.before, ...source.after], signature = JSON.stringify(palette), cached = painted.get(entry.root);
        if (cached !== undefined && cached.identity === source.identity && cached.palette === signature && cached.beforeCount === source.before.length && sameLines(cached.lines, lines)) continue;
        remove(entry.root);const ranges: ShellRanges = new Map(), skipped = new Set(source.after.flatMap((line) => line.nodes.map((part) => part.node)));
        for (const program of before) paintBlock(program, ranges, skipped);
        for (const program of after) paintBlock(program, ranges, new Set());
        const names: string[] = [], rules: string[] = [], id = next++;
        for (const scope of SHELL_SCOPES) {
          const values = ranges.get(scope);if (values === undefined || values.length === 0) continue;
          const name = `geld-gitlab-shell-${id}-${scope}`, highlight = new Highlight();for (const range of values) highlight.add(range);
          CSS.highlights.set(name, highlight);names.push(name);rules.push(`::highlight(${name}){color:${palette[scope]}}`);
        }
        painted.set(entry.root, { beforeCount: source.before.length, lines, identity: source.identity, palette: signature, names, rules: rules.join('\n') });changed = true;
      }
      for (const root of painted.keys()) if (!roots.has(root)) { remove(root);changed = true; }
      if (painted.size === 0) { style?.remove();style = null;return; }
      if (changed || style?.isConnected !== true) {
        if (style?.ownerDocument !== view.container.ownerDocument) { style?.remove();style = null; }
        if (style === null) { style = view.container.ownerDocument.createElement('style');style.setAttribute('data-geld-ui', '');view.container.ownerDocument.head.append(style); }
        style.textContent = [...painted.values()].map((value) => value.rules).join('\n');
      }
    },
    clear,
  };
  return syntax;
}
