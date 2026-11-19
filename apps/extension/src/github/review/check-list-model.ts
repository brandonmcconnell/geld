import type { CrawledCheckRun } from './crawler';

/** GitHub's groups in its checks list, in the order it lists them. */
export type CheckGroupId = 'failure' | 'pending' | 'in_progress' | 'skipped' | 'neutral' | 'success';
export type CheckGrouping = 'grouped' | 'ungrouped';
export type CheckGlyph = 'alert' | 'stop' | 'check' | 'x' | 'dot' | 'running' | 'square' | 'skip';
export type CheckTone = 'attention' | 'muted' | 'success' | 'danger';

export interface CheckLook {
  readonly glyph: CheckGlyph;
  readonly tone: CheckTone;
}

export interface CheckGroup {
  readonly id: CheckGroupId | 'all';
  /** GitHub's word for the group: "failing", "in progress". */
  readonly label: string;
  /** "3 failing checks", or "12 checks" with no grouping. */
  readonly heading: string;
  /** Where GitHub's merge box keeps whether the group is open, in the page's storage. */
  readonly storageKey: string;
  readonly runs: readonly CrawledCheckRun[];
}

export const CHECK_GROUP_ORDER: readonly CheckGroupId[] = ['failure', 'pending', 'in_progress', 'skipped', 'neutral', 'success'];

export const CHECK_GROUP_LABELS: Readonly<Record<CheckGroupId | 'all', string>> = {
  failure: 'failing',
  pending: 'pending',
  in_progress: 'in progress',
  skipped: 'skipped',
  neutral: 'neutral',
  success: 'successful',
  all: 'all',
};

/** The key the page's own grouping choice is kept under. GitHub's is an account preference Geld never writes. */
export const GROUPING_STORAGE_KEY = 'geld:checks-grouping';

const WAITING = new Set(['queued', 'pending', 'waiting', 'requested', 'expected']);

type RunState = Pick<CrawledCheckRun, 'status' | 'conclusion'>;

/** Mirrors the groups of GitHub's merge box: a check waiting on someone is pending, a cancelled one failing. */
export function checkGroupOf(run: RunState): CheckGroupId {
  if (run.status !== 'completed') return WAITING.has(run.status) ? 'pending' : 'in_progress';
  if (run.conclusion === 'success') return 'success';
  if (run.conclusion === 'skipped') return 'skipped';
  if (run.conclusion === 'neutral') return 'neutral';
  if (run.conclusion === 'action_required') return 'pending';
  return 'failure';
}

export function checkLookOf(run: RunState): CheckLook {
  const group = checkGroupOf(run);
  if (group === 'success') return { glyph: 'check', tone: 'success' };
  if (group === 'skipped') return { glyph: 'skip', tone: 'muted' };
  if (group === 'neutral') return { glyph: 'square', tone: 'muted' };
  if (group === 'in_progress') return { glyph: 'running', tone: 'attention' };
  if (group === 'pending') return { glyph: run.conclusion === 'action_required' ? 'alert' : 'dot', tone: 'attention' };
  return run.conclusion === 'cancelled' ? { glyph: 'stop', tone: 'muted' } : { glyph: 'x', tone: 'danger' };
}

export function expandedStorageKey(id: CheckGroupId | 'all'): string {
  return `mergebox:checksGroup:${id.toUpperCase()}Expanded`;
}

function headingOf(id: CheckGroupId | 'all', count: number): string {
  const noun = count > 1 ? 'checks' : 'check';
  return id === 'all' ? `${count} ${noun}` : `${count} ${CHECK_GROUP_LABELS[id]} ${noun}`;
}

function groupOf(id: CheckGroupId | 'all', runs: readonly CrawledCheckRun[]): CheckGroup {
  return { id, label: CHECK_GROUP_LABELS[id], heading: headingOf(id, runs.length), storageKey: expandedStorageKey(id), runs };
}

/** The list's groups as GitHub draws them: by state in its order, or one group of everything, each sorted by name. */
export function checkGroups(runs: readonly CrawledCheckRun[], grouping: CheckGrouping): readonly CheckGroup[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const sorted = [...runs].sort((a, b) => collator.compare(a.name, b.name));
  if (sorted.length === 0) return [];
  if (grouping === 'ungrouped') return [groupOf('all', sorted)];
  return CHECK_GROUP_ORDER.map((id) => groupOf(id, sorted.filter((run) => checkGroupOf(run) === id))).filter((group) => group.runs.length > 0);
}

/** Whether groups carry a heading: GitHub draws none over a single group of checks all in one state. */
export function headingsShown(groups: readonly CheckGroup[], grouping: CheckGrouping): boolean {
  if (groups.length > 1) return true;
  if (grouping !== 'ungrouped') return false;
  return new Set(groups.flatMap((group) => group.runs.map(checkGroupOf))).size > 1;
}

/** What the row says after the name. The status partial writes a status's own words after a dash, which the row drops when nothing leads it. */
export function checkWords(run: CrawledCheckRun): string {
  const words = (run.description ?? '').replace(/^[\s—–-]+/, '').trim();
  if (words !== '') return words;
  return run.status !== 'completed' && WAITING.has(run.status) ? 'Queued' : '';
}

/** GitHub writes a running or queued check's words in italics. */
export function checkWordsItalic(run: RunState): boolean {
  return run.status !== 'completed';
}

/** The row's accessible name, as GitHub's: the check, then its words with a lowercase start. */
export function checkRowLabel(name: string, words: string): string {
  return words === '' ? name : `${name} ${words.charAt(0).toLowerCase()}${words.slice(1)}`;
}

export function checkListSignature(runs: readonly CrawledCheckRun[], grouping: CheckGrouping): string {
  const rows = runs.map((run) => [run.name, run.status, run.conclusion ?? '', run.detailsUrl ?? '', run.description ?? '', run.startedAt ?? '', run.avatarUrl ?? '', run.avatarBackground ?? '', run.required === true ? '1' : '']);
  return JSON.stringify([grouping, rows]);
}

export function parseGrouping(stored: string | null): CheckGrouping {
  return stored === 'ungrouped' ? 'ungrouped' : 'grouped';
}

/** GitHub stores a group's state as a JSON boolean and opens a group it has no word on. */
export function parseExpanded(stored: string | null): boolean {
  return stored === null ? true : stored.trim() !== 'false';
}
