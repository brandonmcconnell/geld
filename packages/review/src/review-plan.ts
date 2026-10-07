/**
 * The Review tab's unit of work: a plan of steps over a pull request's
 * hunks. A step is one body of work (a feature slice, a fix, a refactor)
 * that may span several files and languages; every hunk of every file Geld
 * leaves visible belongs to exactly one step's `touches`, and the hunks of
 * files Geld hides (tests, generated output, fixtures, lockfiles) ride along
 * as the `supporting` changes of the step they exist for. Two producers fill
 * the same shape - the rules here (free, synchronous, deterministic) and a
 * chat model (`review-prompts.ts`) that refines the rules' candidates - and
 * `normalizePlan` holds both to the same invariants afterwards.
 *
 * Nothing in here touches a browser or the network.
 */

/** FNV-1a over the text as a short base-36 key (the same shape `@geld/core`'s `hashText` gives, kept here so this package stays dependency-free). */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}-${hash.toString(36)}`;
}

export const STEP_KINDS = ['feature', 'fix', 'refactor', 'tests', 'docs', 'chore', 'generated', 'other'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export function isStepKind(value: unknown): value is StepKind {
  return typeof value === 'string' && STEP_KINDS.some((kind) => kind === value);
}

/** One hunk of one file at the plan's head, by its index among that file's hunks (0 for a file with no hunks: a binary, a pure rename). */
export interface HunkRef {
  readonly path: string;
  readonly hunk: number;
}

export interface ReviewStep {
  /** Stable across replans while the step's first hunk is the same change (a hash of that hunk's signature). */
  readonly id: string;
  /** Three to seven words, imperative or a noun phrase ("Debounce the search box"). */
  readonly title: string;
  readonly kind: StepKind;
  /** The step's account in plain words, written when the step is reached; null until then. */
  readonly story: string | null;
  /** One sentence tying the step to the pull request's goal, or null. */
  readonly why: string | null;
  /** A one-line gist from the planner, shown in the stepper and used as the story's seed. */
  readonly gist: string | null;
  /** Every hunk of the step, in reading order. */
  readonly touches: readonly HunkRef[];
  /** Hidden files' hunks that exist because of this step: tests, fixtures, snapshots, generated output. */
  readonly supporting: readonly HunkRef[];
  /** Step ids to read first. */
  readonly dependsOn: readonly string[];
  /** Up to three things worth a second look, model-written. */
  readonly watch: readonly string[];
  /** Digest item ids whose source lines fall inside this step's hunks. */
  readonly findings: readonly string[];
  /** A hash of the step's hunk signatures: progress remembers it, so a step whose hunks changed after a replan reads `changed`. */
  readonly fingerprint: string;
  /** The signature of each hunk in `touches` then `supporting`, so the step can be laid over a later diff ({@link remapProposals}). */
  readonly signatures: readonly string[];
}

export type PlanProducer = 'rules' | 'ai';

export interface ReviewPlan {
  /** Binds progress to a plan: a hash of the head and the step ids. */
  readonly id: string;
  readonly headSha: string;
  readonly madeAt: string;
  readonly producer: PlanProducer;
  readonly model: string | null;
  readonly steps: readonly ReviewStep[];
  /** Hunks no step claimed; empty after normalisation, which gives them a trailing step. */
  readonly unassigned: readonly HunkRef[];
  /** The model saw hunk headers only (a very large pull request): the view says so once. */
  readonly fromHeaders: boolean;
}

/* ------------------------------------------------------------------------- */
/* Planner input                                                              */
/* ------------------------------------------------------------------------- */

export interface PlanHunk {
  readonly index: number;
  readonly header: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly signature: string;
}

export interface PlanFile {
  readonly path: string;
  readonly previousPath?: string;
  readonly status: 'added' | 'deleted' | 'renamed' | 'modified';
  readonly binary: boolean;
  /** The Geld category hiding this file (id and title), or null when the file stays visible. */
  readonly hidden: { readonly id: string; readonly title: string } | null;
  readonly hunks: readonly PlanHunk[];
}

export interface PlanCommit {
  readonly sha: string;
  /** The first line of the message. */
  readonly message: string;
  /** Paths the commit touched, when known. */
  readonly files?: readonly string[];
}

export interface PlanFinding {
  readonly id: string;
  readonly path: string;
  readonly line?: number;
}

export interface PlanInput {
  readonly title: string;
  readonly body: string | null;
  readonly headSha: string;
  readonly commits: readonly PlanCommit[];
  readonly files: readonly PlanFile[];
  readonly findings: readonly PlanFinding[];
}

/** A step as a producer proposes it, before normalisation assigns ids, supporting changes and order. */
export interface StepProposal {
  /** The producer's own handle, for `dependsOn`; replaced by the stable id. */
  readonly key: string;
  readonly title: string;
  readonly kind: StepKind;
  readonly gist: string | null;
  readonly touches: readonly HunkRef[];
  readonly dependsOn: readonly string[];
  readonly watch: readonly string[];
}

/* ------------------------------------------------------------------------- */
/* Refs                                                                       */
/* ------------------------------------------------------------------------- */

export function refKey(ref: HunkRef): string {
  return `${ref.path}#${ref.hunk}`;
}

export function parseRefKey(key: string): HunkRef | null {
  const at = key.lastIndexOf('#');
  if (at <= 0) return null;
  const hunk = Number(key.slice(at + 1));
  return Number.isInteger(hunk) && hunk >= 0 ? { path: key.slice(0, at), hunk } : null;
}

/** The refs of a file: one per hunk, or one whole-file ref when the diff shows none (binary, rename, mode change). */
export function refsOf(file: PlanFile): readonly HunkRef[] {
  if (file.hunks.length === 0) return [{ path: file.path, hunk: 0 }];
  return file.hunks.map((hunk) => ({ path: file.path, hunk: hunk.index }));
}

function fileSignature(file: PlanFile): string {
  return hashText(`${file.path}\n${file.status}\n${file.binary ? 'binary' : ''}`);
}

/** The signature of a ref: the hunk's own, or the file's for a whole-file ref. */
export function refSignature(files: ReadonlyMap<string, PlanFile>, ref: HunkRef): string {
  const file = files.get(ref.path);
  if (file === undefined) return hashText(refKey(ref));
  const hunk = file.hunks[ref.hunk];
  return hunk === undefined ? fileSignature(file) : hunk.signature;
}

/** Changed lines of a ref (added plus removed), one for a whole-file ref. */
function refSize(files: ReadonlyMap<string, PlanFile>, ref: HunkRef): number {
  const hunk = files.get(ref.path)?.hunks[ref.hunk];
  return hunk === undefined ? 1 : hunk.added.length + hunk.removed.length;
}

function compareRefs(order: ReadonlyMap<string, number>): (a: HunkRef, b: HunkRef) => number {
  return (a, b) => {
    const byFile = (order.get(a.path) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.path) ?? Number.MAX_SAFE_INTEGER);
    return byFile !== 0 ? byFile : a.hunk - b.hunk;
  };
}

/* ------------------------------------------------------------------------- */
/* Naming hunks from the diff                                                 */
/* ------------------------------------------------------------------------- */

const FILE_NAME = /[^/]+$/;

/** `src/search.ts` → `search`; `Button.test.tsx` → `button`; `test_api.py` → `api`; `__snapshots__/Foo.tsx.snap` → `foo`. */
export function stemOf(path: string): string {
  const name = (FILE_NAME.exec(path)?.[0] ?? path).toLowerCase();
  let stem = name;
  // Snapshot files name the file they snapshot with its own extension.
  stem = stem.replace(/\.snap$/, '');
  // Test and story suffixes, then the extension itself.
  stem = stem.replace(/\.(test|spec|stories|story|bench|e2e|cy|d)\.[a-z0-9]+$/, '');
  stem = stem.replace(/[._-](test|spec|tests)\.[a-z0-9]+$/, '');
  stem = stem.replace(/^test_/, '').replace(/_test$/, '');
  stem = stem.replace(/\.[a-z0-9]+$/, '');
  return stem;
}

function directoryOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at === -1 ? '' : path.slice(0, at);
}

/* ------------------------------------------------------------------------- */
/* Symbols: cheap tokens, no parser                                           */
/* ------------------------------------------------------------------------- */

/** A name introduced by an added line, as the common languages spell a definition. Deliberately a handful of shapes. */
const DEFINITIONS: readonly RegExp[] = [
  /\b(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /\b(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=:]/,
  /\b(?:export\s+)?(?:type|interface|enum)\s+([A-Za-z_$][\w$]*)/,
  /\bdef\s+([A-Za-z_][\w]*)\s*\(/,
  /\b(?:pub\s+)?(?:fn|struct|enum|trait)\s+([A-Za-z_][\w]*)/,
  /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\(/,
  /^\s*\.([A-Za-z_-][\w-]*)\s*[{,]/,
  /^\s*(--[A-Za-z_-][\w-]*)\s*:/,
];

const STOP_WORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'import',
  'export',
  'default',
  'class',
  'this',
  'that',
  'self',
  'true',
  'false',
  'null',
  'undefined',
  'string',
  'number',
  'boolean',
  'void',
  'async',
  'await',
  'from',
  'type',
  'interface',
  'props',
  'state',
  'value',
  'data',
  'item',
  'items',
  'index',
  'error',
  'result',
  'options',
  'config',
  'context',
  'name',
  'text',
  'test',
  'describe',
  'expect',
  'main',
  'init',
  'setup',
  'render',
  'handle',
  'update',
  'create',
  'delete',
  'remove',
  'get',
  'set',
  'new',
  'use',
]);

const MIN_SYMBOL_LENGTH = 4;

/** Names an added line defines, filtered to ones specific enough to tie two hunks together. */
export function definedSymbols(added: readonly string[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const line of added) {
    for (const pattern of DEFINITIONS) {
      const match = pattern.exec(line);
      const name = match?.[1];
      if (name === undefined) continue;
      const lower = name.toLowerCase();
      if (name.length >= MIN_SYMBOL_LENGTH && !STOP_WORDS.has(lower)) names.add(name);
    }
  }
  return names;
}

const WORD = /[A-Za-z_$][\w$-]{3,}/g;

/** Every identifier-shaped token in the added lines (a superset of the definitions), for cheap reference checks. */
export function mentionedSymbols(added: readonly string[]): ReadonlySet<string> {
  const words = new Set<string>();
  for (const line of added) for (const match of line.matchAll(WORD)) words.add(match[0]);
  return words;
}

/* ------------------------------------------------------------------------- */
/* Rules producer                                                             */
/* ------------------------------------------------------------------------- */

/** A step larger than this many changed lines is split by file. */
export const STEP_SIZE_CAP = 400;

/** File stems that name a convention, not a thing: four `package.json`s or `index.ts`s share nothing but the name. */
const GENERIC_STEMS = new Set(['index', 'package', 'main', 'mod', 'lib', 'types', 'type', 'utils', 'util', 'helpers', 'config', 'constants', 'readme', 'changelog', 'license', 'setup', 'init', 'app', 'server', 'client', 'test', 'tests', 'spec', '__init__', 'makefile', 'dockerfile', 'cargo', 'go', 'gemfile', 'pnpm-lock', 'yarn', 'package-lock', 'tsconfig', 'vite', 'vitest', 'jest', 'eslint', 'prettier', 'schema', 'styles', 'style', 'page', 'layout', 'route', 'routes', 'model', 'models', 'component', 'components']);

class Groups {
  private readonly parent = new Map<string, string>();
  private readonly size = new Map<string, number>();
  /** The commit (index) that first brought a group together, for its title. */
  readonly commitOf = new Map<string, number>();

  add(key: string, size: number): void {
    if (this.parent.has(key)) return;
    this.parent.set(key, key);
    this.size.set(key, size);
  }

  find(key: string): string {
    let root = key;
    while (this.parent.get(root) !== root) root = this.parent.get(root) ?? root;
    // Path compression keeps the next lookups short.
    let cursor = key;
    while (cursor !== root) {
      const next = this.parent.get(cursor) ?? root;
      this.parent.set(cursor, root);
      cursor = next;
    }
    return root;
  }

  sizeOf(key: string): number {
    return this.size.get(this.find(key)) ?? 0;
  }

  /** Join two groups when the union stays under `cap` (or `cap` is null); returns whether it did. */
  union(a: string, b: string, cap: number | null, commit: number | null): boolean {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return true;
    const merged = (this.size.get(rootA) ?? 0) + (this.size.get(rootB) ?? 0);
    if (cap !== null && merged > cap) return false;
    this.parent.set(rootB, rootA);
    this.size.set(rootA, merged);
    const known = this.commitOf.get(rootA) ?? this.commitOf.get(rootB) ?? commit;
    if (known !== null && known !== undefined) this.commitOf.set(rootA, known);
    return true;
  }

  members(keys: readonly string[]): ReadonlyMap<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const key of keys) {
      const root = this.find(key);
      const list = groups.get(root) ?? [];
      list.push(key);
      groups.set(root, list);
    }
    return groups;
  }
}

const KIND_WORDS: ReadonlyArray<readonly [RegExp, StepKind]> = [
  [/\b(fix|fixes|fixed|bug|crash|regression|hotfix|patch|broken|leak|race)\b/i, 'fix'],
  [/\b(refactor|refactors|cleanup|clean up|tidy|simplify|rename|move|extract|inline|reorganis|reorganiz|dedupe|restructure)\b/i, 'refactor'],
  [/\b(test|tests|spec|specs|coverage)\b/i, 'tests'],
  [/\b(docs?|readme|documentation|changelog|comment|typo)\b/i, 'docs'],
  [/\b(chore|bump|deps|dependency|dependencies|ci|lint|format|prettier|eslint|version|release)\b/i, 'chore'],
  [/\b(add|adds|added|feat|feature|implement|implements|support|introduce|introduces|new|allow|enable)\b/i, 'feature'],
];

const DOC_FILE = /\.(md|mdx|rst|txt|adoc)$/i;
const CONFIG_FILE = /(^|\/)(\.[^/]+|[^/]+\.(json|ya?ml|toml|ini|cfg|lock|config\.[cm]?[jt]sx?|rc))$/i;

/** The kind a commit message or a set of paths suggests. */
export function kindFor(messages: readonly string[], paths: readonly string[]): StepKind {
  for (const message of messages) {
    for (const [pattern, kind] of KIND_WORDS) if (pattern.test(message)) return kind;
  }
  if (paths.length > 0 && paths.every((path) => DOC_FILE.test(path))) return 'docs';
  if (paths.length > 0 && paths.every((path) => CONFIG_FILE.test(path))) return 'chore';
  return 'other';
}

/** A commit message's first line, with conventional-commit prefixes and trailing issue references trimmed. */
export function cleanCommitTitle(message: string): string {
  const first = message.split('\n')[0]?.trim() ?? '';
  return first
    .replace(/^(?:feat|fix|chore|docs|refactor|test|tests|perf|build|ci|style|revert)(?:\([^)]*\))?!?:\s*/i, '')
    .replace(/\s*\(#\d+\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fileTitle(file: PlanFile): string {
  const name = FILE_NAME.exec(file.path)?.[0] ?? file.path;
  switch (file.status) {
    case 'added':
      return `Add ${name}`;
    case 'deleted':
      return `Remove ${name}`;
    case 'renamed':
      return `Rename ${FILE_NAME.exec(file.previousPath ?? file.path)?.[0] ?? name} to ${name}`;
    default:
      return `Update ${name}`;
  }
}

function groupTitle(files: readonly PlanFile[]): string {
  const [first] = files;
  if (first === undefined) return 'Changes';
  if (files.length === 1) return fileTitle(first);
  const names = new Set(files.map((file) => FILE_NAME.exec(file.path)?.[0] ?? file.path));
  if (names.size === 1) return `Update ${[...names][0] ?? 'files'} (${files.length} files)`;
  const stems = new Set(files.map((file) => stemOf(file.path)));
  if (stems.size === 1) return `Update ${[...stems][0] ?? 'files'} (${files.length} files)`;
  const directories = new Set(files.map((file) => directoryOf(file.path)));
  if (directories.size === 1) {
    const directory = [...directories][0] ?? '';
    return directory === '' ? `Update ${files.length} files` : `Update ${FILE_NAME.exec(directory)?.[0] ?? directory} (${files.length} files)`;
  }
  return `Update ${files.length} files`;
}

/**
 * The rules producer. Hidden files are held back for `supporting`; the rest
 * is grouped by commit co-change (files one commit touched are one candidate,
 * merged while the union stays under the size cap), then by a symbol one hunk
 * defines and another mentions, then by a shared file stem and finally a
 * shared directory between lone files. Titles come from the first commit
 * that formed a group, else the files' names.
 */
export function rulesProposals(input: PlanInput): readonly StepProposal[] {
  const files = new Map(input.files.map((file) => [file.path, file] as const));
  const visible = input.files.filter((file) => file.hidden === null);
  const refs = visible.flatMap((file) => refsOf(file));
  const groups = new Groups();
  for (const ref of refs) groups.add(refKey(ref), refSize(files, ref));
  const refsByPath = new Map<string, HunkRef[]>();
  for (const ref of refs) {
    const list = refsByPath.get(ref.path) ?? [];
    list.push(ref);
    refsByPath.set(ref.path, list);
  }

  // A file's hunks stay together unless the file alone is over the cap; the commit pass joins whole files.
  for (const list of refsByPath.values()) {
    for (let index = 1; index < list.length; index += 1) {
      const a = list[0];
      const b = list[index];
      if (a !== undefined && b !== undefined) groups.union(refKey(a), refKey(b), null, null);
    }
  }

  // 1. Commit co-change.
  input.commits.forEach((commit, commitIndex) => {
    const touched = (commit.files ?? []).filter((path) => refsByPath.has(path));
    const [first, ...rest] = touched;
    if (first === undefined) return;
    const anchor = refsByPath.get(first)?.[0];
    if (anchor === undefined) return;
    const root = groups.find(refKey(anchor));
    if (!groups.commitOf.has(root)) groups.commitOf.set(root, commitIndex);
    for (const path of rest) {
      const other = refsByPath.get(path)?.[0];
      if (other !== undefined) groups.union(refKey(anchor), refKey(other), STEP_SIZE_CAP, commitIndex);
    }
  });

  // 2. Symbol co-occurrence: a hunk defining a name joins a hunk whose added lines mention it.
  const defined = new Map<string, HunkRef[]>();
  const mentioned: Array<{ readonly ref: HunkRef; readonly words: ReadonlySet<string> }> = [];
  for (const ref of refs) {
    const hunk = files.get(ref.path)?.hunks[ref.hunk];
    if (hunk === undefined) continue;
    for (const name of definedSymbols(hunk.added)) {
      const list = defined.get(name) ?? [];
      list.push(ref);
      defined.set(name, list);
    }
    mentioned.push({ ref, words: mentionedSymbols(hunk.added) });
  }
  for (const [name, definers] of defined) {
    const definer = definers[0];
    if (definer === undefined) continue;
    for (const entry of mentioned) {
      if (entry.ref.path === definer.path || !entry.words.has(name)) continue;
      groups.union(refKey(definer), refKey(entry.ref), STEP_SIZE_CAP, null);
    }
  }

  // 3. Path: the same stem anywhere (search.ts, search.css, Search.tsx), then the same directory between lone files.
  const byStem = new Map<string, string[]>();
  for (const path of refsByPath.keys()) {
    const stem = stemOf(path);
    if (GENERIC_STEMS.has(stem) || stem.length < 3) continue;
    const list = byStem.get(stem) ?? [];
    list.push(path);
    byStem.set(stem, list);
  }
  for (const paths of byStem.values()) {
    const [first, ...rest] = paths;
    const anchor = first === undefined ? undefined : refsByPath.get(first)?.[0];
    if (anchor === undefined) continue;
    for (const path of rest) {
      const other = refsByPath.get(path)?.[0];
      if (other !== undefined) groups.union(refKey(anchor), refKey(other), STEP_SIZE_CAP, null);
    }
  }
  // Lone files that share a whole name (three `package.json`s) or a directory join each other.
  const pathsPerGroup = new Map<string, Set<string>>();
  for (const [root, keys] of groups.members(refs.map(refKey))) pathsPerGroup.set(root, new Set(keys.map((key) => parseRefKey(key)?.path ?? '')));
  const lone = [...refsByPath.keys()].filter((path) => {
    const first = refsByPath.get(path)?.[0];
    return first !== undefined && (pathsPerGroup.get(groups.find(refKey(first)))?.size ?? 0) === 1;
  });
  const byName = new Map<string, string[]>();
  const byDirectory = new Map<string, string[]>();
  for (const path of lone) {
    const name = (FILE_NAME.exec(path)?.[0] ?? path).toLowerCase();
    const named = byName.get(name) ?? [];
    named.push(path);
    byName.set(name, named);
    const list = byDirectory.get(directoryOf(path)) ?? [];
    list.push(path);
    byDirectory.set(directoryOf(path), list);
  }
  for (const paths of [...byName.values(), ...byDirectory.values()]) {
    const [first, ...rest] = paths;
    const anchor = first === undefined ? undefined : refsByPath.get(first)?.[0];
    if (anchor === undefined) continue;
    for (const path of rest) {
      const other = refsByPath.get(path)?.[0];
      if (other !== undefined) groups.union(refKey(anchor), refKey(other), STEP_SIZE_CAP, null);
    }
  }

  // Steps, in the order of the first commit that touched them, then by path.
  const fileOrder = new Map(input.files.map((file, index) => [file.path, index] as const));
  const firstCommitOf = new Map<string, number>();
  input.commits.forEach((commit, index) => {
    for (const path of commit.files ?? []) if (!firstCommitOf.has(path)) firstCommitOf.set(path, index);
  });
  const proposals: Array<StepProposal & { readonly order: readonly [number, number] }> = [];
  let counter = 0;
  for (const [root, keys] of groups.members(refs.map(refKey))) {
    const touches = keys
      .map(parseRefKey)
      .filter((ref): ref is HunkRef => ref !== null)
      .sort(compareRefs(fileOrder));
    const paths = [...new Set(touches.map((ref) => ref.path))];
    const stepFiles = paths.map((path) => files.get(path)).filter((file): file is PlanFile => file !== undefined);
    const commitIndex = groups.commitOf.get(root);
    const commit = commitIndex === undefined ? undefined : input.commits[commitIndex];
    const commitTitle = commit === undefined ? '' : cleanCommitTitle(commit.message);
    const title = commitTitle !== '' ? commitTitle : groupTitle(stepFiles);
    counter += 1;
    proposals.push({
      key: `r${counter}`,
      title,
      kind: kindFor(commit === undefined ? [] : [commit.message], paths),
      gist: null,
      touches,
      dependsOn: [],
      watch: [],
      order: [Math.min(...paths.map((path) => firstCommitOf.get(path) ?? Number.MAX_SAFE_INTEGER)), fileOrder.get(paths[0] ?? '') ?? 0],
    });
  }
  proposals.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1]);
  // Two steps with one name (two `Update index.ts`) are told apart by their directories.
  const titleCounts = new Map<string, number>();
  for (const proposal of proposals) titleCounts.set(proposal.title, (titleCounts.get(proposal.title) ?? 0) + 1);
  return proposals.map((proposal) => {
    let title = proposal.title;
    if ((titleCounts.get(title) ?? 0) > 1) {
      const directory = directoryOf(proposal.touches[0]?.path ?? '');
      if (directory !== '') title = `${title} · ${directory}`;
    }
    return { key: proposal.key, title, kind: proposal.kind, gist: proposal.gist, touches: proposal.touches, dependsOn: proposal.dependsOn, watch: proposal.watch };
  });
}

/* ------------------------------------------------------------------------- */
/* Normalisation: the invariants every plan keeps                             */
/* ------------------------------------------------------------------------- */

export interface NormalizeOptions {
  readonly producer: PlanProducer;
  readonly model: string | null;
  readonly madeAt: string;
  readonly fromHeaders?: boolean;
}

/** Which touched file a hidden file supports: the same stem in the same directory first, then the same stem anywhere. */
function supportTarget(hidden: PlanFile, touchedPaths: readonly string[]): string | null {
  const stem = stemOf(hidden.path);
  const directory = directoryOf(hidden.path).replace(/\/(__tests__|__snapshots__|__mocks__|tests?|specs?|__fixtures__|fixtures)$/i, '');
  let best: string | null = null;
  for (const path of touchedPaths) {
    if (stemOf(path) !== stem) continue;
    if (directoryOf(path) === directory) return path;
    best ??= path;
  }
  return best;
}

/** Title for the trailing step that gathers hidden files no step claimed, by what hides them. */
function leftoverTitle(files: readonly PlanFile[]): { readonly title: string; readonly kind: StepKind } {
  const ids = new Set(files.map((file) => file.hidden?.id ?? ''));
  if (ids.size === 1) {
    const [only] = files;
    const id = only?.hidden?.id ?? '';
    const title = only?.hidden?.title ?? 'Supporting changes';
    return { title, kind: id === 'tests' ? 'tests' : id === 'generated' ? 'generated' : id === 'docs' ? 'docs' : 'chore' };
  }
  return { title: 'Supporting changes', kind: 'chore' };
}

/** Kahn's ordering by `dependsOn`, ties and cycles broken by the producer's order. */
function topologicalOrder<T extends { readonly key: string; readonly dependsOn: readonly string[] }>(steps: readonly T[]): readonly T[] {
  const byKey = new Map(steps.map((step) => [step.key, step] as const));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const step of steps) {
    const deps = step.dependsOn.filter((dep) => byKey.has(dep) && dep !== step.key);
    indegree.set(step.key, deps.length);
    for (const dep of deps) {
      const list = dependents.get(dep) ?? [];
      list.push(step.key);
      dependents.set(dep, list);
    }
  }
  const ordered: T[] = [];
  const placed = new Set<string>();
  while (ordered.length < steps.length) {
    // The first (in producer order) step with no unplaced dependency; a cycle leaves none, so the first unplaced goes.
    const next = steps.find((step) => !placed.has(step.key) && (indegree.get(step.key) ?? 0) === 0) ?? steps.find((step) => !placed.has(step.key));
    if (next === undefined) break;
    placed.add(next.key);
    ordered.push(next);
    for (const dependent of dependents.get(next.key) ?? []) indegree.set(dependent, (indegree.get(dependent) ?? 1) - 1);
  }
  return ordered;
}

/**
 * Hold a producer's proposals to the plan's rules: every visible hunk in
 * exactly one step (duplicates dropped from the later step, omissions
 * gathered into a trailing step), hidden files as `supporting` of the step
 * whose file they name (else a trailing step of their own), steps ordered by
 * `dependsOn` and then as proposed, oversized steps split by file, and ids
 * that follow the first hunk's signature across replans.
 */
export function normalizePlan(input: PlanInput, proposals: readonly StepProposal[], options: NormalizeOptions): ReviewPlan {
  const files = new Map(input.files.map((file) => [file.path, file] as const));
  const fileOrder = new Map(input.files.map((file, index) => [file.path, index] as const));
  const visibleRefs = new Map<string, HunkRef>();
  const hiddenRefs = new Map<string, HunkRef>();
  for (const file of input.files) {
    for (const ref of refsOf(file)) (file.hidden === null ? visibleRefs : hiddenRefs).set(refKey(ref), ref);
  }

  // Claim hunks in producer order; a hidden ref named in `touches` becomes that step's supporting change.
  const claimed = new Set<string>();
  interface Draft {
    readonly key: string;
    readonly title: string;
    readonly kind: StepKind;
    readonly gist: string | null;
    readonly touches: HunkRef[];
    readonly supporting: HunkRef[];
    readonly dependsOn: readonly string[];
    readonly watch: readonly string[];
  }
  const drafts: Draft[] = [];
  for (const proposal of proposals) {
    const draft: Draft = { key: proposal.key, title: proposal.title.trim() || 'Changes', kind: proposal.kind, gist: proposal.gist, touches: [], supporting: [], dependsOn: proposal.dependsOn, watch: proposal.watch.slice(0, 3) };
    for (const ref of proposal.touches) {
      const key = refKey(ref);
      if (claimed.has(key)) continue;
      if (visibleRefs.has(key)) {
        claimed.add(key);
        draft.touches.push(ref);
      } else if (hiddenRefs.has(key)) {
        claimed.add(key);
        draft.supporting.push(ref);
      }
    }
    if (draft.touches.length > 0 || draft.supporting.length > 0) drafts.push(draft);
  }

  const unassigned = [...visibleRefs.values()].filter((ref) => !claimed.has(refKey(ref))).sort(compareRefs(fileOrder));
  if (unassigned.length > 0) {
    drafts.push({ key: '__unassigned', title: 'Everything else', kind: 'other', gist: null, touches: [...unassigned], supporting: [], dependsOn: [], watch: [] });
    for (const ref of unassigned) claimed.add(refKey(ref));
  }

  // Hidden files follow the step whose file they name; the rest form a trailing step.
  const leftovers: HunkRef[] = [];
  const touchedPathsOf = (draft: Draft): readonly string[] => [...new Set(draft.touches.map((ref) => ref.path))];
  for (const ref of hiddenRefs.values()) {
    if (claimed.has(refKey(ref))) continue;
    const file = files.get(ref.path);
    const target = file === undefined ? null : supportTarget(file, drafts.flatMap(touchedPathsOf));
    const owner = target === null ? undefined : drafts.find((draft) => touchedPathsOf(draft).includes(target));
    if (owner === undefined) leftovers.push(ref);
    else owner.supporting.push(ref);
    claimed.add(refKey(ref));
  }
  if (leftovers.length > 0) {
    const leftoverFiles = [...new Set(leftovers.map((ref) => ref.path))].map((path) => files.get(path)).filter((file): file is PlanFile => file !== undefined);
    const { title, kind } = leftoverTitle(leftoverFiles);
    drafts.push({ key: '__supporting', title, kind, gist: null, touches: [], supporting: leftovers.sort(compareRefs(fileOrder)), dependsOn: [], watch: [] });
  }

  // Oversized steps are split by file: "Title · file".
  const sized: Draft[] = [];
  for (const draft of drafts) {
    const size = draft.touches.reduce((sum, ref) => sum + refSize(files, ref), 0);
    const paths = touchedPathsOf(draft);
    if (size <= STEP_SIZE_CAP || paths.length < 2) {
      sized.push(draft);
      continue;
    }
    paths.forEach((path, index) => {
      const name = FILE_NAME.exec(path)?.[0] ?? path;
      sized.push({
        ...draft,
        key: `${draft.key}/${index}`,
        title: `${draft.title} · ${name}`,
        touches: draft.touches.filter((ref) => ref.path === path),
        supporting: index === 0 ? draft.supporting : [],
        dependsOn: index === 0 ? draft.dependsOn : [`${draft.key}/${index - 1}`],
      });
    });
  }

  const ordered = topologicalOrder(sized);
  // Stable ids: the first hunk's signature (first in file order, then hunk order); a collision takes a suffix.
  const idByKey = new Map<string, string>();
  const used = new Set<string>();
  for (const draft of ordered) {
    draft.touches.sort(compareRefs(fileOrder));
    draft.supporting.sort(compareRefs(fileOrder));
    const first = draft.touches[0] ?? draft.supporting[0];
    let id = first === undefined ? hashText(draft.title) : `s-${refSignature(files, first)}`;
    while (used.has(id)) id = `${id}'`;
    used.add(id);
    idByKey.set(draft.key, id);
  }
  const lineAt = (ref: HunkRef): readonly [number, number] => {
    const hunk = files.get(ref.path)?.hunks[ref.hunk];
    return hunk === undefined ? [0, Number.MAX_SAFE_INTEGER] : [hunk.newStart, hunk.newStart + Math.max(1, hunk.newLines)];
  };
  const steps: ReviewStep[] = ordered.map((draft) => {
    const id = idByKey.get(draft.key) ?? draft.key;
    const signatures = [...draft.touches, ...draft.supporting].map((ref) => refSignature(files, ref));
    const findings = input.findings
      .filter((finding) =>
        draft.touches.some((ref) => {
          if (ref.path !== finding.path) return false;
          if (finding.line === undefined) return true;
          const [start, end] = lineAt(ref);
          return finding.line >= start && finding.line < end;
        }),
      )
      .map((finding) => finding.id);
    return {
      id,
      title: draft.title,
      kind: draft.kind,
      story: null,
      why: null,
      gist: draft.gist,
      touches: draft.touches,
      supporting: draft.supporting,
      dependsOn: draft.dependsOn.map((dep) => idByKey.get(dep)).filter((dep): dep is string => dep !== undefined && dep !== id),
      watch: draft.watch,
      findings,
      fingerprint: hashText([...signatures].sort().join('\n')),
      signatures,
    };
  });

  return {
    id: hashText(`${input.headSha}\n${steps.map((step) => step.id).join('\n')}`),
    headSha: input.headSha,
    madeAt: options.madeAt,
    producer: options.producer,
    model: options.model,
    steps,
    unassigned,
    fromHeaders: options.fromHeaders === true,
  };
}

/** The rules producer end to end. */
export function rulesPlan(input: PlanInput, madeAt: string): ReviewPlan {
  return normalizePlan(input, rulesProposals(input), { producer: 'rules', model: null, madeAt });
}

/* ------------------------------------------------------------------------- */
/* Progress                                                                   */
/* ------------------------------------------------------------------------- */

export type StepState = 'accepted' | 'flagged';

export interface StepProgress {
  readonly state: StepState;
  readonly at: string;
  readonly note?: string;
  /** The step's fingerprint when the mark was made; a different one now means the hunks changed since. */
  readonly fingerprint: string;
}

export interface ReviewProgress {
  readonly planId: string;
  readonly steps: Readonly<Record<string, StepProgress>>;
  readonly current: string | null;
}

/** What the stepper shows for a step: pending, accepted, flagged, or changed since it was marked. */
export type StepDisplayState = 'pending' | 'accepted' | 'flagged' | 'changed';

export function stepDisplayState(step: ReviewStep, progress: ReviewProgress | null): StepDisplayState {
  const mark = progress?.steps[step.id];
  if (mark === undefined) return 'pending';
  if (mark.fingerprint !== step.fingerprint) return 'changed';
  return mark.state;
}

/** Progress for `next`, keeping every mark whose step still exists; the plan id follows the new plan. */
export function carryProgress(progress: ReviewProgress | null, next: ReviewPlan): ReviewProgress {
  if (progress === null) return { planId: next.id, steps: {}, current: null };
  const ids = new Set(next.steps.map((step) => step.id));
  const steps = Object.fromEntries(Object.entries(progress.steps).filter(([id]) => ids.has(id)));
  return { planId: next.id, steps, current: progress.current !== null && ids.has(progress.current) ? progress.current : null };
}

/** The first step that is neither accepted nor flagged (a changed step counts as pending), after `after` when given. */
export function nextPendingStep(plan: ReviewPlan, progress: ReviewProgress | null, after: string | null = null): ReviewStep | null {
  const start = after === null ? 0 : plan.steps.findIndex((step) => step.id === after) + 1;
  const pending = (step: ReviewStep): boolean => {
    const state = stepDisplayState(step, progress);
    return state === 'pending' || state === 'changed';
  };
  return plan.steps.slice(start).find(pending) ?? plan.steps.find(pending) ?? null;
}

export function reviewComplete(plan: ReviewPlan, progress: ReviewProgress | null): boolean {
  return plan.steps.length > 0 && plan.steps.every((step) => {
    const state = stepDisplayState(step, progress);
    return state === 'accepted' || state === 'flagged';
  });
}

/* ------------------------------------------------------------------------- */
/* Replan                                                                     */
/* ------------------------------------------------------------------------- */

/** How a new diff relates to the one a plan was made from, hunk by hunk, for the replan prompt. */
export interface PlanDelta {
  /** Signatures present now that the previous plan did not know. */
  readonly added: readonly string[];
  /** Signatures the previous plan had that are gone now. */
  readonly removed: readonly string[];
}

export function planDelta(previousSignatures: ReadonlySet<string>, input: PlanInput): PlanDelta {
  const files = new Map(input.files.map((file) => [file.path, file] as const));
  const current = new Set(input.files.flatMap((file) => refsOf(file).map((ref) => refSignature(files, ref))));
  return {
    added: [...current].filter((signature) => !previousSignatures.has(signature)),
    removed: [...previousSignatures].filter((signature) => !current.has(signature)),
  };
}

/** The signatures of every hunk a plan assigned, for {@link planDelta}. */
export function planSignatures(plan: ReviewPlan): ReadonlySet<string> {
  return new Set(plan.steps.flatMap((step) => step.signatures));
}

/**
 * A plan made for an earlier head, laid over the diff as it is now: each
 * step keeps the hunks whose signatures it knows (wherever they sit now),
 * and the hunks the plan never saw are left for `normalizePlan` to gather
 * into its trailing step. What a push leaves readable without a model call;
 * the replan prompt starts from these too.
 */
export function remapProposals(plan: ReviewPlan, input: PlanInput): readonly StepProposal[] {
  const files = new Map(input.files.map((file) => [file.path, file] as const));
  const bySignature = new Map<string, HunkRef[]>();
  for (const file of input.files) {
    for (const ref of refsOf(file)) {
      const signature = refSignature(files, ref);
      const list = bySignature.get(signature) ?? [];
      list.push(ref);
      bySignature.set(signature, list);
    }
  }
  const taken = new Set<string>();
  const claim = (signature: string): HunkRef | undefined => {
    const ref = (bySignature.get(signature) ?? []).find((candidate) => !taken.has(refKey(candidate)));
    if (ref !== undefined) taken.add(refKey(ref));
    return ref;
  };
  return plan.steps.flatMap((step) => {
    const touches = step.signatures.map(claim).filter((ref): ref is HunkRef => ref !== undefined);
    if (touches.length === 0) return [];
    return [{ key: step.id, title: step.title, kind: step.kind, gist: step.gist, touches, dependsOn: step.dependsOn, watch: step.watch }];
  });
}

/* ------------------------------------------------------------------------- */
/* Words                                                                      */
/* ------------------------------------------------------------------------- */

export const STEP_KIND_LABELS: Readonly<Record<StepKind, string>> = {
  feature: 'Feature',
  fix: 'Fix',
  refactor: 'Refactor',
  tests: 'Tests',
  docs: 'Docs',
  chore: 'Chore',
  generated: 'Generated',
  other: 'Other',
};

/** Paths a step touches, each once, with how many hunks: for a "Touches" line. */
export function touchesSummary(step: ReviewStep): readonly { readonly path: string; readonly hunks: number }[] {
  const counts = new Map<string, number>();
  for (const ref of step.touches) counts.set(ref.path, (counts.get(ref.path) ?? 0) + 1);
  return [...counts].map(([path, hunks]) => ({ path, hunks }));
}

/** The review body Geld prefills at the finish: flagged steps and their notes under one line the reader may delete. */
export function finishBody(plan: ReviewPlan, progress: ReviewProgress | null): string {
  const flagged = plan.steps.filter((step) => progress?.steps[step.id]?.state === 'flagged');
  const lines: string[] = [`Reviewed in ${plan.steps.length} ${plan.steps.length === 1 ? 'step' : 'steps'} with Geld.`];
  if (flagged.length > 0) {
    lines.push('');
    for (const step of flagged) {
      const note = progress?.steps[step.id]?.note?.trim() ?? '';
      lines.push(note === '' ? `- **${step.title}**` : `- **${step.title}**: ${note}`);
    }
  }
  return lines.join('\n');
}
