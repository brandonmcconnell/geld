import { describe, expect, it } from 'vitest';
import { hunkNewRange, hunkOldRange, parseUnifiedDiffHunks } from './diff-hunks';

const SAMPLE = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@ export function a()
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 export {};
@@ -10,2 +11,2 @@
-old
+new
\\ No newline at end of file
diff --git a/docs/old.md b/docs/new.md
similarity index 100%
rename from docs/old.md
rename to docs/new.md
diff --git a/img.png b/img.png
new file mode 100644
index 0000000..4444444
Binary files /dev/null and b/img.png differ
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
index 5555555..0000000
--- a/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-gone
-gone too
`;

describe('parseUnifiedDiffHunks', () => {
  it('reads every hunk with its ranges and changed lines', () => {
    const files = parseUnifiedDiffHunks(SAMPLE);
    expect(files.map((file) => file.path)).toEqual(['src/a.ts', 'docs/new.md', 'img.png', 'gone.ts']);
    const [a, rename, binary, gone] = files;
    expect(a?.status).toBe('modified');
    expect(a?.hunks).toHaveLength(2);
    const first = a?.hunks[0];
    expect(first?.header).toBe('@@ -1,3 +1,4 @@ export function a()');
    expect(first?.added).toEqual(['const b = 3;', 'const c = 4;']);
    expect(first?.removed).toEqual(['const b = 2;']);
    expect(first === undefined ? null : hunkNewRange(first)).toEqual([1, 5]);
    expect(first === undefined ? null : hunkOldRange(first)).toEqual([1, 4]);
    const second = a?.hunks[1];
    expect(second?.index).toBe(1);
    expect(second?.added).toEqual(['new']);
    expect(rename?.status).toBe('renamed');
    expect(rename?.previousPath).toBe('docs/old.md');
    expect(rename?.hunks).toEqual([]);
    expect(binary?.binary).toBe(true);
    expect(binary?.status).toBe('added');
    expect(gone?.status).toBe('deleted');
    expect(gone?.hunks[0]?.removed).toEqual(['gone', 'gone too']);
    expect(gone?.hunks[0] === undefined ? null : hunkNewRange(gone.hunks[0])).toEqual([0, 0]);
  });

  it('signs a hunk by its changed text, not its position', () => {
    const moved = SAMPLE.replace('@@ -10,2 +11,2 @@', '@@ -40,2 +41,2 @@');
    const before = parseUnifiedDiffHunks(SAMPLE)[0]?.hunks[1]?.signature;
    const after = parseUnifiedDiffHunks(moved)[0]?.hunks[1]?.signature;
    expect(before).toBeDefined();
    expect(before).toBe(after);
    const edited = SAMPLE.replace('+new', '+newer');
    expect(parseUnifiedDiffHunks(edited)[0]?.hunks[1]?.signature).not.toBe(before);
  });

  it('counts a missing hunk length as one line', () => {
    const files = parseUnifiedDiffHunks('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n');
    expect(files[0]?.hunks[0]).toMatchObject({ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 });
  });
});
