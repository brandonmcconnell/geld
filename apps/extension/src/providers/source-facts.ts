import { describeRepository, repositoryKey } from '@geld/core';
import type { RepositoryIdentity } from '@geld/core';
import type { ProviderDiffEntry, ProviderDiffResult, ProviderDiffView, ProviderPage } from './types';

export interface ProviderSourceSubject {
  readonly repository: RepositoryIdentity;
  readonly url: string;
  readonly version: string;
  readonly headSha: string | null;
}

export interface ProviderGitLabTarget {
  readonly id: string;
  readonly headSha: string;
  readonly startSha: string;
  readonly mergeHead: boolean;
}

export type ProviderAcquiredComparison =
  | { readonly kind: 'gitlab-review'; readonly headSha: string; readonly baseSha: string; readonly diffId: string | null; readonly commitId: string | null; readonly projectPath: string | null; readonly target: ProviderGitLabTarget | null }
  | { readonly kind: 'gitlab-commit' | 'gitlab-compare'; readonly headSha: string; readonly baseSha: string | null }
  | { readonly kind: 'bitbucket-review'; readonly headSha: string; readonly baseSha: string; readonly sourceRepository: string | null; readonly topic: true }
  | { readonly kind: 'bitbucket-commit'; readonly headSha: string; readonly baseSha: null };

export interface ProviderNewPathFact {
  readonly path: string;
  readonly newPath: string;
}

export interface ProviderDiffSourceFacts {
  readonly schema: 1;
  readonly subject: ProviderSourceSubject;
  readonly comparison: ProviderAcquiredComparison;
  readonly newPaths: readonly ProviderNewPathFact[];
}

export type ProviderNativeComparison =
  | { readonly kind: 'gitlab-native-reload'; readonly sourceId: string; readonly sourceHeadSha: string; readonly baseSha: string; readonly startSha: string; readonly nativeViewKey: string }
  | { readonly kind: 'gitlab-review'; readonly sourceId: string; readonly sourceHeadSha: string; readonly baseSha: string; readonly startSha: string; readonly target: ProviderGitLabTarget }
  | { readonly kind: 'gitlab-standalone' | 'bitbucket-commit' };

export interface ProviderNativeNewSource {
  readonly subject: ProviderSourceSubject;
  readonly repository: RepositoryIdentity;
  readonly path: string;
  readonly headSha: string;
  readonly comparison: ProviderNativeComparison;
}

export interface ProviderNativeSourceFrame {
  readonly key: string;
  current(): boolean;
  read(entry: ProviderDiffEntry): ProviderNativeNewSource | null;
}

export interface ProviderNewFileRevision {
  readonly repository: RepositoryIdentity;
  readonly path: string;
  readonly headSha: string;
  readonly key: string;
}

export interface ProviderOutlineContext {
  readonly subjectKey: string;
  readonly newSources: ReadonlyMap<HTMLElement, ProviderNewFileRevision>;
  readonly commentCoordinateMismatches?: ReadonlySet<HTMLElement>;
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function array(value: unknown): value is readonly unknown[] { return Array.isArray(value); }
export function providerNativeSourceElement(node: Element): boolean {
  return node.closest('[data-geld-ui], [hidden], [inert], [aria-hidden="true"], form, textarea, button, [role="button"], [contenteditable], dialog, [role="dialog"], [role="tooltip"], [popover], [data-testid="noteable-note-container"], li.js-timeline-entry.system-note, .note, .note-text, [data-testid="description-content"], .md, [data-testid="comment"], [data-qa="pull-request-description"], [data-qa="pull-request-overview-activity-content"], .ak-renderer-document') === null;
}
export function providerFullSha(value: unknown): value is string { return typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value); }
export function providerSourcePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || /[\\\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.split('/').some((part) => part === '' || part === '.' || part === '..')) return false;
  try { encodeURIComponent(value);return true; } catch { return false; }
}
export function providerSourceId(value: unknown): string | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  return typeof value === 'string' && value.length <= 32 && /^[1-9]\d*$/.test(value) ? value : null;
}

function repository(value: unknown): RepositoryIdentity | null {
  if (!record(value) || (value.provider !== 'gitlab' && value.provider !== 'bitbucket') || typeof value.origin !== 'string' || typeof value.path !== 'string') return null;
  try {
    const url = new URL(`${value.origin}/${value.path}${value.provider === 'gitlab' ? '/-/' : ''}`);
    const found = describeRepository(url, value.provider);
    return url.protocol === 'https:' && url.origin === value.origin && url.username === '' && url.password === '' && url.search === '' && url.hash === '' && found !== null && found.path === value.path && found.origin === value.origin ? found : null;
  } catch { return null; }
}

function subjectKind(subject: ProviderSourceSubject): 'review' | 'commit' | 'compare' | null {
  const path = new URL(subject.url).pathname;
  const prefix = `/${subject.repository.path}/`;
  if (!path.startsWith(prefix)) return null;
  const route = path.slice(prefix.length);
  if (subject.repository.provider === 'bitbucket') {
    if (/^pull-requests\/[1-9]\d*$/.test(route)) return 'review';
    return /^commits\/(?:[0-9a-f]{7,40}|[0-9a-f]{64})$/.test(route) ? 'commit' : null;
  }
  if (/^-\/merge_requests\/[1-9]\d*$/.test(route)) return 'review';
  if (/^-\/commit\/(?:[0-9a-f]{7,40}|[0-9a-f]{64})$/.test(route)) return 'commit';
  return /^-\/compare\/.+\.\.\..+$/.test(route) ? 'compare' : null;
}

function parseSubject(value: unknown): ProviderSourceSubject | null {
  if (!record(value) || typeof value.url !== 'string' || value.url.length > 8192 || typeof value.version !== 'string' || value.version.length > 2048 || (value.headSha !== null && !providerFullSha(value.headSha))) return null;
  const owner = repository(value.repository);
  if (owner === null) return null;
  try {
    const url = new URL(value.url);
    const found = describeRepository(url, owner.provider);
    if (url.origin !== owner.origin || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || url.href !== value.url || found === null || repositoryKey(found) !== repositoryKey(owner)) return null;
    const result = { repository: owner, url: value.url, version: value.version, headSha: value.headSha };
    return subjectKind(result) === null ? null : result;
  } catch { return null; }
}

export function providerSourceSubject(page: ProviderPage): ProviderSourceSubject {
  return { repository: page.repository, url: page.url, version: page.version, headSha: page.headSha?.toLowerCase() ?? null };
}

export function providerSourceSubjectKey(subject: ProviderSourceSubject): string {
  return JSON.stringify([repositoryKey(subject.repository), subject.url, subject.version, subject.headSha]);
}

export function parseProviderGitLabTarget(value: unknown): ProviderGitLabTarget | null {
  if (!record(value) || providerSourceId(value.id) === null || !providerFullSha(value.headSha) || !providerFullSha(value.startSha) || typeof value.mergeHead !== 'boolean') return null;
  const id = providerSourceId(value.id);
  return id === null ? null : { id, headSha: value.headSha, startSha: value.startSha, mergeHead: value.mergeHead };
}

function parseComparison(value: unknown, subject: ProviderSourceSubject): ProviderAcquiredComparison | null {
  if (!record(value) || !providerFullSha(value.headSha) || (subject.headSha !== null && subject.headSha !== value.headSha)) return null;
  const kind = subjectKind(subject);
  if (value.kind === 'gitlab-review' && subject.repository.provider === 'gitlab' && kind === 'review') {
    if (!providerFullSha(value.baseSha) || (value.diffId !== null && (typeof value.diffId !== 'string' || providerSourceId(value.diffId) !== value.diffId)) || (value.commitId !== null && (!providerFullSha(value.commitId) || value.commitId !== value.headSha)) || (value.projectPath !== null && value.projectPath !== subject.repository.path)) return null;
    const target = value.target === null ? null : parseProviderGitLabTarget(value.target);
    if (value.target !== null && target === null) return null;
    return { kind: value.kind, headSha: value.headSha, baseSha: value.baseSha, diffId: value.diffId, commitId: value.commitId, projectPath: value.projectPath, target };
  }
  if ((value.kind === 'gitlab-commit' && kind === 'commit' || value.kind === 'gitlab-compare' && kind === 'compare') && subject.repository.provider === 'gitlab') {
    if (value.baseSha !== null && !providerFullSha(value.baseSha)) return null;
    if (value.kind === 'gitlab-compare' && value.baseSha === null) return null;
    return { kind: value.kind, headSha: value.headSha, baseSha: value.baseSha };
  }
  if (value.kind === 'bitbucket-review' && subject.repository.provider === 'bitbucket' && kind === 'review') {
    if (!providerFullSha(value.baseSha) || value.topic !== true) return null;
    if (value.sourceRepository !== null && (typeof value.sourceRepository !== 'string' || repository({ ...subject.repository, path: value.sourceRepository }) === null)) return null;
    return { kind: value.kind, headSha: value.headSha, baseSha: value.baseSha, sourceRepository: value.sourceRepository, topic: true };
  }
  if (value.kind === 'bitbucket-commit' && subject.repository.provider === 'bitbucket' && kind === 'commit' && value.baseSha === null) return { kind: value.kind, headSha: value.headSha, baseSha: null };
  return null;
}

export function parseProviderDiffSourceFacts(value: unknown): ProviderDiffSourceFacts | null {
  if (!record(value) || value.schema !== 1 || !array(value.newPaths) || value.newPaths.length > 6000) return null;
  const subject = parseSubject(value.subject);
  if (subject === null) return null;
  const comparison = parseComparison(value.comparison, subject);
  if (comparison === null) return null;
  const newPaths: ProviderNewPathFact[] = [];
  for (const entry of value.newPaths) {
    if (!record(entry) || !providerSourcePath(entry.path) || !providerSourcePath(entry.newPath)) return null;
    newPaths.push({ path: entry.path, newPath: entry.newPath });
  }
  if (new Set(newPaths.map((entry) => entry.path)).size !== newPaths.length || new Set(newPaths.map((entry) => entry.newPath)).size !== newPaths.length) return null;
  return { schema: 1, subject, comparison, newPaths };
}

export function providerDiffSourceFacts(page: ProviderPage, comparison: ProviderAcquiredComparison, newPaths: readonly ProviderNewPathFact[]): ProviderDiffSourceFacts | null {
  return page.provider === page.repository.provider ? parseProviderDiffSourceFacts({ schema: 1, subject: providerSourceSubject(page), comparison, newPaths }) : null;
}

function sameFileWitness(facts: ProviderDiffSourceFacts, newPath: string, witness: ProviderNativeNewSource): boolean {
  return providerFullSha(witness.headSha) && providerSourceSubjectKey(witness.subject) === providerSourceSubjectKey(facts.subject) && newPath === witness.path && providerSourcePath(witness.path) && repository(witness.repository) !== null;
}

function commentCoordinatesMismatch(page: ProviderPage, facts: ProviderDiffSourceFacts, newPath: string, witness: ProviderNativeNewSource): boolean {
  if (!sameFileWitness(facts, newPath, witness)) return false;
  const acquired = facts.comparison;
  const native = witness.comparison;
  // Negative new-side evidence does not require authority for an unseen whole file or its old side.
  return acquired.kind === 'gitlab-review' && (native.kind === 'gitlab-review' || native.kind === 'gitlab-native-reload')
    && acquired.commitId === null && acquired.diffId !== null && acquired.projectPath === page.repository.path
    && repositoryKey(witness.repository) === repositoryKey(page.repository)
    && native.sourceId === acquired.diffId && native.sourceHeadSha === acquired.headSha
    && providerFullSha(native.baseSha) && providerFullSha(native.startSha)
    && (native.kind === 'gitlab-native-reload' ? native.nativeViewKey.length > 0 : parseProviderGitLabTarget(native.target) !== null && native.startSha === native.target.startSha && witness.headSha === native.target.headSha)
    && witness.headSha !== acquired.headSha;
}

function bind(page: ProviderPage, facts: ProviderDiffSourceFacts, newPath: string, witness: ProviderNativeNewSource): ProviderNewFileRevision | null {
  if (!sameFileWitness(facts, newPath, witness)) return null;
  const comparison = facts.comparison;
  if (comparison.kind === 'gitlab-review') {
    const native = witness.comparison;
    if ((native.kind !== 'gitlab-review' && native.kind !== 'gitlab-native-reload') || comparison.commitId !== null || comparison.diffId === null || comparison.projectPath !== page.repository.path || repositoryKey(witness.repository) !== repositoryKey(page.repository) || native.sourceId !== comparison.diffId || native.sourceHeadSha !== comparison.headSha) return null;
    if (native.kind === 'gitlab-native-reload') {
      if (!providerFullSha(native.baseSha) || !providerFullSha(native.startSha) || native.nativeViewKey.length === 0) return null;
    } else {
      if (comparison.target === null || witness.headSha !== native.target.headSha) return null;
      const exactNativeSource = native.target.id === native.sourceId && native.target.headSha === native.sourceHeadSha && witness.headSha === comparison.headSha && native.target.mergeHead === false && providerFullSha(native.startSha) && native.startSha === native.target.startSha;
      if (!exactNativeSource && ((native.target.id !== comparison.target.id || native.target.headSha !== comparison.target.headSha || native.target.startSha !== comparison.target.startSha || native.target.mergeHead !== comparison.target.mergeHead) || native.startSha !== comparison.target.startSha)) return null;
    }
  } else if (comparison.kind === 'gitlab-commit' || comparison.kind === 'gitlab-compare') {
    if (witness.comparison.kind !== 'gitlab-standalone' || witness.headSha !== comparison.headSha || repositoryKey(witness.repository) !== repositoryKey(page.repository)) return null;
  } else if (comparison.kind === 'bitbucket-commit') {
    if (witness.comparison.kind !== 'bitbucket-commit' || page.kind !== 'commit' || !providerFullSha(page.ref) || page.ref !== comparison.headSha || witness.headSha !== comparison.headSha || repositoryKey(witness.repository) !== repositoryKey(page.repository)) return null;
  } else return null;
  return { repository: witness.repository, path: newPath, headSha: witness.headSha, key: JSON.stringify([repositoryKey(witness.repository), witness.headSha, newPath]) };
}

export function providerOutlineContext(page: ProviderPage, result: ProviderDiffResult, view: ProviderDiffView): ProviderOutlineContext {
  const sources = new Map<HTMLElement, ProviderNewFileRevision>();
  const commentCoordinateMismatches = new Set<HTMLElement>();
  const frame = view.readNewSourceFrame?.() ?? null;
  const facts = parseProviderDiffSourceFacts(result.sourceFacts);
  const sameSubject = page.provider === page.repository.provider && facts !== null && providerSourceSubjectKey(facts.subject) === providerSourceSubjectKey(providerSourceSubject(page));
  const paths = new Map(facts?.newPaths.map((file) => [file.path, file.newPath]) ?? []);
  const present = new Set(result.files.filter((file) => file.status !== 'deleted').map((file) => file.path));
  let nativeKey = frame !== null && frame.current() ? frame.key : null;
  if (nativeKey !== null && frame !== null) {
    if (result.complete && sameSubject && facts !== null) for (const entry of view.entries) {
      const newPath = paths.get(entry.path);
      if (newPath === undefined || !present.has(entry.path) || !entry.root.isConnected || view.filteredPaths.has(entry.path)) continue;
      const witness = frame.read(entry);
      if (witness === null || witness.path !== entry.path) continue;
      if (commentCoordinatesMismatch(page, facts, newPath, witness)) commentCoordinateMismatches.add(entry.root);
      const source = bind(page, facts, newPath, witness);
      if (source !== null) sources.set(entry.root, source);
    }
    if (!frame.current()) { sources.clear();commentCoordinateMismatches.clear();nativeKey = null; }
  }
  return { subjectKey: JSON.stringify([providerSourceSubjectKey(providerSourceSubject(page)), result.revision, nativeKey]), newSources: sources, commentCoordinateMismatches };
}
