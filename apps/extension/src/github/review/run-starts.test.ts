import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/utils/storage', () => ({ storage: { defineItem: () => ({ getValue: vi.fn(async () => ({})), setValue: vi.fn(async () => undefined) }) } }));

import { nextRunGraceEnd, withRunTimes } from './run-starts';

const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const noop = (): void => undefined;

describe('withRunTimes', () => {
  it('remembers a running check\'s start and gives it back, with the finish, once the row has completed', () => {
    const running = withRunTimes([{ name: 'Cursor Bugbot', status: 'in_progress', conclusion: null, sha, startedAt: '2026-10-07T22:00:00.000Z' }], 'mint/12660', sha, noop);
    expect(running[0]?.startedAt).toBe('2026-10-07T22:00:00.000Z');
    // The finished row shows no start; the remembered one comes back, and the first sight of the finish is kept.
    const before = Date.now();
    const done = withRunTimes([{ name: 'Cursor Bugbot', status: 'completed', conclusion: 'success', sha }], 'mint/12660', sha, noop);
    expect(done[0]?.startedAt).toBe('2026-10-07T22:00:00.000Z');
    const finish = Date.parse(done[0]?.completedAt ?? '');
    expect(finish).toBeGreaterThanOrEqual(before);
    // A later pass keeps that same finish, not a new one.
    const again = withRunTimes([{ name: 'Cursor Bugbot', status: 'completed', conclusion: 'success', sha }], 'mint/12660', sha, noop);
    expect(again[0]?.completedAt).toBe(done[0]?.completedAt);
  });

  it('knows nothing about a check it never saw running', () => {
    const done = withRunTimes([{ name: 'Greptile Review', status: 'completed', conclusion: 'success', sha }], 'mint/12660', sha, noop);
    expect(done[0]?.startedAt).toBeUndefined();
    expect(done[0]?.completedAt).toBeUndefined();
  });

  it('lends a run\'s times only to that run: a re-run nobody saw running starts over', () => {
    const run1 = 'https://github.com/mint/pull/1/checks?check_run_id=1';
    withRunTimes([{ name: 'Greptile Review', status: 'in_progress', conclusion: null, sha, startedAt: '2026-10-07T22:00:00.000Z', detailsUrl: run1 }], 'mint/12661', sha, noop);
    // The same run finished: its start comes back.
    const done = withRunTimes([{ name: 'Greptile Review', status: 'completed', conclusion: 'success', sha, detailsUrl: run1 }], 'mint/12661', sha, noop);
    expect(done[0]?.startedAt).toBe('2026-10-07T22:00:00.000Z');
    // Another run of the check, finished before the page saw it running: a different run, nothing is known of it.
    const rerun = withRunTimes([{ name: 'Greptile Review', status: 'completed', conclusion: 'success', sha, detailsUrl: 'https://github.com/mint/pull/1/checks?check_run_id=2' }], 'mint/12661', sha, noop);
    expect(rerun[0]?.startedAt).toBeUndefined();
    expect(rerun[0]?.completedAt).toBeUndefined();
  });

  it('knows a check first seen finished had finished by then, as long as it is the same GitHub check run', async () => {
    // The stored entries load first, so nothing is recorded before they are in.
    withRunTimes([], 'geld/671', sha, noop);
    await Promise.resolve();
    await Promise.resolve();
    const before = Date.now();
    const seen = withRunTimes([{ name: 'CodeRabbit', status: 'completed', conclusion: 'success', sha, detailsUrl: 'https://github.com/o/r/runs/7' }], 'geld/671', sha, noop);
    const doneBy = seen[0]?.doneBy ?? '';
    expect(Date.parse(doneBy)).toBeGreaterThanOrEqual(before);
    expect(seen[0]?.startedAt).toBeUndefined();
    // The merge box names the same run another way: still that run, still finished by the first sighting.
    const merge = withRunTimes([{ name: 'CodeRabbit', status: 'completed', conclusion: 'success', sha, detailsUrl: 'https://github.com/o/r/pull/671/checks?check_run_id=7' }], 'geld/671', sha, noop);
    expect(merge[0]?.doneBy).toBe(doneBy);
    // A new run of it is under way: what was first seen is over.
    withRunTimes([{ name: 'CodeRabbit', status: 'in_progress', conclusion: null, sha, detailsUrl: 'https://github.com/o/r/runs/8' }], 'geld/671', sha, noop);
    const next = withRunTimes([{ name: 'CodeRabbit', status: 'completed', conclusion: 'success', sha, detailsUrl: 'https://github.com/o/r/runs/8' }], 'geld/671', sha, noop);
    expect(Date.parse(next[0]?.doneBy ?? '')).toBeGreaterThanOrEqual(Date.parse(doneBy));
    // A link to the bot's own site may stay the same across runs, so it names no run and nothing is assumed.
    const site = withRunTimes([{ name: 'Devin Review', status: 'completed', conclusion: 'success', sha, detailsUrl: 'https://app.devin.ai/review/o/r/pull/671' }], 'geld/671', sha, noop);
    expect(site[0]?.doneBy).toBeUndefined();
  });

  it('forgets a head\'s runs once the pull request has moved on', () => {
    const next = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    withRunTimes([{ name: 'Cursor Bugbot', status: 'in_progress', conclusion: null, sha: next, startedAt: '2026-10-07T23:00:00.000Z' }], 'mint/12660', next, noop);
    const old = withRunTimes([{ name: 'Cursor Bugbot', status: 'completed', conclusion: 'success', sha }], 'mint/12660', sha, noop);
    expect(old[0]?.startedAt).toBeUndefined();
  });
});

describe('nextRunGraceEnd', () => {
  it('is the earliest grace still to end, or nothing', () => {
    const now = Date.UTC(2026, 9, 7, 22, 10);
    const at = (secondsAgo: number): string => new Date(now - secondsAgo * 1000).toISOString();
    const checks = [
      { name: 'Cursor Bugbot', status: 'completed', conclusion: 'success', sha, startedAt: at(300), completedAt: at(10) },
      { name: 'Greptile Review', status: 'completed', conclusion: 'success', sha, startedAt: at(300), completedAt: at(70) },
      { name: 'Lint', status: 'completed', conclusion: 'success', sha },
    ];
    expect(nextRunGraceEnd(checks, 90_000, now)).toBe(now + 20_000);
    expect(nextRunGraceEnd(checks, 5_000, now)).toBeNull();
  });
});
