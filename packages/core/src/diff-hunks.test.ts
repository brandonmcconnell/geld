import { describe, expect, it } from 'vitest';
import { parseUnifiedDiffHunks } from './diff-hunks';
describe('hunks and line anchors', () => {
  it('preserves old/new anchors, zero ranges and no-newline notices', () => {
    const files = parseUnifiedDiffHunks('diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -2,2 +2,2 @@\n old\n-gone\n+new\n\\ No newline at end of file\ndiff --git a/b.ts b/b.ts\nnew file mode 100644\n--- /dev/null\n+++ b/b.ts\n@@ -0,0 +1 @@\n+first\n');
    expect(files[0]?.hunks[0]?.lines).toEqual([{ kind: 'context', text: 'old', oldLine: 2, newLine: 2 }, { kind: 'removed', text: 'gone', oldLine: 3, newLine: null }, { kind: 'added', text: 'new', oldLine: null, newLine: 3 }, { kind: 'notice', text: '\\ No newline at end of file', oldLine: null, newLine: null }]);
    expect(files[1]?.hunks[0]).toMatchObject({ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1 });
    expect(files[1]?.hunks[0]?.lines[0]?.newLine).toBe(1);
  });
  it('keeps binary and rename-only files without invented hunks', () => {
    const files = parseUnifiedDiffHunks('diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ\ndiff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n');
    expect(files[0]).toMatchObject({ binary: true, hunks: [] });
    expect(files[1]).toMatchObject({ path: 'new.ts', status: 'renamed', hunks: [] });
  });
  it('does not treat a removed header-like line or trailing newline as file metadata', () => {
    const files = parseUnifiedDiffHunks('diff --git a/a.sql b/a.sql\n--- a/a.sql\n+++ b/a.sql\n@@ -1 +1 @@\n--- comment\n+++ comment\n');
    expect(files[0]?.hunks[0]?.lines).toHaveLength(2);
    expect(files[0]?.hunks[0]?.lines[0]?.text).toBe('-- comment');
  });
});

describe('renamed diff paths', () => {
  it('keeps the preimage path beside the current path and text anchors', () => {
    const files = parseUnifiedDiffHunks('diff --git a/old name.ts b/new name.ts\nsimilarity index 80%\nrename from old name.ts\nrename to new name.ts\n--- a/old name.ts\n+++ b/new name.ts\n@@ -1 +1 @@\n-before\n+after\n');
    expect(files[0]).toMatchObject({ path: 'new name.ts', oldPath: 'old name.ts', hunks: [{ lines: [{ kind: 'removed', oldLine: 1 }, { kind: 'added', newLine: 1 }] }] });
  });
});
