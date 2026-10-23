import { describe, expect, it } from 'vitest';
import { detectMoves, isSubstantive, moveNoteWords, movesTouching, normalizeLine } from './moves';
import type { PlanFile, PlanHunk } from './review-plan';
import { hashText, rulesPlan } from './review-plan';

function hunk(index: number, added: readonly string[], removed: readonly string[], newStart = 1, oldStart = newStart): PlanHunk {
  return {
    index,
    header: `@@ -${oldStart},${removed.length} +${newStart},${added.length} @@`,
    oldStart,
    oldLines: removed.length,
    newStart,
    newLines: added.length,
    added,
    addedAt: added.map((_, offset) => newStart + offset),
    removed,
    removedAt: removed.map((_, offset) => oldStart + offset),
    signature: hashText(`${index}:${added.join('|')}:${removed.join('|')}`),
  };
}

function file(path: string, hunks: readonly PlanHunk[], extra: Partial<PlanFile> = {}): PlanFile {
  return { path, status: 'modified', binary: false, hidden: null, hunks, ...extra };
}

const EDITORS = ['const EditorChoice = Schema.Literals([', '  "vscode",', '  "vscode-insiders",', '  "vscodium",', '  "cursor",', '  "windsurf",', '  "zed",', '  "idea",', ']);'];

describe('detectMoves', () => {
  it('finds a block cut from one file and pasted into another, with both line numbers', () => {
    const files = [
      file('pane/local-diffs.tsx', [hunk(0, ['const x = 1;'], EDITORS, 38, 38)]),
      file('thread/editor-launch.ts', [hunk(0, EDITORS, [], 6)], { status: 'added' }),
    ];
    const moves = detectMoves(files);
    expect(moves).toHaveLength(1);
    const [move] = moves;
    expect(move?.from).toEqual({ path: 'pane/local-diffs.tsx', hunk: 0, line: 38, index: 0 });
    expect(move?.to).toEqual({ path: 'thread/editor-launch.ts', hunk: 0, line: 6, index: 0 });
    expect(move?.lines).toBe(EDITORS.length);
    expect(move?.exact).toBe(true);
    expect(move === undefined ? '' : moveNoteWords(move, 'from')).toBe('Moved to editor-launch.ts · 9 lines');
    expect(move === undefined ? '' : moveNoteWords(move, 'to')).toBe('Moved from local-diffs.tsx · 9 lines');
    expect(movesTouching(moves, { path: 'thread/editor-launch.ts', hunk: 0 })).toHaveLength(1);
    expect(movesTouching(moves, { path: 'other.ts', hunk: 0 })).toHaveLength(0);
  });

  it('does not read edits separated by unchanged code as one moved block', () => {
    const scattered: PlanHunk = { ...hunk(0, [], EDITORS, 10), removedAt: EDITORS.map((_, offset) => (offset < 4 ? 10 + offset : 40 + offset)) };
    expect(detectMoves([file('a.ts', [scattered]), file('b.ts', [hunk(0, EDITORS, [], 50)])])).toEqual([]);
  });

  it('finds a moved block that opens on a closing brace or a blank line', () => {
    const block = ['}', '', ...EDITORS.slice(0, 6)];
    const [move] = detectMoves([file('a.ts', [hunk(0, [], block, 10)]), file('b.ts', [hunk(0, block, [], 40)])]);
    expect(move?.lines).toBe(block.length);
    expect(move?.from.line).toBe(10);
    expect(move?.to.line).toBe(40);
  });

  it('reads a reindented move as a move, not exact', () => {
    const indented = EDITORS.map((line) => `    ${line}`);
    const files = [file('a.ts', [hunk(0, [], EDITORS, 10)]), file('b.ts', [hunk(0, indented, [], 50)])];
    const [move] = detectMoves(files);
    expect(move?.lines).toBe(EDITORS.length);
    expect(move?.exact).toBe(false);
    expect(move === undefined ? '' : moveNoteWords(move, 'to')).toBe('Moved from a.ts · 9 lines, reindented');
  });

  it('ignores short blocks, blocks of braces and two ends inside one hunk', () => {
    const braces = ['}', '})', '}', ');', '}', '})', '}'];
    const short = EDITORS.slice(0, 4);
    const files = [
      file('a.ts', [hunk(0, [...short, ...braces], [...braces], 1)]),
      file('b.ts', [hunk(0, [], short, 1)]),
      // The same hunk removing and adding the block (a reorder) is not a move.
      file('c.ts', [hunk(0, EDITORS, EDITORS, 1)]),
    ];
    expect(detectMoves(files)).toEqual([]);
  });

  it('claims each line once, longest block first', () => {
    const files = [
      file('a.ts', [hunk(0, [], EDITORS, 1)]),
      file('b.ts', [hunk(0, EDITORS, [], 1)]),
      file('c.ts', [hunk(0, EDITORS, [], 100)]),
    ];
    // One removed block, pasted twice: only one paste is a move (the other is a copy the detector does not claim).
    const moves = detectMoves(files);
    expect(moves).toHaveLength(1);
  });

  it('normalises whitespace and trailing punctuation and knows a substantive line', () => {
    expect(normalizeLine('   foo(  a,b );  ')).toBe('foo( a,b )');
    expect(normalizeLine('\t"cursor",')).toBe('"cursor"');
    expect(isSubstantive('}')).toBe(false);
    expect(isSubstantive('else')).toBe(false);
    expect(isSubstantive('return')).toBe(false);
    expect(isSubstantive('return x')).toBe(true);
  });

  it('keeps both ends of a move in one rules step', () => {
    const plan = rulesPlan(
      {
        title: 'Move the editor list',
        body: null,
        headSha: 'a'.repeat(40),
        commits: [],
        files: [
          file('pane/local-diffs.tsx', [hunk(0, ['const x = 1;'], EDITORS, 38, 38)]),
          file('thread/editor-launch.ts', [hunk(0, EDITORS, [], 6)], { status: 'added' }),
          file('zzz/unrelated.ts', [hunk(0, ['let y = 2;'], [], 1)]),
        ],
        findings: [],
      },
      'now',
    );
    const together = plan.steps.find((step) => step.touches.some((ref) => ref.path === 'thread/editor-launch.ts'));
    expect(together?.touches.map((ref) => ref.path)).toEqual(['pane/local-diffs.tsx', 'thread/editor-launch.ts']);
    expect(plan.steps).toHaveLength(2);
  });
});
