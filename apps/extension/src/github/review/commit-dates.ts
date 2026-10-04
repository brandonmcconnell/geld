/**
 * When each commit of the pull request was made. GitHub's commit rows in the
 * conversation timeline carry no time at all (a force-push row does), so the
 * panel's commit list reads the dates from the PR's Commits tab, which the
 * React app serves as JSON for `Accept: application/json` (a few KB: the
 * commits with `oid`, `committedDate` and `authoredDate`). One request per
 * pull request per visit; a commit the answer does not know (pushed since)
 * asks again, at most every `REFRESH_MS`.
 */

const REFRESH_MS = 30_000;

/** When a commit was made (`committed`: the last rewrite — rebase, amend, cherry-pick — `authored`: the original). */
export interface CommitTimes {
  readonly committed: string;
  readonly authored: string;
}

interface CommitDates {
  readonly byOid: Map<string, CommitTimes>;
  fetchedAt: number;
  pending: Promise<void> | null;
}

let known: { readonly pull: string; readonly dates: CommitDates } | null = null;

/** `/owner/repo/pull/N` of the page, or null off a pull request. */
function pullPathOf(): string | null {
  const match = /^(\/[^/]+\/[^/]+\/pull\/\d+)(?:\/|$)/.exec(location.pathname);
  return match?.[1] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Every `{ oid, committedDate | authoredDate }` object anywhere in the payload, whatever GitHub groups them under. */
function collectCommits(value: unknown, into: Map<string, CommitTimes>, depth = 0): void {
  if (depth > 8) return;
  if (Array.isArray(value)) {
    for (const entry of value) collectCommits(entry, into, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  const oid = value.oid;
  const committed = typeof value.committedDate === 'string' && !Number.isNaN(Date.parse(value.committedDate)) ? value.committedDate : null;
  const authored = typeof value.authoredDate === 'string' && !Number.isNaN(Date.parse(value.authoredDate)) ? value.authoredDate : null;
  if (typeof oid === 'string' && /^[0-9a-f]{40}$/.test(oid) && (committed !== null || authored !== null)) {
    into.set(oid, { committed: committed ?? authored ?? '', authored: authored ?? committed ?? '' });
    return;
  }
  for (const child of Object.values(value)) collectCommits(child, into, depth + 1);
}

async function fetchDates(pull: string, into: Map<string, CommitTimes>): Promise<void> {
  try {
    const response = await fetch(new URL(`${pull}/commits`, location.href), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!response.ok) return;
    const body: unknown = await response.json();
    collectCommits(isRecord(body) ? body.payload : null, into);
  } catch {
    // Unreachable or not JSON (signed out, an Enterprise version without the route): the rows stay without a time.
  }
}

/**
 * The ISO date of commit `sha` (7 characters or more), or null while it is
 * on its way (`onChange` runs once the answer lands) or when GitHub would
 * not say.
 */
export function commitDate(sha: string, onChange: () => void): string | null {
  return commitTimes(sha, onChange)?.committed ?? null;
}

/** Both dates of commit `sha`, on the same terms as {@link commitDate}. */
export function commitTimes(sha: string, onChange: () => void): CommitTimes | null {
  const pull = pullPathOf();
  if (pull === null) return null;
  if (known === null || known.pull !== pull) known = { pull, dates: { byOid: new Map(), fetchedAt: 0, pending: null } };
  const dates = known.dates;
  const lower = sha.toLowerCase();
  for (const [oid, times] of dates.byOid) {
    if (oid.startsWith(lower)) return times;
  }
  if (dates.pending === null && Date.now() - dates.fetchedAt >= REFRESH_MS) {
    dates.pending = fetchDates(pull, dates.byOid).finally(() => {
      dates.fetchedAt = Date.now();
      dates.pending = null;
      onChange();
    });
  }
  return null;
}

/**
 * Whether the commit was rewritten after it was made — rebased, amended,
 * cherry-picked: its committed date is well after its authored date. A
 * commit made and pushed as it is carries the same second in both.
 */
export function isRewritten(times: CommitTimes): boolean {
  const committed = Date.parse(times.committed);
  const authored = Date.parse(times.authored);
  return !Number.isNaN(committed) && !Number.isNaN(authored) && committed - authored >= REWRITE_GAP_MS;
}

const REWRITE_GAP_MS = 60_000;
