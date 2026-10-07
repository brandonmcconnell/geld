import { count, formatPerf, isPerfSnapshot, phase, snapshot } from './perf';

describe('perf', () => {
  it('times phases, returns their value and keeps counters', () => {
    expect(phase('test-phase', () => 42)).toBe(42);
    expect(() =>
      phase('test-throws', () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    count('test-counter');
    count('test-counter', 2);
    const snap = snapshot();
    expect(isPerfSnapshot(snap)).toBe(true);
    const timed = snap.phases.find((entry) => entry.name === 'test-phase');
    expect(timed?.count).toBe(1);
    expect(timed?.lastMinute).toBe(1);
    expect(snap.phases.find((entry) => entry.name === 'test-throws')?.count).toBe(1);
    expect(snap.counters['test-counter']).toBe(3);
  });

  it('formats a snapshot per tab', () => {
    const text = formatPerf('owner/repo#1', {
      uptimeMs: 120_000,
      hidden: true,
      phases: [{ name: 'pass', count: 4, meanMs: 12.5, maxMs: 30, totalMs: 50, lastMinute: 1 }],
      counters: { batches: 9 },
    });
    expect(text).toContain('owner/repo#1 (hidden): up 120s');
    expect(text).toContain('pass: 4 runs (2.0/min, 1 in the last minute), mean 12.5ms, max 30.0ms, total 50ms');
    expect(text).toContain('counters: batches=9');
  });

  it('rejects malformed snapshots', () => {
    expect(isPerfSnapshot({ uptimeMs: 1, hidden: false, phases: [{ name: 'x' }], counters: {} })).toBe(false);
    expect(isPerfSnapshot(null)).toBe(false);
  });
});
