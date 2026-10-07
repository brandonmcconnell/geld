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
