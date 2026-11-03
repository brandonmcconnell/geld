// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { headerDiffstat, parseDiffstat } from './header-diffstat';

describe('parseDiffstat', () => {
  it("reads GitHub's header totals", () => {
    // vitest#10554's answer, Nov 2026.
    expect(parseDiffstat({ diffstat: { linesAdded: 3328, linesDeleted: 2986, linesChanged: 6314 } })).toEqual({ additions: 3328, deletions: 2986 });
    expect(parseDiffstat({ diffstat: { linesAdded: 0, linesDeleted: 0 } })).toEqual({ additions: 0, deletions: 0 });
  });

  it('takes nothing that is not a pair of counts', () => {
    for (const payload of [null, {}, { diffstat: null }, { diffstat: { linesAdded: '3', linesDeleted: 2 } }, { diffstat: { linesAdded: -1, linesDeleted: 0 } }, { diffstat: { linesAdded: 1.5, linesDeleted: 0 } }]) {
      expect(parseDiffstat(payload)).toBeNull();
    }
  });
});

describe('headerDiffstat', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('asks again for a head that stays changed after the settling window, keeping the first answer until then', async () => {
    vi.useFakeTimers();
    const answers = [
      { diffstat: { linesAdded: 10, linesDeleted: 2 } },
      { diffstat: { linesAdded: 14, linesDeleted: 3 } },
    ];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(answers.shift())));
    vi.stubGlobal('fetch', fetchMock);
    const landed = vi.fn();
    const pull = '/o/r/pull/1';

    expect(headerDiffstat(pull, 'aaa', landed)).toBeUndefined();
    await vi.waitFor(() => expect(landed).toHaveBeenCalledTimes(1));
    expect(headerDiffstat(pull, 'aaa', landed)).toEqual({ additions: 10, deletions: 2 });

    expect(headerDiffstat(pull, 'bbb', landed)).toEqual({ additions: 10, deletions: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_000);
    expect(landed).toHaveBeenCalledTimes(2);
    expect(headerDiffstat(pull, 'bbb', landed)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(landed).toHaveBeenCalledTimes(3));
    expect(headerDiffstat(pull, 'bbb', landed)).toEqual({ additions: 14, deletions: 3 });
    expect(headerDiffstat(pull, 'bbb', landed)).toEqual({ additions: 14, deletions: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
