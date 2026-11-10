import { compareHome } from './review/teleport';
import { pageFetch } from './page-fetch';

const SHA = /^[0-9a-f]{40}$/i;

/** A commit's timeline row, in either UI. Mirrors `COMMIT_ROW` in review/crawler.ts. */
const COMMIT_ROW = '.js-commits-list-item, .js-commit-group, [data-testid="commit-row"], [data-testid="timeline-commit-row"], .TimelineItem:has(> .TimelineItem-badge .octicon-git-commit), [class*="CommitRow"]';
/** "X force-pushed the branch from a to b". Mirrors `FORCE_PUSH_ROW` in review/crawler.ts. */
const FORCE_PUSH_ROW = '.TimelineItem:has(.octicon-repo-push), [data-testid="force-pushed-event"], [class*="ForcePush"]';
const COMMENT_BODY = '.comment-body, .markdown-body, [data-testid="comment-body"]';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The conversation tab's head: the newest push in the timeline, which GitHub
 * appends live (its socket) when one lands, while the page's stale-comparison
 * poller and embedded payload keep the head it loaded with. A tab left open
 * across a push read the old head's checks and never saw the new run
 * (geld#71). A push is a commit row's own link to this pull request's commits,
 * or a force-push row's "to" commit (its Compare link, `compare/<from>..<to>`,
 * in this repository), since a rewrite can land as that one row with no commit
 * row of its own. A commit URL someone pasted in a comment is not a push, and
 * a row on loan to the digest is ordered by its home, not where it stands.
 */
export function conversationHeadSha(): string | null {
  const conversation = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/.exec(window.location.pathname);
  if (conversation === null) return null;
  const repo = `/${conversation[1]}/${conversation[2]}`;
  const commits = `${repo}/pull/${conversation[3]}/commits/`;
  // The Overview's commit rows lead to the commit in the Changes tab instead.
  const changes = `${repo}/pull/${conversation[3]}/changes/`;
  const compare = `${repo}/compare/`;
  const commitLink = new RegExp(`^(?:https?://[^/]+)?${escapeRegExp(`${repo}/pull/${conversation[3]}/`)}(?:commits|changes)/([0-9a-f]{40})(?:[/?#]|$)`, 'i');
  const compareLink = new RegExp(`^(?:https?://[^/]+)?${escapeRegExp(compare)}[0-9a-f]{40}\\.\\.([0-9a-f]{40})(?:[/?#]|$)`, 'i');
  const pushes: { readonly row: Element; readonly sha: string }[] = [];
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>(`a[href*="${commits}"], a[href*="${changes}"], a[href*="${compare}"]`)) {
    const href = anchor.getAttribute('href') ?? '';
    if (anchor.closest(COMMENT_BODY) !== null) continue;
    const sha = commitLink.exec(href)?.[1];
    if (sha !== undefined) {
      const row = anchor.closest(COMMIT_ROW);
      if (row !== null) pushes.push({ row, sha: sha.toLowerCase() });
      continue;
    }
    const target = compareLink.exec(href)?.[1];
    if (target === undefined) continue;
    const row = anchor.closest(FORCE_PUSH_ROW);
    if (row !== null && /\bforce-pushed\b/i.test(row.textContent ?? '')) pushes.push({ row, sha: target.toLowerCase() });
  }
  if (pushes.length === 0) return null;
  const ordered = [...pushes].sort((a, b) => compareHome(a.row, b.row));
  const newest = ordered[ordered.length - 1]?.sha ?? null;
  // The page names its head before the timeline has streamed in, and the timeline shows older commits first: the newest
  // row read then is an older commit, and every pass re-keyed the diff, the checks and the header's counts to it as it
  // moved (vitest#10554 read 0619ed2, then 2a9f6e2, then the head). The page's own head stands until a push lands after
  // its row, which is a push since the page loaded.
  const loaded = loadedHeadSha();
  if (loaded === null) return newest;
  const at = ordered.findIndex((push) => push.sha === loaded);
  return at >= 0 && at < ordered.length - 1 ? newest : loaded;
}

/**
 * Find the head commit of the pull request on the current page without any
 * network request. Both GitHub UIs leak it in a few stable places.
 */
export function detectHeadSha(): string | null {
  return conversationHeadSha() ?? loadedHeadSha();
}

/**
 * The head GitHub named when asked (`fetchHeadSha`), for one pull request: it outranks the page's embedded payload,
 * which GitHub's router keeps from the document's first page across soft navigations (its route data carries no
 * head), so a pull request reached that way after a push read the head it had when the tab first loaded.
 */
let askedHead: { readonly pullPath: string; readonly sha: string } | null = null;

/** `/owner/repo/pull/N` of the current page, or null. */
function currentPullPath(): string | null {
  return /^\/[^/]+\/[^/]+\/pull\/\d+/.exec(window.location.pathname)?.[0] ?? null;
}

export function rememberAskedHead(pullPath: string, sha: string): void {
  askedHead = { pullPath, sha: sha.toLowerCase() };
}

export function forgetAskedHead(): void {
  askedHead = null;
}

/** Whether the document is no longer at the address it loaded (a copy injected after a soft navigation). */
export function documentNavigatedSinceLoad(): boolean {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') return false;
  const entry = performance.getEntriesByType('navigation')[0];
  if (entry === undefined) return false;
  try {
    return new URL(entry.name).pathname !== window.location.pathname;
  } catch {
    return false;
  }
}

/**
 * `embeddedHeadSha` for this page, kept while the element that named it is in the document: the regex runs over
 * GitHub's embedded payload, and this is asked every pass.
 */
let loadedHead: { readonly source: Element; readonly sha: string } | null = null;
function loadedHeadSha(): string | null {
  if (askedHead !== null && askedHead.pullPath === currentPullPath()) return askedHead.sha;
  if (loadedHead !== null && loadedHead.source.isConnected) return loadedHead.sha;
  loadedHead = embeddedHeadSha();
  return loadedHead?.sha ?? null;
}

/** The head the page itself was rendered for, from the hooks its markup carries, not from the timeline's rows. */
function embeddedHeadSha(): { readonly source: Element; readonly sha: string } | null {
  // Legacy files view: progressive diff loaders carry `sha2=<head>`.
  for (const element of document.querySelectorAll('[data-fragment-url*="sha2="]')) {
    const match = /[?&]sha2=([0-9a-f]{40})/i.exec(element.getAttribute('data-fragment-url') ?? '');
    if (match?.[1] !== undefined) return { source: element, sha: match[1].toLowerCase() };
  }
  // Stale-comparison poller (both views): `end_commit_oid=<head>`.
  for (const element of document.querySelectorAll('[data-url*="end_commit_oid="]')) {
    const match = /[?&]end_commit_oid=([0-9a-f]{40})/i.exec(element.getAttribute('data-url') ?? '');
    if (match?.[1] !== undefined) return { source: element, sha: match[1].toLowerCase() };
  }
  // React views embed their initial payload as JSON.
  for (const script of document.querySelectorAll('script[type="application/json"]')) {
    const match = /"(?:headSha|headRefOid|headOid)"\s*:\s*"([0-9a-f]{40})"/i.exec(script.textContent ?? '');
    if (match?.[1] !== undefined) return { source: script, sha: match[1].toLowerCase() };
  }
  return null;
}

/** Commit pages are immutable: the SHA in the URL is the cache key. */
export function shaFromCommitUrl(pathname: string): string | null {
  const match = /\/commit\/([0-9a-f]{40})(?:\/|$)/i.exec(pathname);
  const sha = match?.[1];
  return sha !== undefined && SHA.test(sha) ? sha.toLowerCase() : null;
}

/**
 * GitHub's React files view reloads its data in place when the reader takes
 * the "new changes" refresh: it fetches `/pull/N/changes?_json=1` (or
 * `/files?…`) again and swaps the diff entries. Nothing in the page's static
 * payload changes, so the head read at load goes stale. Resource timing sees
 * that fetch from any world; `onRefresh` runs for each one after the first
 * paint, and the controller asks for the head again.
 */
const FILES_DATA = /\/pull\/\d+\/(?:changes|files)(?:\/[0-9a-f]{7,40})?(?:\?|$)/;

export function watchFilesRefresh(onRefresh: () => void): () => void {
  if (typeof PerformanceObserver === 'undefined') return () => undefined;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!(entry instanceof PerformanceResourceTiming)) continue;
      if ((entry.initiatorType === 'fetch' || entry.initiatorType === 'xmlhttprequest') && FILES_DATA.test(entry.name)) {
        onRefresh();
        return;
      }
    }
  });
  try {
    observer.observe({ type: 'resource' });
  } catch {
    return () => undefined;
  }
  return () => observer.disconnect();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The newest `{ oid, committedDate }` anywhere in the payload: the pull request's head. */
function newestCommit(value: unknown, best: { oid: string; at: number } | null, depth = 0): { oid: string; at: number } | null {
  if (depth > 8) return best;
  if (Array.isArray(value)) {
    let found = best;
    for (const entry of value) found = newestCommit(entry, found, depth + 1);
    return found;
  }
  if (!isRecord(value)) return best;
  const oid = value.oid;
  const date = value.committedDate ?? value.authoredDate;
  if (typeof oid === 'string' && SHA.test(oid) && typeof date === 'string') {
    const at = Date.parse(date);
    if (!Number.isNaN(at) && (best === null || at > best.at)) return { oid: oid.toLowerCase(), at };
    return best;
  }
  let found = best;
  for (const child of Object.values(value)) found = newestCommit(child, found, depth + 1);
  return found;
}

/** The last commit the Commits tab lists (oldest first, in groups by day): the head, whatever its dates say. */
function lastListedCommit(payload: unknown): string | null {
  const route = isRecord(payload) ? payload.pullRequestsCommitsRoute : null;
  const groups = isRecord(route) ? route.commitGroups : null;
  if (!Array.isArray(groups)) return null;
  const last: unknown = groups.at(-1);
  const commits = isRecord(last) ? last.commits : null;
  if (!Array.isArray(commits)) return null;
  const commit: unknown = commits.at(-1);
  const oid = isRecord(commit) ? commit.oid : null;
  return typeof oid === 'string' && SHA.test(oid) ? oid.toLowerCase() : null;
}

/**
 * The pull request's head from GitHub's own Commits tab data, which the
 * React app serves as a few KB of JSON for `Accept: application/json`:
 * the last commit listed, else the newest by date. Same origin, session
 * cookie, no diff host. `pullPath` is `/owner/repo/pull/N`.
 */
export async function fetchHeadSha(pullPath: string): Promise<string | null> {
  try {
    const response = await pageFetch(`${pullPath}/commits`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const payload = isRecord(body) ? body.payload : null;
    return lastListedCommit(payload) ?? newestCommit(payload, null)?.oid ?? null;
  } catch {
    return null;
  }
}
