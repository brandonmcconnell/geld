import { parseUnifiedDiff } from './diff-parse';

const SAMPLE = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 export {};
@@ -10,2 +11,2 @@
-old
+new
diff --git a/src/a.test.ts b/src/a.test.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/a.test.ts
@@ -0,0 +1,2 @@
+it('works', () => {});
+-- not a header, a real added line starting with dashes
diff --git a/docs/old.md b/docs/new.md
similarity index 100%
rename from docs/old.md
rename to docs/new.md
diff --git a/img.png b/img.png
new file mode 100644
index 0000000..4444444
Binary files /dev/null and b/img.png differ
diff --git "a/with space.ts" "b/with space.ts"
deleted file mode 100644
index 5555555..0000000
--- "a/with space.ts"
+++ /dev/null
@@ -1,2 +0,0 @@
-gone
-gone too
`;

describe('parseUnifiedDiff', () => {
  const files = parseUnifiedDiff(SAMPLE);

  it('finds every file including renames and binaries', () => {
    expect(files.map((file) => file.path)).toEqual([
      'src/a.ts',
      'src/a.test.ts',
      'docs/new.md',
      'img.png',
      'with space.ts',
    ]);
  });

  it('counts additions and deletions across multiple hunks', () => {
    expect(files[0]).toEqual({ path: 'src/a.ts', additions: 3, deletions: 2 });
  });

  it('does not mistake in-hunk lines for file headers', () => {
    expect(files[1]).toEqual({ path: 'src/a.test.ts', additions: 2, deletions: 0 });
  });

  it('reports zero lines for pure renames and binary files', () => {
    expect(files[2]).toEqual({ path: 'docs/new.md', additions: 0, deletions: 0 });
    expect(files[3]).toEqual({ path: 'img.png', additions: 0, deletions: 0 });
  });

  it('handles quoted paths and deletions', () => {
    expect(files[4]).toEqual({ path: 'with space.ts', additions: 0, deletions: 2 });
  });

  it('returns an empty list for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});
