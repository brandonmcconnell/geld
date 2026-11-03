/**
 * How a change's files depend on one another: the imports each changed file
 * makes, resolved against the other files in the same change, and a layered
 * layout of that graph (importers above what they import). Pure: the caller
 * reads the files and draws the result.
 */

const SCRIPT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro'] as const;
const STYLE_EXTENSIONS = ['.css', '.scss', '.sass', '.less'] as const;
const RESOLVABLE_EXTENSIONS = [...SCRIPT_EXTENSIONS, ...STYLE_EXTENSIONS, '.json'] as const;
/** Specifiers written with a compiled extension that name a source file (`./x.js` for `x.ts`). */
const COMPILED_EXTENSION = /\.(?:js|jsx|mjs|cjs)$/;
/** Path aliases projects map onto their source root. A specifier behind one is matched by its tail. */
const ALIAS_PREFIX = /^(?:@|~|#|\$lib|src|app|lib)\//;

type Language = 'script' | 'style' | 'python' | 'rust';

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

function languageOf(path: string): Language | null {
  const extension = extensionOf(path);
  if ((SCRIPT_EXTENSIONS as readonly string[]).includes(extension)) return 'script';
  if ((STYLE_EXTENSIONS as readonly string[]).includes(extension)) return 'style';
  if (extension === '.py') return 'python';
  if (extension === '.rs') return 'rust';
  return null;
}

/** Whether {@link importSpecifiers} can read anything from a file at `path`. */
export function canReadImports(path: string): boolean {
  return languageOf(path) !== null;
}

const SCRIPT_PATTERNS: readonly RegExp[] = [
  /\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"\n]+)['"]/g,
  /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"]([^'"\n]+)['"]/g,
  /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  /\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/g,
];
const STYLE_PATTERNS: readonly RegExp[] = [/@(?:import|use|forward)\s+(?:url\()?\s*['"]?([^'")\s;]+)['"]?\s*\)?/g];
const PYTHON_PATTERNS: readonly RegExp[] = [/^\s*from\s+(\.*[\w.]*)\s+import\b/gm, /^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm];
const RUST_PATTERNS: readonly RegExp[] = [/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*;/gm];

function collect(text: string, patterns: readonly RegExp[]): string[] {
  const found: string[] = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const value = match[1];
      if (value !== undefined && value !== '') found.push(value);
    }
  }
  return found;
}

/**
 * The module specifiers a file names, as written (`./step`, `../lib/x.js`,
 * `@/components/card`, `.models` for Python's `from .models import`,
 * `mod:name` for a Rust `mod name;`). Unknown languages give none.
 */
export function importSpecifiers(path: string, text: string): string[] {
  const language = languageOf(path);
  if (language === null) return [];
  if (language === 'script') return unique(collect(text, SCRIPT_PATTERNS));
  if (language === 'style') return unique(collect(text, STYLE_PATTERNS));
  if (language === 'rust') return unique(collect(text, RUST_PATTERNS).map((name) => `mod:${name}`));
  const modules: string[] = [];
  for (const entry of collect(text, PYTHON_PATTERNS)) {
    for (const part of entry.split(',')) {
      const name = part.trim();
      if (name !== '') modules.push(name);
    }
  }
  return unique(modules);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/** `a/b` joined with `../c/./d` → `a/c/d`; null when it climbs above the root. */
function joinPath(base: string, relative: string): string | null {
  const parts = base === '' ? [] : base.split('/');
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(segment);
  }
  return parts.join('/');
}

function candidatesFor(target: string, language: Language): string[] {
  const candidates = [target];
  if (language === 'script' || language === 'style') {
    if (COMPILED_EXTENSION.test(target)) {
      const stem = target.replace(COMPILED_EXTENSION, '');
      for (const extension of SCRIPT_EXTENSIONS) candidates.push(stem + extension);
    }
    for (const extension of RESOLVABLE_EXTENSIONS) candidates.push(target + extension);
    for (const extension of RESOLVABLE_EXTENSIONS) candidates.push(`${target}/index${extension}`);
    if (language === 'style') {
      const slash = target.lastIndexOf('/');
      const partial = `${target.slice(0, slash + 1)}_${target.slice(slash + 1)}`;
      candidates.push(partial);
      for (const extension of STYLE_EXTENSIONS) candidates.push(partial + extension);
    }
  }
  return candidates;
}

function firstKnown(candidates: readonly string[], known: ReadonlySet<string>): string | null {
  for (const candidate of candidates) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

/** The one known path whose stem ends with `tail` (after a `/`, or equal to it), else null. */
function byTail(tail: string, known: ReadonlySet<string>, language: Language): string | null {
  const wanted = new Set(candidatesFor(tail, language));
  let match: string | null = null;
  for (const path of known) {
    for (const candidate of wanted) {
      if (path === candidate || path.endsWith(`/${candidate}`)) {
        if (match !== null && match !== path) return null;
        match = path;
      }
    }
  }
  return match;
}

/**
 * The changed file `specifier` (written in `from`) points at, or null when it
 * names something outside the change (a package, an unchanged file).
 */
export function resolveImport(from: string, specifier: string, known: ReadonlySet<string>): string | null {
  const language = languageOf(from);
  if (language === null) return null;
  const directory = dirname(from);
  if (language === 'rust') {
    if (!specifier.startsWith('mod:')) return null;
    const name = specifier.slice(4);
    const file = from.slice(from.lastIndexOf('/') + 1);
    const base = file === 'mod.rs' || file === 'lib.rs' || file === 'main.rs' ? directory : joinPath(directory, file.replace(/\.rs$/, ''));
    if (base === null) return null;
    return firstKnown([joinPath(base, `${name}.rs`) ?? '', joinPath(base, `${name}/mod.rs`) ?? ''], known);
  }
  if (language === 'python') {
    const dots = /^\.*/.exec(specifier)?.[0].length ?? 0;
    const modulePath = specifier.slice(dots).split('.').filter((part) => part !== '').join('/');
    if (dots > 0) {
      let base: string | null = directory;
      for (let level = 1; level < dots && base !== null; level++) base = base === '' ? null : dirname(base);
      if (base === null) return null;
      const target = modulePath === '' ? base : joinPath(base, modulePath);
      if (target === null) return null;
      return firstKnown([`${target}.py`, `${target}/__init__.py`], known);
    }
    if (modulePath === '') return null;
    return firstKnown([`${modulePath}.py`, `${modulePath}/__init__.py`], known) ?? uniqueTail([`${modulePath}.py`, `${modulePath}/__init__.py`], known);
  }
  if (specifier.startsWith('./') || specifier.startsWith('../') || specifier === '.' || specifier === '..') {
    const target = joinPath(directory, specifier);
    return target === null ? null : firstKnown(candidatesFor(target, language), known);
  }
  if (language === 'style' && !specifier.includes(':') && !specifier.startsWith('/')) {
    const target = joinPath(directory, specifier);
    const relative = target === null ? null : firstKnown(candidatesFor(target, language), known);
    if (relative !== null) return relative;
  }
  if (specifier.startsWith('/')) return firstKnown(candidatesFor(specifier.slice(1), language), known);
  const alias = ALIAS_PREFIX.exec(specifier);
  if (alias !== null) return byTail(specifier.slice(alias[0].length), known, language);
  return null;
}

function uniqueTail(tails: readonly string[], known: ReadonlySet<string>): string | null {
  let match: string | null = null;
  for (const path of known) {
    if (tails.some((tail) => path === tail || path.endsWith(`/${tail}`))) {
      if (match !== null && match !== path) return null;
      match = path;
    }
  }
  return match;
}

export interface FlowEdge {
  /** The file that imports. */
  readonly from: string;
  /** The file it imports. */
  readonly to: string;
  /** The link existed before this change and is gone after it (read from the base side). */
  readonly removed?: true;
}

/**
 * Every link between changed files: `after` holds each file's text as the
 * change leaves it, `before` the text it replaced (deleted files, and the
 * files that may have imported them). A link found only before is `removed`.
 */
export function flowEdges(paths: readonly string[], after: ReadonlyMap<string, string>, before: ReadonlyMap<string, string> = new Map()): FlowEdge[] {
  const known = new Set(paths);
  const links = (texts: ReadonlyMap<string, string>): Set<string> => {
    const found = new Set<string>();
    for (const [from, text] of texts) {
      if (!known.has(from)) continue;
      for (const specifier of importSpecifiers(from, text)) {
        const to = resolveImport(from, specifier, known);
        if (to !== null && to !== from) found.add(`${from}\n${to}`);
      }
    }
    return found;
  };
  const now = links(after);
  const then = links(before);
  const edges: FlowEdge[] = [];
  for (const key of now) edges.push(edgeOf(key));
  for (const key of then) if (!now.has(key)) edges.push({ ...edgeOf(key), removed: true });
  return edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

function edgeOf(key: string): FlowEdge {
  const split = key.indexOf('\n');
  return { from: key.slice(0, split), to: key.slice(split + 1) };
}

/** A node of the laid-out graph: a file, or a bend point a long link passes through. */
export type FlowSlot = { readonly kind: 'file'; readonly path: string; readonly x: number } | { readonly kind: 'bend'; readonly id: string; readonly x: number };

export interface FlowComponent {
  /** Rows top to bottom; within a row, slots left to right with their centre `x` in node widths. */
  readonly rows: readonly (readonly FlowSlot[])[];
  /** Each link as the slots it passes through, row by row: the importer's row first. */
  readonly routes: readonly FlowRoute[];
  /** Links left undrawn because a path through other files already connects the two. */
  readonly implied: number;
  /** Widest extent of the component, in node widths. */
  readonly width: number;
}

export interface FlowRoute {
  readonly edge: FlowEdge;
  /** `x` (node widths) and row of each point, from the importer down to the import (or up, for a link that closes a cycle). */
  readonly points: readonly { readonly row: number; readonly x: number }[];
}

export interface FlowLayout {
  /** Connected groups of files, largest first. */
  readonly components: readonly FlowComponent[];
  /** Files no link touches, in the order given. */
  readonly loose: readonly string[];
}

/** Space between neighbouring files in a row, in node widths. */
const FILE_GAP = 0.22;
/** Space between a file and a bend point beside it, and between two bend points: long links run in a narrow bundle. */
const BEND_GAP = 0.08;
const BEND_SPACING = 0.035;
const ORDER_SWEEPS = 8;
const PLACE_SWEEPS = 6;

/**
 * A layered drawing of the links: every component on its own, importers above
 * what they import, rows ordered to keep links from crossing (barycentre
 * sweeps), files placed under the files they connect to. Links that skip rows
 * get bend points in the rows between, so they pass beside files rather than
 * through them; a link that closes a cycle is drawn upwards.
 */
export function layoutFlow(paths: readonly string[], edges: readonly FlowEdge[]): FlowLayout {
  const known = new Set(paths);
  const usable = edges.filter((edge) => known.has(edge.from) && known.has(edge.to) && edge.from !== edge.to);
  const neighbours = new Map<string, Set<string>>();
  for (const edge of usable) {
    for (const [a, b] of [
      [edge.from, edge.to],
      [edge.to, edge.from],
    ] as const) {
      const set = neighbours.get(a) ?? new Set<string>();
      set.add(b);
      neighbours.set(a, set);
    }
  }
  const loose = paths.filter((path) => !neighbours.has(path));
  const seen = new Set<string>();
  const components: FlowComponent[] = [];
  for (const start of paths) {
    if (seen.has(start) || !neighbours.has(start)) continue;
    const members: string[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const next = queue.shift();
      if (next === undefined) break;
      members.push(next);
      for (const other of neighbours.get(next) ?? []) {
        if (!seen.has(other)) {
          seen.add(other);
          queue.push(other);
        }
      }
    }
    const memberSet = new Set(members);
    components.push(layoutComponent(
      paths.filter((path) => memberSet.has(path)),
      usable.filter((edge) => memberSet.has(edge.from)),
    ));
  }
  components.sort((a, b) => countFiles(b) - countFiles(a));
  return { components, loose };
}

function countFiles(component: FlowComponent): number {
  return component.rows.reduce((sum, row) => sum + row.filter((slot) => slot.kind === 'file').length, 0);
}

/** Centre to centre distance two neighbouring slots need. */
function separation(left: WorkSlot, right: WorkSlot): number {
  const gap = left.kind === 'file' && right.kind === 'file' ? FILE_GAP : left.kind === 'bend' && right.kind === 'bend' ? BEND_SPACING : BEND_GAP;
  return left.width / 2 + gap + right.width / 2;
}

/**
 * Positions as close as possible (least squares) to `wanted`, in order, with
 * at least `gaps[i]` between the i-th and the next: pool adjacent violators
 * over the wanted positions less their running separation, so a row never
 * drifts to one side the way pushing overlaps rightwards does.
 */
export function closestSpaced(wanted: readonly number[], gaps: readonly number[]): number[] {
  const offsets: number[] = [];
  let running = 0;
  wanted.forEach((_, index) => {
    if (index > 0) running += gaps[index - 1] ?? 0;
    offsets.push(running);
  });
  const blocks: { sum: number; count: number }[] = [];
  wanted.forEach((value, index) => {
    blocks.push({ sum: value - (offsets[index] ?? 0), count: 1 });
    for (;;) {
      const last = blocks[blocks.length - 1];
      const before = blocks[blocks.length - 2];
      if (last === undefined || before === undefined || before.sum / before.count <= last.sum / last.count) break;
      blocks.pop();
      before.sum += last.sum;
      before.count += last.count;
    }
  });
  const placed: number[] = [];
  for (const block of blocks) {
    for (let index = 0; index < block.count; index++) placed.push(block.sum / block.count + (offsets[placed.length] ?? 0));
  }
  return placed;
}

interface WorkSlot {
  readonly kind: 'file' | 'bend';
  readonly id: string;
  readonly width: number;
  x: number;
  order: number;
}

function layoutComponent(members: readonly string[], edges: readonly FlowEdge[]): FlowComponent {
  // Rank: longest path from the files nothing imports, over the links that do not close a cycle.
  const outgoing = new Map<string, string[]>(members.map((path) => [path, []]));
  for (const edge of edges) outgoing.get(edge.from)?.push(edge.to);
  const state = new Map<string, 'open' | 'done'>();
  const backward = new Set<string>();
  const visit = (path: string): void => {
    state.set(path, 'open');
    for (const to of outgoing.get(path) ?? []) {
      const mark = state.get(to);
      if (mark === 'open') backward.add(`${path}\n${to}`);
      else if (mark === undefined) visit(to);
    }
    state.set(path, 'done');
  };
  const imported = new Set(edges.map((edge) => edge.to));
  for (const path of members) if (!imported.has(path) && !state.has(path)) visit(path);
  for (const path of members) if (!state.has(path)) visit(path);
  const forward = edges.filter((edge) => !backward.has(`${edge.from}\n${edge.to}`));
  const rank = new Map<string, number>(members.map((path) => [path, 0]));
  for (let pass = 0; pass < members.length; pass++) {
    let changed = false;
    for (const edge of forward) {
      const want = (rank.get(edge.from) ?? 0) + 1;
      if ((rank.get(edge.to) ?? 0) < want) {
        rank.set(edge.to, want);
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Longest path puts every file nothing imports at the top, however far above its imports that leaves it; pull
  // each file (deepest first) down to just above the nearest file it imports, so links span as few rows as they can.
  const importsOf = new Map<string, string[]>(members.map((path) => [path, []]));
  for (const edge of forward) importsOf.get(edge.from)?.push(edge.to);
  const byDepth = [...members].sort((a, b) => (rank.get(b) ?? 0) - (rank.get(a) ?? 0));
  for (const path of byDepth) {
    const imports = importsOf.get(path) ?? [];
    if (imports.length === 0) continue;
    const lowest = Math.min(...imports.map((to) => rank.get(to) ?? 0)) - 1;
    if (lowest > (rank.get(path) ?? 0)) rank.set(path, lowest);
  }
  const used = [...new Set(rank.values())].sort((a, b) => a - b);
  for (const [path, value] of rank) rank.set(path, used.indexOf(value));

  const depth = Math.max(0, ...rank.values()) + 1;
  const rows: WorkSlot[][] = Array.from({ length: depth }, () => []);
  const slotOf = new Map<string, WorkSlot>();
  for (const path of members) {
    const slot: WorkSlot = { kind: 'file', id: path, width: 1, x: 0, order: 0 };
    slotOf.set(path, slot);
    rows[rank.get(path) ?? 0]?.push(slot);
  }
  // A link another path already implies (a imports b imports c, and a imports c) is left out of the drawing: what
  // reaches what stays the same, and the rows lose most of their crossings.
  // Only what the change leaves in place implies anything: a link through a removed one is not a path any more,
  // and removed links themselves are always drawn.
  const current = new Map<string, string[]>(members.map((path) => [path, []]));
  for (const edge of forward) if (edge.removed !== true) current.get(edge.from)?.push(edge.to);
  const reach = new Map<string, Set<string>>();
  const reachOf = (path: string): Set<string> => {
    const known = reach.get(path);
    if (known !== undefined) return known;
    const found = new Set<string>();
    reach.set(path, found);
    for (const to of current.get(path) ?? []) {
      found.add(to);
      for (const further of reachOf(to)) found.add(further);
    }
    return found;
  };
  const implied = new Set<string>();
  for (const path of members) {
    const imports = current.get(path) ?? [];
    for (const to of imports) {
      if (imports.some((other) => other !== to && reachOf(other).has(to))) implied.add(`${path}\n${to}`);
    }
  }
  const drawn = edges.filter((edge) => !implied.has(`${edge.from}\n${edge.to}`));

  // Each link becomes a chain of slots, one per row it spans; up and down neighbours drive the ordering.
  const chains: { edge: FlowEdge; slots: WorkSlot[]; rows: number[] }[] = [];
  const above = new Map<WorkSlot, WorkSlot[]>();
  const below = new Map<WorkSlot, WorkSlot[]>();
  const link = (upper: WorkSlot, lower: WorkSlot): void => {
    below.set(upper, [...(below.get(upper) ?? []), lower]);
    above.set(lower, [...(above.get(lower) ?? []), upper]);
  };
  for (const edge of drawn) {
    const from = slotOf.get(edge.from);
    const to = slotOf.get(edge.to);
    if (from === undefined || to === undefined) continue;
    const fromRow = rank.get(edge.from) ?? 0;
    const toRow = rank.get(edge.to) ?? 0;
    const top = Math.min(fromRow, toRow);
    const bottom = Math.max(fromRow, toRow);
    const upperSlot = fromRow <= toRow ? from : to;
    const lowerSlot = fromRow <= toRow ? to : from;
    const slots: WorkSlot[] = [upperSlot];
    const chainRows: number[] = [top];
    for (let row = top + 1; row < bottom; row++) {
      const bend: WorkSlot = { kind: 'bend', id: `${edge.from}\n${edge.to}\n${row}`, width: 0, x: 0, order: 0 };
      rows[row]?.push(bend);
      slots.push(bend);
      chainRows.push(row);
    }
    slots.push(lowerSlot);
    chainRows.push(bottom);
    for (let index = 1; index < slots.length && bottom !== top; index++) {
      const upper = slots[index - 1];
      const lower = slots[index];
      if (upper !== undefined && lower !== undefined) link(upper, lower);
    }
    if (fromRow > toRow) {
      slots.reverse();
      chainRows.reverse();
    }
    chains.push({ edge, slots, rows: chainRows });
  }

  rows.forEach((row) => row.forEach((slot, index) => (slot.order = index)));
  const reorder = (row: WorkSlot[], neighboursOf: (slot: WorkSlot) => readonly WorkSlot[] | undefined): void => {
    const weight = new Map<WorkSlot, number>();
    for (const slot of row) {
      const near = neighboursOf(slot) ?? [];
      weight.set(slot, near.length === 0 ? slot.order : near.reduce((sum, other) => sum + other.order, 0) / near.length);
    }
    row.sort((a, b) => (weight.get(a) ?? 0) - (weight.get(b) ?? 0) || a.order - b.order);
    row.forEach((slot, index) => (slot.order = index));
  };
  for (let sweep = 0; sweep < ORDER_SWEEPS; sweep++) {
    if (sweep % 2 === 0) for (let index = 1; index < rows.length; index++) reorder(rows[index] ?? [], (slot) => above.get(slot));
    else for (let index = rows.length - 2; index >= 0; index--) reorder(rows[index] ?? [], (slot) => below.get(slot));
  }

  // Place: rows packed left to right, then pulled under their neighbours without overlapping, then shifted to start at 0.
  for (const row of rows) {
    let cursor = 0;
    row.forEach((slot, index) => {
      const previous = row[index - 1];
      if (previous !== undefined) cursor += separation(previous, slot);
      slot.x = cursor;
    });
  }
  const settle = (row: WorkSlot[], neighboursOf: (slot: WorkSlot) => readonly WorkSlot[] | undefined): void => {
    const wanted = row.map((slot) => {
      const near = neighboursOf(slot) ?? [];
      return near.length === 0 ? slot.x : near.reduce((sum, other) => sum + other.x, 0) / near.length;
    });
    const placed = closestSpaced(
      wanted,
      row.slice(1).map((slot, index) => {
        const previous = row[index];
        return previous === undefined ? 0 : separation(previous, slot);
      }),
    );
    row.forEach((slot, index) => (slot.x = placed[index] ?? slot.x));
  };
  for (let sweep = 0; sweep < PLACE_SWEEPS; sweep++) {
    if (sweep % 2 === 0) for (let index = 1; index < rows.length; index++) settle(rows[index] ?? [], (slot) => above.get(slot));
    else for (let index = rows.length - 2; index >= 0; index--) settle(rows[index] ?? [], (slot) => below.get(slot));
  }
  let left = Infinity;
  let right = -Infinity;
  for (const row of rows) {
    for (const slot of row) {
      left = Math.min(left, slot.x - slot.width / 2);
      right = Math.max(right, slot.x + slot.width / 2);
    }
  }
  if (!Number.isFinite(left)) left = 0;
  for (const row of rows) for (const slot of row) slot.x -= left;

  return {
    rows: rows.map((row) => row.map((slot): FlowSlot => (slot.kind === 'file' ? { kind: 'file', path: slot.id, x: slot.x } : { kind: 'bend', id: slot.id, x: slot.x }))),
    routes: chains.map((chain) => ({ edge: chain.edge, points: chain.slots.map((slot, index) => ({ row: chain.rows[index] ?? 0, x: slot.x })) })),
    implied: edges.length - drawn.length,
    width: Math.max(1, right - left),
  };
}
