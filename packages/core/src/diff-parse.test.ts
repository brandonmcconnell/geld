import { parseUnifiedDiff, pathFromGitHeader } from './diff-parse';
import { parseUnifiedDiffHunks } from './diff-hunks';

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
diff --git a/scripts/run.sh b/scripts/run.sh
old mode 100644
new mode 100755
diff --git a/src/indent.ts b/src/indent.ts
index 6666666..7777777 100644
--- a/src/indent.ts
+++ b/src/indent.ts
@@ -1,3 +1,3 @@
 function f() {
-  return 1;
+    return 1;
 }
@@ -8,2 +8,2 @@
-const x = [1, 2];
+const x = [1,2];
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
      'scripts/run.sh',
      'src/indent.ts',
    ]);
  });

  it('counts additions and deletions across multiple hunks', () => {
    expect(files[0]).toEqual({ path: 'src/a.ts', additions: 3, deletions: 2, status: 'modified' });
  });

  it('does not mistake in-hunk lines for file headers', () => {
    expect(files[1]).toEqual({ path: 'src/a.test.ts', additions: 2, deletions: 0, status: 'added' });
  });

  it('reports zero lines for pure renames and binary files, and says which kind they are', () => {
    expect(files[2]).toEqual({ path: 'docs/new.md', additions: 0, deletions: 0, status: 'renamed', kinds: ['renames'] });
    expect(files[3]).toEqual({ path: 'img.png', additions: 0, deletions: 0, status: 'added', kinds: ['binary'] });
  });

  it('handles quoted paths and deletions', () => {
    expect(files[4]).toEqual({ path: 'with space.ts', additions: 0, deletions: 2, status: 'deleted', kinds: ['deleted'] });
  });

  it('decodes Git octal UTF-8 paths and mixed-quoted renames to their native filenames', () => {
    const headers = [
      String.raw`diff --git "a/src/caf\303\251.test.ts" "b/src/caf\303\251.test.ts"`,
      String.raw`diff --git a/src/old.ts "b/src/\346\265\213\350\257\225.test.ts"`,
      String.raw`diff --git "a/src/\346\265\213\350\257\225.ts" b/src/new.ts`,
      String.raw`diff --git "a/with\tquote\"\\.ts" "b/with\tquote\"\\.ts"`,
    ];
    const parsed = parseUnifiedDiff(headers.map((header) => `${header}\n@@ -1 +1 @@\n-old\n+new`).join('\n'));
    expect(parsed.map((file) => file.path)).toEqual(['src/café.test.ts', 'src/测试.test.ts', 'src/new.ts', 'with\tquote"\\.ts']);
    expect(parsed.every((file) => file.additions === 1 && file.deletions === 1)).toBe(true);
  });

  it('keeps both sides of mixed-quoted renames for hunk source paths', () => {
    const cases = [
      { header: String.raw`diff --git "a/src/caf\303\251.ts" "b/src/\346\265\213\350\257\225.ts"`, oldPath: 'src/café.ts', path: 'src/测试.ts' },
      { header: String.raw`diff --git a/src/old.ts "b/src/caf\303\251.ts"`, oldPath: 'src/old.ts', path: 'src/café.ts' },
      { header: String.raw`diff --git "a/src/caf\303\251.ts" b/src/new.ts`, oldPath: 'src/café.ts', path: 'src/new.ts' },
      { header: String.raw`diff --git "a/old\tquote\"\\.ts" "b/new\tquote\"\\.ts"`, oldPath: 'old\tquote"\\.ts', path: 'new\tquote"\\.ts' },
      { header: 'diff --git a/old name.ts b/new name.ts', oldPath: 'old name.ts', path: 'new name.ts' },
    ];
    for (const { header, oldPath, path } of cases) {
      expect(pathFromGitHeader(header, 'old')).toBe(oldPath);
      expect(pathFromGitHeader(header, 'new')).toBe(path);
      expect(pathFromGitHeader(header)).toBe(path);
      const files = parseUnifiedDiffHunks(`${header}\nsimilarity index 80%\nrename from ${oldPath}\nrename to ${path}\n@@ -1 +1 @@\n-before\n+after\n`);
      expect(files[0]).toMatchObject({ oldPath, path, status: 'renamed', additions: 1, deletions: 1 });
      expect(files[0]?.hunks[0]?.lines).toEqual([
        { kind: 'removed', text: 'before', oldLine: 1, newLine: null },
        { kind: 'added', text: 'after', oldLine: null, newLine: 1 },
      ]);
    }
  });

  it('declines malformed quoted destinations on either side', () => {
    for (const header of [String.raw`diff --git "a/old.ts" "b/new.ts`, String.raw`diff --git a/old.ts "b/new.ts`]) {
      expect(pathFromGitHeader(header, 'old')).toBeNull();
      expect(pathFromGitHeader(header, 'new')).toBeNull();
    }
  });

  it('spots mode-only and whitespace-only changes', () => {
    expect(files[5]).toEqual({ path: 'scripts/run.sh', additions: 0, deletions: 0, status: 'modified', kinds: ['modes'] });
    expect(files[6]).toEqual({ path: 'src/indent.ts', additions: 2, deletions: 2, status: 'modified', kinds: ['whitespace'] });
  });

  it('leaves ordinary edits without kinds', () => {
    expect(files[0]?.kinds).toBeUndefined();
    expect(files[1]?.kinds).toBeUndefined();
  });

  it('returns an empty list for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});

describe('parseUnifiedDiff removedImports', () => {
  it('reads the imports a surviving file dropped and every import of a deleted one', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,2 @@',
      " import { c } from './c';",
      "-import { b } from './b';",
      '-const x = 1;',
      '+const x = 2;',
      'diff --git a/src/gone.ts b/src/gone.ts',
      'deleted file mode 100644',
      'index 3333333..0000000',
      '--- a/src/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      "-import { a } from './a';",
      "-export * from './c';",
      'diff --git a/README.md b/README.md',
      'index 4444444..5555555 100644',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -1 +1 @@',
      "-import x from './nope'",
      '+text',
    ].join('\n');
    const files = parseUnifiedDiff(diff);
    expect(files.find((file) => file.path === 'src/a.ts')?.removedImports).toEqual(['./b']);
    expect(files.find((file) => file.path === 'src/gone.ts')?.removedImports).toEqual(['./a', './c']);
    expect(files.find((file) => file.path === 'README.md')?.removedImports).toBeUndefined();
  });

  it('reads a removed line with the context around it, so a line inside a kept comment is no import', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,5 +1,4 @@',
      ' /*',
      "-import './b';",
      ' */',
      "-import { c } from './c';",
      "+import { c } from './c.js';",
      " import { d } from './d';",
    ].join('\n');
    expect(parseUnifiedDiff(diff)[0]?.removedImports).toEqual(['./c']);
  });

  it('reads each hunk on its own, so a comment one hunk opens does not hide a removed import in the next', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,1 @@',
      ' /*',
      '- * old note',
      '@@ -40,2 +39,1 @@',
      ' const x = 1;',
      "-import { b } from './b';",
    ].join('\n');
    expect(parseUnifiedDiff(diff)[0]?.removedImports).toEqual(['./b']);
  });
});
