import type { FileStats } from './diff-parse';
import { parseUnifiedDiff, pathFromGitHeader } from './diff-parse';

export interface DiffLine {
  readonly kind: 'context' | 'added' | 'removed' | 'notice';
  readonly text: string;
  readonly oldLine: number | null;
  readonly newLine: number | null;
}
export interface DiffHunk {
  readonly header: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly DiffLine[];
}
export interface DiffFile extends FileStats {
  readonly oldPath?: string | undefined;
  readonly hunks: readonly DiffHunk[];
  readonly binary: boolean;
}
export function parseUnifiedDiffHunks(text: string): readonly DiffFile[] {
  const files: DiffFile[] = [];
  for (const block of text.split(/(?=^diff --git )/m)) {
    if (!block.startsWith('diff --git ')) continue;
    const stats = parseUnifiedDiff(block)[0];
    if (!stats) continue;
    const hunks: DiffHunk[] = [];
    let current: { header: string; oldStart: number; oldLines: number; newStart: number; newLines: number; lines: DiffLine[] } | null = null;
    let oldLine = 0;
    let newLine = 0;
    let remainingOld = 0;
    let remainingNew = 0;
    for (const line of block.split('\n')) {
      const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (header) {
        current = { header: line, oldStart: Number(header[1]), oldLines: Number(header[2] ?? 1), newStart: Number(header[3]), newLines: Number(header[4] ?? 1), lines: [] };
        hunks.push(current);
        oldLine = current.oldStart; newLine = current.newStart;
        remainingOld = current.oldLines; remainingNew = current.newLines;
        continue;
      }
      if (!current) continue;
      if (line.startsWith('\\ No newline')) { current.lines.push({ kind: 'notice', text: line, oldLine: null, newLine: null }); continue; }
      if (remainingOld <= 0 && remainingNew <= 0) continue;
      if (line.startsWith('+') && remainingNew > 0) { current.lines.push({ kind: 'added', text: line.slice(1), oldLine: null, newLine: newLine++ }); remainingNew -= 1; }
      else if (line.startsWith('-') && remainingOld > 0) { current.lines.push({ kind: 'removed', text: line.slice(1), oldLine: oldLine++, newLine: null }); remainingOld -= 1; }
      else if (line.startsWith(' ') && remainingOld > 0 && remainingNew > 0) { current.lines.push({ kind: 'context', text: line.slice(1), oldLine: oldLine++, newLine: newLine++ }); remainingOld -= 1; remainingNew -= 1; }
    }
    files.push({ ...stats, oldPath: pathFromGitHeader(block.split('\n')[0] ?? '', 'old') ?? stats.path, binary: stats.kinds?.includes('binary') ?? false, hunks });
  }
  return files;
}
