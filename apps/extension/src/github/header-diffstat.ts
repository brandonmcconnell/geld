import type { StandInTotals } from './header-stats';

/**
 * GitHub's own totals for the pull request header's line counts, from the request its header makes for them
 * (`page_data/diffstat`, `{ diffstat: { linesAdded, linesDeleted } }`, same origin and session). They are not the
 * `.diff`'s sums (vitest#10554: the header says +3,328 −2,986 where the diff adds up to +3,485 −3,139), so the counts
 * stand-in shows these, and GitHub's counts, when they render, read the same. The answer is always the pull request's
 * current head, so it is asked once per pull request, and again only for a head read well after that (a push): while
 * the conversation tab loads, the head the page reads moves through older commit rows within the first seconds.
 */
const REASK_AFTER_MS = 10_000;
interface Ask {
  sha: string | null;
  readonly at: number;
  totals: StandInTotals | null | undefined;
}
const asks = new Map<string, Ask>();

export function parseDiffstat(payload: unknown): StandInTotals | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const diffstat: unknown = Reflect.get(payload, 'diffstat');
  if (typeof diffstat !== 'object' || diffstat === null) return null;
  const additions: unknown = Reflect.get(diffstat, 'linesAdded');
  const deletions: unknown = Reflect.get(diffstat, 'linesDeleted');
  if (typeof additions !== 'number' || typeof deletions !== 'number' || !Number.isInteger(additions) || !Number.isInteger(deletions) || additions < 0 || deletions < 0) return null;
  return { additions, deletions };
}

/** GitHub's totals for the header, once they have been read; asks for them the first time, calling `landed` when they arrive. */
export function headerDiffstat(pullPath: string, sha: string | null, landed: () => void): StandInTotals | null {
  const known = asks.get(pullPath);
  if (known !== undefined && (known.sha === sha || sha === null || known.sha === null || Date.now() - known.at < REASK_AFTER_MS)) {
    if (sha !== null) known.sha = sha;
    return known.totals ?? null;
  }
  const ask: Ask = { sha, at: Date.now(), totals: undefined };
  asks.set(pullPath, ask);
  const nonce = document.querySelector<HTMLMetaElement>('meta[name="fetch-nonce"]')?.content ?? '';
  void fetch(`${pullPath}/page_data/diffstat`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'GitHub-Verified-Fetch': 'true', 'X-Requested-With': 'XMLHttpRequest', ...(nonce === '' ? {} : { 'X-Fetch-Nonce': nonce }) },
  })
    .then(async (response) => (response.ok ? parseDiffstat(await response.json()) : null))
    .catch(() => null)
    .then((totals) => {
      // An answer for a head no longer asked about is not this one's.
      if (asks.get(pullPath) !== ask) return;
      ask.totals = totals;
      if (totals !== null) landed();
    });
  return null;
}
