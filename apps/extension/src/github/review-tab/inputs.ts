/**
 * What the planner needs from the page and the background: the pull
 * request's diff as hunks (the raw `.diff` through the worker, parsed here
 * and held in memory for this page only), Geld's classification of each
 * file, the commits with their messages (the Commits tab's JSON) and, when
 * the pull request is small enough to afford it, the files each commit
 * touched (its `.diff` through the budgeted diff source), plus the title.
 * Everything is cached per head SHA and re-read when the head moves.
 */

import type { FileHunks, HiddenCategory } from '@geld/core';
import { parseUnifiedDiffHunks } from '@geld/core';
import type { PlanCommit, PlanFile, PlanInput } from '@geld/review';
import { browser } from 'wxt/browser';
import type { FetchDiffTextRequest } from '../../lib/messages';
import { isFetchDiffTextResponse } from '../../lib/messages';
import { cleanText } from '../dom';

/** Per-commit file lists are asked for only up to this many commits: each is one request against the diff budget. */
const COMMIT_FILES_MAX = 12;
const RETRY_MS = 4000;

export interface DiffTextState {
  readonly status: 'loading' | 'ready' | 'failed';
  readonly files: readonly FileHunks[];
  readonly reason: string | null;
}

interface DiffTextEntry {
  state: DiffTextState;
  pending: boolean;
  retryAt: number;
}

const diffs = new Map<string, DiffTextEntry>();

/**
 * The page's diff as hunks, keyed by its URL and head: `loading` while the
 * worker fetches (or waits out its budget), `ready` with the files, `failed`
 * with the reason. `onChange` runs when the state moves.
 */
export function diffHunksFor(diffUrl: string, headSha: string | null, onChange: () => void): DiffTextState {
  const key = `${diffUrl}@${headSha ?? ''}`;
  let entry = diffs.get(key);
  if (entry === undefined) {
    entry = { state: { status: 'loading', files: [], reason: null }, pending: false, retryAt: 0 };
    diffs.set(key, entry);
    // One page's text at a time: the previous head's hunks are megabytes nobody reads again.
    for (const other of [...diffs.keys()]) if (other !== key && other.startsWith(`${diffUrl}@`)) diffs.delete(other);
  }
  if (!entry.pending && entry.state.status !== 'ready' && Date.now() >= entry.retryAt) {
    entry.pending = true;
    const current = entry;
    void fetchText(diffUrl).then((result) => {
      current.pending = false;
      if (result.ok) current.state = { status: 'ready', files: parseUnifiedDiffHunks(result.text), reason: null };
      else if (result.retry) {
        current.retryAt = Date.now() + (result.retryAfterMs ?? RETRY_MS);
        current.state = { status: 'loading', files: [], reason: result.reason };
        setTimeout(onChange, (result.retryAfterMs ?? RETRY_MS) + 50);
      } else current.state = { status: 'failed', files: [], reason: result.reason };
      onChange();
    });
  }
  return entry.state;
}

const TRANSIENT = new Set(['queued', 'busy', 'rate-limited', 'port-closed', 'fetch-failed']);

async function fetchText(url: string): Promise<{ readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string; readonly retry: boolean; readonly retryAfterMs?: number }> {
  const message: FetchDiffTextRequest = { type: 'geld:fetch-diff-text', url };
  let response: unknown;
  try {
    response = await browser.runtime.sendMessage(message);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'fetch-failed', retry: true };
  }
  if (!isFetchDiffTextResponse(response)) return { ok: false, reason: 'no-answer', retry: true };
  if (response.ok) return response;
  const retry = TRANSIENT.has(response.reason) || response.reason.startsWith('http-5');
  return { ok: false, reason: response.reason, retry, ...(response.retryAfterMs === undefined ? {} : { retryAfterMs: response.retryAfterMs }) };
}

/* ------------------------------------------------------------------------- */
/* Commits                                                                    */
/* ------------------------------------------------------------------------- */

interface CommitsEntry {
  commits: readonly { readonly sha: string; readonly message: string }[] | null;
  pending: Promise<void> | null;
  fetchedAt: number;
}

const commitsByPull = new Map<string, CommitsEntry>();
const COMMITS_REFRESH_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Every `{ oid, message | messageHeadline | shortMessage }` in the Commits tab payload, in the order found. */
function collectCommits(value: unknown, into: Map<string, string>, depth = 0): void {
  if (depth > 8) return;
  if (Array.isArray(value)) {
    for (const entry of value) collectCommits(entry, into, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  const oid = value.oid;
  const headline = [value.messageHeadline, value.shortMessage, value.message, value.messageHeadlineHTML].find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim() !== '');
  if (typeof oid === 'string' && /^[0-9a-f]{40}$/.test(oid) && headline !== undefined) {
    if (!into.has(oid)) into.set(oid, cleanText(headline.replace(/<[^>]+>/g, '')).split('\n')[0] ?? '');
    return;
  }
  for (const child of Object.values(value)) collectCommits(child, into, depth + 1);
}

/**
 * The pull request's commits (sha and first message line) from the Commits
 * tab's JSON, null while on their way or when GitHub would not say.
 */
export function commitsFor(pullPath: string, onChange: () => void): readonly { readonly sha: string; readonly message: string }[] | null {
  let entry = commitsByPull.get(pullPath);
  if (entry === undefined) {
    entry = { commits: null, pending: null, fetchedAt: 0 };
    commitsByPull.set(pullPath, entry);
  }
  if (entry.pending === null && entry.commits === null && (entry.fetchedAt === 0 || Date.now() - entry.fetchedAt >= COMMITS_REFRESH_MS)) {
    const current = entry;
    current.pending = (async () => {
      try {
        const response = await fetch(new URL(`${pullPath}/commits`, location.href), { credentials: 'same-origin', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } });
        if (!response.ok) return;
        const body: unknown = await response.json();
        const found = new Map<string, string>();
        collectCommits(isRecord(body) ? body.payload : null, found);
        current.commits = [...found].map(([sha, message]) => ({ sha, message }));
      } catch {
        // Not JSON (an Enterprise version without the route, an interstitial): the plan goes without commit messages.
        current.commits ??= [];
      }
    })().finally(() => {
      current.commits ??= [];
      current.fetchedAt = Date.now();
      current.pending = null;
      onChange();
    });
  }
  return entry.commits;
}

/* ------------------------------------------------------------------------- */
/* The page                                                                   */
/* ------------------------------------------------------------------------- */

/** The pull request's title as the page shows it (both experiences), else from the document title. */
export function pullTitle(): string {
  const heading = document.querySelector('h1 .js-issue-title, h1 bdi, [data-component="PH_Title"] h1, [data-testid="issue-title"]');
  const text = cleanText(heading?.textContent);
  if (text !== '') return text;
  return cleanText(document.title.replace(/\s+by\s+\S+\s+·\s+Pull Request #\d+.*$/, '').replace(/\s+·.*$/, ''));
}

/** `/owner/repo/pull/N` of the page, or null off a pull request. */
export function pullPathOf(url: URL = new URL(location.href)): string | null {
  const match = /^(\/[^/]+\/[^/]+\/pull\/\d+)(?:\/|$)/.exec(url.pathname);
  return match?.[1] ?? null;
}

export interface PlanInputSources {
  readonly diffUrl: string;
  readonly headSha: string;
  readonly pullPath: string;
  readonly classify: (path: string) => HiddenCategory | null;
  /** Paths a commit touched, or null while they load (the caller re-applies when they land); the planner asks for few. */
  readonly commitFiles: (sha: string) => readonly string[] | null;
  readonly onChange: () => void;
}

export type PlanInputState = { readonly status: 'loading'; readonly reason: string | null } | { readonly status: 'failed'; readonly reason: string } | { readonly status: 'ready'; readonly input: PlanInput; readonly commitsPending: boolean };

/** The last input built, reused while nothing it was built from has changed (a pass runs on every mutation batch). */
let memo: { readonly files: readonly FileHunks[]; readonly commitsKey: string; readonly title: string; readonly headSha: string; readonly state: PlanInputState } | null = null;

/** Assemble the planner's input, or say what is still on its way. */
export function planInputFor(sources: PlanInputSources): PlanInputState {
  const diff = diffHunksFor(sources.diffUrl, sources.headSha, sources.onChange);
  if (diff.status === 'failed') return { status: 'failed', reason: diff.reason ?? 'The diff could not be read.' };
  if (diff.status !== 'ready') return { status: 'loading', reason: diff.reason };
  const commits = commitsFor(sources.pullPath, sources.onChange);
  // The commit list is one small request; the plan waits for it, since the rules group by commit first.
  if (commits === null) return { status: 'loading', reason: null };
  let commitsPending = false;
  const planCommits: PlanCommit[] = commits.map((commit) => {
    if (commits.length > COMMIT_FILES_MAX) return { sha: commit.sha, message: commit.message };
    const files = sources.commitFiles(commit.sha);
    if (files === null) {
      commitsPending = true;
      return { sha: commit.sha, message: commit.message };
    }
    return { sha: commit.sha, message: commit.message, files };
  });
  const commitsKey = planCommits.map((commit) => `${commit.sha}:${commit.files?.length ?? '-'}`).join(',');
  const title = pullTitle();
  if (memo !== null && memo.files === diff.files && memo.commitsKey === commitsKey && memo.title === title && memo.headSha === sources.headSha) return memo.state;
  const files: PlanFile[] = diff.files.map((file) => {
    const category = sources.classify(file.path);
    return {
      path: file.path,
      ...(file.previousPath === undefined ? {} : { previousPath: file.previousPath }),
      status: file.status,
      binary: file.binary,
      hidden: category === null ? null : { id: category.id, title: category.title },
      hunks: file.hunks.map((hunk) => ({ index: hunk.index, header: hunk.header, oldStart: hunk.oldStart, oldLines: hunk.oldLines, newStart: hunk.newStart, newLines: hunk.newLines, added: hunk.added, removed: hunk.removed, signature: hunk.signature })),
    };
  });
  const state: PlanInputState = {
    status: 'ready',
    input: { title, body: null, headSha: sources.headSha, commits: planCommits, files, findings: [] },
    commitsPending,
  };
  memo = { files: diff.files, commitsKey, title, headSha: sources.headSha, state };
  return state;
}

/** Forget everything held for pages other than `diffUrl` (a navigation to another pull request). */
export function dropOtherPages(diffUrl: string): void {
  for (const key of [...diffs.keys()]) if (!key.startsWith(`${diffUrl}@`)) diffs.delete(key);
}
