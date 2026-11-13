/**
 * When each bot check run on the page began, and when it was seen to finish.
 *
 * The merge box shows a running check's start ("Started <relative-time>") and
 * nothing of the kind once it has finished ("Successful in 2m"). The start is
 * what tells a finished check's report from the summary of the run before it
 * (`verdictsFrom`, `RawCheckRun.startedAt`), so it is read while the row runs
 * and kept, per pull request, head and check, past the finish — in memory for
 * the visit and in `storage.local` so a reload in the seconds around the
 * finish does not lose it. The finish itself is the first pass that found the
 * row completed; the report's grace runs from there.
 *
 * A check can run again on the same head (a re-run from the bot's site, a
 * "Re-run" on GitHub) while the page is not watching (a hidden tab defers
 * its passes); the finished row then looks like the one before. The row's
 * details link names the run (`check_run_id=…`, `actions/runs/…/job/…`), so
 * an entry is lent back only to the run it was taken from; a row with no
 * such link is trusted only briefly after its finish.
 *
 * A check the page first saw already finished has no times, but it had
 * finished by that first sighting (`RawCheckRun.doneBy`): a run asked for
 * after it is not that check's, which was the run before (geld#671: an old
 * green CodeRabbit check read as the answer to "Review triggered."). Kept only
 * for a link naming a GitHub check run, since a status's link to the bot's
 * site may stay the same across runs.
 *
 * Entries go when their head is no longer the pull request's (a push starts
 * every check over) and after a day regardless.
 */

import { storage } from 'wxt/utils/storage';
import type { RawCheckRun } from '@geld/review';

interface RunTimes {
  /** Absent for a run first seen already finished, which has `doneBy` instead. */
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly doneBy?: string;
  /** The row's details link while it ran, which names the run. */
  readonly runId?: string;
  /** For pruning: when the entry was last written, ms. */
  readonly at: number;
}

type RunMap = Record<string, RunTimes>;

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** How long after its finish an entry for a run the page cannot name is still believed to be that run's. */
const UNNAMED_TRUST_MS = 10 * 60 * 1000;

const runsItem = storage.defineItem<RunMap>('local:reviewRunStarts', { fallback: {} });

const memory = new Map<string, RunTimes>();
let loaded: Promise<void> | null = null;
/** Until the stored entries are in, a first sighting is not recorded: it would shadow a start a reload brings back. */
let ready = false;
let sightingDeferred = false;
let writeQueued = false;

function isRunTimes(value: unknown): value is RunTimes {
  if (typeof value !== 'object' || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return (
    (typeof record.startedAt === 'string' || (record.startedAt === undefined && typeof record.doneBy === 'string')) &&
    typeof record.at === 'number' &&
    (record.completedAt === undefined || typeof record.completedAt === 'string') &&
    (record.doneBy === undefined || typeof record.doneBy === 'string') &&
    (record.runId === undefined || typeof record.runId === 'string')
  );
}

const GITHUB_RUN_PATH = /^\/[^/]+\/[^/]+\/(?:runs\/(\d+)|actions\/runs\/\d+\/job\/(\d+)|pull\/\d+\/checks)\/?$/;

/**
 * The GitHub check run a details link names, or null: the merge box links `/pull/N/checks?check_run_id=…`, the
 * commit's status partial `/runs/N`, an Actions job `/actions/runs/…/job/N`, and the two sources take turns.
 */
function githubRunOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, 'https://github.com');
  } catch {
    return null;
  }
  const match = GITHUB_RUN_PATH.exec(parsed.pathname);
  if (match === null) return null;
  return match[1] ?? match[2] ?? parsed.searchParams.get('check_run_id');
}

function sameName(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  const run = githubRunOf(a);
  return run !== null ? run === githubRunOf(b) : a === b;
}

/** Whether a remembered run is the one a completed row shows: the same named run, or an unnamed one still fresh. */
function sameRun(known: RunTimes, check: RawCheckRun, now: number): boolean {
  if (known.runId !== undefined && check.detailsUrl !== undefined) return sameName(known.runId, check.detailsUrl);
  const finished = known.completedAt === undefined ? NaN : Date.parse(known.completedAt);
  return Number.isNaN(finished) || now - finished < UNNAMED_TRUST_MS;
}

/** Bring the stored entries into memory once; `onChange` re-applies when they land so a finished check gets its start. */
function load(onChange: () => void): void {
  if (loaded !== null) return;
  const settle = (any: boolean): void => {
    ready = true;
    if (any || sightingDeferred) onChange();
  };
  loaded = runsItem
    .getValue()
    .then((stored) => {
      const cutoff = Date.now() - MAX_AGE_MS;
      let any = false;
      for (const [key, value] of Object.entries(stored)) {
        if (!isRunTimes(value) || value.at < cutoff || memory.has(key)) continue;
        memory.set(key, value);
        any = true;
      }
      settle(any);
    })
    .catch(() => settle(false));
}

function persist(): void {
  if (writeQueued) return;
  writeQueued = true;
  setTimeout(() => {
    writeQueued = false;
    const cutoff = Date.now() - MAX_AGE_MS;
    const out: RunMap = {};
    for (const [key, value] of memory) if (value.at >= cutoff) out[key] = value;
    void runsItem.setValue(out).catch(() => undefined);
  }, 500);
}

/**
 * The check runs with their start and finish times filled in from what the
 * page shows now and what was remembered: a running row's "Started" time is
 * recorded; a completed row whose start is known gets the start back and,
 * the first time it is seen complete, the finish.
 */
export function withRunTimes(checks: readonly RawCheckRun[], pageKey: string, headSha: string, onChange: () => void): readonly RawCheckRun[] {
  load(onChange);
  if (pageKey === '' || headSha === '') return checks;
  const prefix = `${pageKey}|${headSha.toLowerCase()}|`;
  let changed = false;
  const now = Date.now();
  const out = checks.map((check) => {
    const key = `${prefix}${check.name}`;
    const known = memory.get(key);
    if (check.status !== 'completed') {
      // A run under way: its start (and name) replace whatever run was remembered under this check.
      if (check.startedAt !== undefined && (known === undefined || known.startedAt !== check.startedAt || !sameName(known.runId, check.detailsUrl))) {
        memory.set(key, { startedAt: check.startedAt, ...(check.detailsUrl === undefined ? {} : { runId: check.detailsUrl }), at: now });
        changed = true;
      } else if (check.startedAt === undefined && known !== undefined && known.startedAt === undefined) {
        // The run first seen finished is over, and says nothing of this one.
        memory.delete(key);
        changed = true;
      }
      return check.startedAt === undefined && known?.startedAt !== undefined && known.completedAt === undefined ? { ...check, startedAt: known.startedAt } : check;
    }
    let current = known;
    if (current !== undefined && !sameRun(current, check, now)) {
      // The check ran again while nobody watched: what was remembered is the run before and says nothing of this one.
      memory.delete(key);
      changed = true;
      current = undefined;
    }
    if (current === undefined) {
      if (check.startedAt !== undefined || check.completedAt !== undefined || check.detailsUrl === undefined || githubRunOf(check.detailsUrl) === null) return check;
      if (!ready) {
        sightingDeferred = true;
        return check;
      }
      const doneBy = new Date(now).toISOString();
      memory.set(key, { doneBy, runId: check.detailsUrl, at: now });
      changed = true;
      return { ...check, doneBy };
    }
    if (current.startedAt === undefined) return current.doneBy === undefined ? check : { ...check, doneBy: current.doneBy };
    const completedAt = current.completedAt ?? new Date(now).toISOString();
    if (current.completedAt === undefined) {
      memory.set(key, { ...current, completedAt, at: now });
      changed = true;
    }
    return { ...check, startedAt: current.startedAt, completedAt };
  });
  if (changed) {
    // Another head's entries for this pull request are over: its checks start again on every push.
    const head = `${pageKey}|`;
    for (const key of [...memory.keys()]) if (key.startsWith(head) && !key.startsWith(prefix)) memory.delete(key);
    persist();
  }
  return out;
}

/** The grace a finished check's report is given runs from its finish: a pass is due when the earliest one ends. */
export function nextRunGraceEnd(checks: readonly RawCheckRun[], graceMs: number, now = Date.now()): number | null {
  let soonest: number | null = null;
  for (const check of checks) {
    if (check.status !== 'completed' || check.completedAt === undefined) continue;
    const end = Date.parse(check.completedAt) + graceMs;
    if (Number.isNaN(end) || end <= now) continue;
    soonest = soonest === null ? end : Math.min(soonest, end);
  }
  return soonest;
}
