import { describe, expect, it } from 'vitest';
import { parseDiffstat } from './header-diffstat';

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
