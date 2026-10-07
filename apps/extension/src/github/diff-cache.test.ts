import { describe, expect, it } from 'vitest';
import { writeEntry } from './diff-cache-map';
import type { CacheMap } from './diff-cache-map';

const files = (count: number) => Array.from({ length: count }, (_, index) => ({ path: `src/file-${index}.ts`, additions: 1, deletions: 0 }));

describe('diff cache bounds', () => {
  it('keeps a pull request with thousands of files, and evicts the oldest entries by file count', () => {
    let map: CacheMap = {};
    // Fifteen old pull requests of 3000 files each: 45,000 files, over the 40,000 bound.
    for (let index = 0; index < 15; index += 1) map = writeEntry(map, `github:o:r:${index}:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, { files: files(3000), at: 1000 + index });
    const total = (entries: CacheMap): number => Object.values(entries).reduce((sum, entry) => sum + entry.files.length, 0);
    expect(total(map)).toBeLessThanOrEqual(40_000);
    // The newest survive; the oldest went (each pull request also has a `latest` copy, so pairs go together).
    expect(map['github:o:r:14:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']).toBeDefined();
    expect(map['github:o:r:0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']).toBeUndefined();
    // The entry just written is never the one evicted, however large.
    const next = writeEntry(map, 'github:o:r:99:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', { files: files(3000), at: 5000 });
    expect(next['github:o:r:99:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']?.files).toHaveLength(3000);
    expect(total(next)).toBeLessThanOrEqual(40_000);
  });
});
