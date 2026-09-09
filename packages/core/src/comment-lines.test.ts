import { describe, expect, it } from 'vitest';
import { commentSyntaxFor, isCommentOnlyLine, newCommentScanState } from './comment-lines';
import { parseUnifiedDiff } from './diff-parse';

describe('isCommentOnlyLine', () => {
  const ts = commentSyntaxFor('src/a.ts');
  if (ts === null) throw new Error('expected TypeScript syntax');

  it('recognises line comments, blank lines and block comments across lines', () => {
    const state = newCommentScanState();
    expect(isCommentOnlyLine('  // note', ts, state)).toBe(true);
    expect(isCommentOnlyLine('', ts, state)).toBe(true);
    expect(isCommentOnlyLine('/**', ts, state)).toBe(true);
    expect(isCommentOnlyLine(' * Documents things; code-looking: const x = 1;', ts, state)).toBe(true);
    expect(isCommentOnlyLine(' */', ts, state)).toBe(true);
    expect(isCommentOnlyLine('const x = 1; // trailing', ts, state)).toBe(false);
    expect(isCommentOnlyLine('/* a */ const y = 2;', ts, state)).toBe(false);
    expect(isCommentOnlyLine('const url = "http://x"; // not a comment line', ts, state)).toBe(false);
  });

  it('knows other languages and refuses unknown ones', () => {
    const py = commentSyntaxFor('app/main.py');
    expect(py !== null && isCommentOnlyLine('# hello', py, newCommentScanState())).toBe(true);
    const html = commentSyntaxFor('index.html');
    expect(html !== null && isCommentOnlyLine('<!-- x -->', html, newCommentScanState())).toBe(true);
    expect(html !== null && isCommentOnlyLine('<div>', html, newCommentScanState())).toBe(false);
    expect(commentSyntaxFor('README.md')).toBeNull();
    expect(commentSyntaxFor('Dockerfile')).not.toBeNull();
    expect(commentSyntaxFor('LICENSE')).toBeNull();
  });
});

describe('parseUnifiedDiff comment lines', () => {
  const diff = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,4 +10,7 @@ export function f() {
   const a = 1;
+  // Explain why a is one.
+  // It just is.
+  const b = 2;
-  // stale note
+
   return a;
 }
diff --git a/docs/b.ts b/docs/b.ts
index 1111111..2222222 100644
--- a/docs/b.ts
+++ b/docs/b.ts
@@ -1,2 +1,3 @@
 /**
+ * More words.
  */
diff --git a/notes.md b/notes.md
index 1111111..2222222 100644
--- a/notes.md
+++ b/notes.md
@@ -1 +1,2 @@
 # Title
+# Not a code comment
`;
  const [a, b, md] = parseUnifiedDiff(diff);

  it('lists comment-only lines by the line numbers GitHub shows', () => {
    expect(a?.additions).toBe(4);
    expect(a?.deletions).toBe(1);
    // Additions: lines 11 and 12 are comments, 13 is code, 14 is blank (counted as part of the edit).
    expect(a?.commentLines).toEqual({ added: [11, 12, 14], removed: [11] });
    expect(a?.kinds).toBeUndefined();
  });

  it('marks a file whose every changed line is a comment as a comment-only edit', () => {
    expect(b?.kinds).toEqual(['comments']);
    expect(b?.commentLines).toEqual({ added: [2], removed: [] });
  });

  it('leaves unknown languages alone', () => {
    expect(md?.commentLines).toBeUndefined();
    expect(md?.kinds).toBeUndefined();
  });
});
