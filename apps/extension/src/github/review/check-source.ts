/**
 * The checks of the pull request's head, read from GitHub's own commit
 * status partial rather than from the merge box alone.
 *
 * A review bot that runs from CI, or that a person started on the bot's own
 * site, posts nothing until it is done: its check run is the only sign that
 * it ran, and the only verdict when it posts nothing at all (Bugbot's green
 * "Cursor Bugbot" over a run that found nothing). The merge box is where the
 * page shows those rows — but GitHub's React merge box renders the check
 * list only once the reader expands it, and a merged or closed pull request
 * shows no merge box at all, so `crawlCheckRuns(document)` found nothing on
 * mintlify/server#9377 and the chip read "Not run" over a check that had
 * passed. The commit's status partial,
 * `/owner/repo/commit/<sha>/status-details?popover=true` (what the commit
 * list's status popover loads; `quick-view.ts` already points a `details`
 * at it), lists every check and status of the commit in the classic
 * `.merge-status-item` markup the crawler reads, whatever the merge box
 * shows. Same origin, session cookie: private repositories work, and on
 * Enterprise the host is the page's.
 *
 * The partial is read per head and kept for the visit; it is read again when
 * the merge box's words change (GitHub polls the statuses and re-renders the
 * box, which the observer turns into a pass — a running check will have
 * finished), on a short clock while a bot's check is still running, and on a
 * long one otherwise. The page's own rows, when the box is expanded, win over
 * the partial's by name (`mergeCheckRuns`): they are live and show a running
 * check's start, which the partial does not. A fetch that fails leaves the
 * last reading in place and is retried on the next clock.
 */

import type { RawCheckRun } from '@geld/review';
import { botByCheckName } from '@geld/review';
import { crawlCheckRuns } from './crawler';
import { fragmentHeaders } from './deeplink';

/** Read again this soon while one of the bots' checks has not completed. */
const REFRESH_RUNNING_MS = 20_000;
/** Read again this soon otherwise: a run started on the bot's site shows up here first. */
const REFRESH_SETTLED_MS = 5 * 60_000;

interface Reading {
  checks: readonly RawCheckRun[];
  fetchedAt: number;
  /** The merge box's words when this reading was taken: a change there is a change in the checks. */
  fingerprint: string;
  pending: Promise<void> | null;
  /** The partial could not be read (not found, not reachable): keep what there is, try again on the clock. */
  failed: boolean;
}

const readings = new Map<string, Reading>();

export interface CheckSubject {
  readonly origin: string;
  readonly owner: string;
  readonly repo: string;
}

function keyOf(subject: CheckSubject, headSha: string): string {
  return `${subject.origin}/${subject.owner}/${subject.repo}@${headSha.toLowerCase()}`;
}

async function fetchChecks(subject: CheckSubject, headSha: string, reading: Reading): Promise<void> {
  try {
    const url = `${subject.origin}/${encodeURIComponent(subject.owner)}/${encodeURIComponent(subject.repo)}/commit/${headSha}/status-details?popover=true`;
    const response = await fetch(url, { headers: fragmentHeaders(), credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) {
      reading.failed = true;
      return;
    }
    const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
    reading.checks = crawlCheckRuns(parsed, headSha);
    reading.failed = false;
  } catch {
    reading.failed = true;
  }
}

function botCheckRunning(checks: readonly RawCheckRun[]): boolean {
  return checks.some((check) => check.status !== 'completed' && botByCheckName(check.name) !== null);
}

/**
 * The head's checks as the status partial lists them: what has been read so
 * far (empty before the first reading lands), with a read started when none
 * has been taken for this head, when `fingerprint` (the merge box's words)
 * differs from the last reading's, or when the last one is older than the
 * clock allows. `onChange` runs when a read lands, whatever it says: the pass
 * reads the new list (its state for the bots, its words and links for the
 * Reports row) and arms the clock for the next read (`nextCheckRefresh`) now
 * that `fetchedAt` has moved.
 */
export function headChecks(subject: CheckSubject, headSha: string, fingerprint: string, onChange: () => void): readonly RawCheckRun[] {
  if (headSha === '') return [];
  const key = keyOf(subject, headSha);
  let reading = readings.get(key);
  if (reading === undefined) {
    reading = { checks: [], fetchedAt: 0, fingerprint, pending: null, failed: false };
    readings.set(key, reading);
  }
  const refreshAfter = botCheckRunning(reading.checks) ? REFRESH_RUNNING_MS : REFRESH_SETTLED_MS;
  const age = Date.now() - reading.fetchedAt;
  const due = reading.fetchedAt === 0 || age >= refreshAfter || (reading.fingerprint !== fingerprint && age >= 2_000);
  if (reading.pending === null && due) {
    const current = reading;
    current.fingerprint = fingerprint;
    current.pending = fetchChecks(subject, headSha, current).then(() => {
      current.fetchedAt = Date.now();
      current.pending = null;
      onChange();
    });
  }
  return reading.checks;
}

/**
 * When the next scheduled read of `headSha`'s checks is due (epoch ms); null
 * when none is kept for it, and while a read is in flight — its landing makes
 * a pass of its own, which asks again with a fresh `fetchedAt` (a deadline
 * computed from the old one would already be past, and a pass every tick
 * until the response came).
 */
export function nextCheckRefresh(subject: CheckSubject, headSha: string): number | null {
  const reading = readings.get(keyOf(subject, headSha));
  if (reading === undefined || reading.fetchedAt === 0 || reading.pending !== null) return null;
  return reading.fetchedAt + (botCheckRunning(reading.checks) ? REFRESH_RUNNING_MS : REFRESH_SETTLED_MS);
}

/**
 * Make every reading due now, so the next pass reads the checks again: the
 * tab was away, and timers in a hidden tab ran late or not at all while bots
 * may have finished. What was read stays shown until the new read lands.
 */
export function expireHeadChecks(): void {
  for (const reading of readings.values()) if (reading.pending === null && reading.fetchedAt !== 0) reading.fetchedAt = 1;
}

/** Forget every reading (a test, or leaving the pull request). */
export function resetHeadChecks(): void {
  readings.clear();
}
