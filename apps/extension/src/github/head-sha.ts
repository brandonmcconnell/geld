const SHA = /^[0-9a-f]{40}$/i;

/**
 * Find the head commit of the pull request on the current page without any
 * network request. Both GitHub UIs leak it in a few stable places.
 */
export function detectHeadSha(): string | null {
  // Legacy files view: progressive diff loaders carry `sha2=<head>`.
  for (const element of document.querySelectorAll('[data-fragment-url*="sha2="]')) {
    const url = element.getAttribute('data-fragment-url') ?? '';
    const match = /[?&]sha2=([0-9a-f]{40})/i.exec(url);
    if (match?.[1] !== undefined) return match[1].toLowerCase();
  }
  // Stale-comparison poller (both views): `end_commit_oid=<head>`.
  for (const element of document.querySelectorAll('[data-url*="end_commit_oid="]')) {
    const url = element.getAttribute('data-url') ?? '';
    const match = /[?&]end_commit_oid=([0-9a-f]{40})/i.exec(url);
    if (match?.[1] !== undefined) return match[1].toLowerCase();
  }
  // React views embed their initial payload as JSON.
  for (const script of document.querySelectorAll('script[type="application/json"]')) {
    const text = script.textContent ?? '';
    const match = /"(?:headSha|headRefOid|headOid)"\s*:\s*"([0-9a-f]{40})"/i.exec(text);
    if (match?.[1] !== undefined) return match[1].toLowerCase();
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

/**
 * The pull request's head from GitHub's own Commits tab data, which the
 * React app serves as a few KB of JSON for `Accept: application/json`:
 * the newest commit's `oid`. Same origin, session cookie, no diff host.
 * `pullPath` is `/owner/repo/pull/N`.
 */
export async function fetchHeadSha(pullPath: string): Promise<string | null> {
  try {
    const response = await fetch(new URL(`${pullPath}/commits`, location.href), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return newestCommit(isRecord(body) ? body.payload : null, null)?.oid ?? null;
  } catch {
    return null;
  }
}
