/**
 * Moved code: a block of lines removed in one place and added, the same or
 * near enough, in another. GitHub shows both ends as a red block and a green
 * block and leaves the reader to notice they are the same; the Review tab
 * says so under the first line of each ("Moved to editor-launch.ts · 31
 * lines"), keeps the two ends in one step and tells the model, so a story
 * does not describe a move as new code.
 *
 * Lines are matched after whitespace is normalised (a move into a block
 * reindents everything), so an `exact` move is one whose text is identical
 * and the rest moved with a reindent or a trailing comma. A block needs
 * `MIN_MOVE_LINES` lines of which a share carry something more than a brace,
 * since every file ends functions the same way. Two ends inside one hunk are
 * never a move (that is a reorder, or the normalisation reading a reindent
 * as one). Nothing here touches a browser.
 */

import type { HunkRef, PlanFile } from './review-plan';

/** The fewest lines a block needs to count as moved. */
export const MIN_MOVE_LINES = 6;
/** Of those, at least this share must be substantive (not a lone bracket or keyword). */
const SUBSTANTIVE_SHARE = 0.5;
/** A normalised line seen in more places than this is too common to anchor a match (`return;`, `}`). */
const MAX_OCCURRENCES = 40;

export interface MoveEnd {
  readonly path: string;
  readonly hunk: number;
  /** The first moved line's number in that side's file (old for `from`, new for `to`). */
  readonly line: number;
  /** The first moved line's index among the hunk's removed (`from`) or added (`to`) lines. */
  readonly index: number;
}

export interface MovedBlock {
  readonly from: MoveEnd;
  readonly to: MoveEnd;
  readonly lines: number;
  /** Every line identical, whitespace included. */
  readonly exact: boolean;
}

/** Whitespace folded, trailing commas and semicolons dropped: what survives a reindent and a style pass. */
export function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim().replace(/[,;]+$/, '');
}

const TRIVIAL = /^(?:[{}()[\];,]*|else|end|fi|done|esac|try|finally|default:|return|break|continue|pass|#|\/\/|\/\*|\*\/|\*)$/;

/** A line that says something: not a bracket, a keyword alone or a comment fence. */
export function isSubstantive(normalized: string): boolean {
  return normalized.length >= 3 && !TRIVIAL.test(normalized);
}

interface Side {
  readonly ref: HunkRef;
  readonly raw: readonly string[];
  readonly normalized: readonly string[];
  readonly at: readonly number[];
}

function sidesOf(files: readonly PlanFile[]): { readonly removed: Side[]; readonly added: Side[] } {
  const removed: Side[] = [];
  const added: Side[] = [];
  for (const file of files) {
    for (const hunk of file.hunks) {
      const ref: HunkRef = { path: file.path, hunk: hunk.index };
      if (hunk.removed.length >= MIN_MOVE_LINES) removed.push({ ref, raw: hunk.removed, normalized: hunk.removed.map(normalizeLine), at: hunk.removedAt });
      if (hunk.added.length >= MIN_MOVE_LINES) added.push({ ref, raw: hunk.added, normalized: hunk.added.map(normalizeLine), at: hunk.addedAt });
    }
  }
  return { removed, added };
}

function sameHunk(a: HunkRef, b: HunkRef): boolean {
  return a.path === b.path && a.hunk === b.hunk;
}

/**
 * Every moved block across the files' hunks, longest first, each line
 * claimed by at most one move. Quadratic only in the lines that match, and
 * common lines anchor nothing, so a pull request of ten thousand changed
 * lines is read in a few milliseconds.
 */
export function detectMoves(files: readonly PlanFile[]): readonly MovedBlock[] {
  const { removed, added } = sidesOf(files);
  if (removed.length === 0 || added.length === 0) return [];
  // Where each normalised line is added, for the anchors.
  const addedAt = new Map<string, Array<{ readonly side: number; readonly index: number }>>();
  added.forEach((side, sideIndex) => {
    side.normalized.forEach((line, index) => {
      if (!isSubstantive(line)) return;
      const list = addedAt.get(line) ?? [];
      list.push({ side: sideIndex, index });
      addedAt.set(line, list);
    });
  });

  interface Candidate {
    readonly removedSide: number;
    readonly removedIndex: number;
    readonly addedSide: number;
    readonly addedIndex: number;
    readonly length: number;
  }
  const candidates: Candidate[] = [];
  removed.forEach((side, removedSide) => {
    for (let index = 0; index < side.normalized.length; index += 1) {
      const line = side.normalized[index] ?? '';
      const places = addedAt.get(line);
      if (places === undefined || places.length > MAX_OCCURRENCES) continue;
      for (const place of places) {
        const other = added[place.side];
        if (other === undefined || sameHunk(side.ref, other.ref)) continue;
        // Only runs starting at an anchor: a run beginning one line earlier was found from that line.
        if (index > 0 && place.index > 0 && side.normalized[index - 1] === other.normalized[place.index - 1]) continue;
        let length = 0;
        while (index + length < side.normalized.length && place.index + length < other.normalized.length && side.normalized[index + length] === other.normalized[place.index + length]) length += 1;
        if (length >= MIN_MOVE_LINES) candidates.push({ removedSide, removedIndex: index, addedSide: place.side, addedIndex: place.index, length });
      }
    }
  });
  candidates.sort((a, b) => b.length - a.length || a.removedSide - b.removedSide || a.removedIndex - b.removedIndex);

  const takenRemoved = new Set<string>();
  const takenAdded = new Set<string>();
  const moves: MovedBlock[] = [];
  for (const candidate of candidates) {
    const from = removed[candidate.removedSide];
    const to = added[candidate.addedSide];
    if (from === undefined || to === undefined) continue;
    // Trim the run to the part nobody has claimed yet, from both ends.
    let start = 0;
    let end = candidate.length;
    while (start < end && (takenRemoved.has(`${candidate.removedSide}:${candidate.removedIndex + start}`) || takenAdded.has(`${candidate.addedSide}:${candidate.addedIndex + start}`))) start += 1;
    while (end > start && (takenRemoved.has(`${candidate.removedSide}:${candidate.removedIndex + end - 1}`) || takenAdded.has(`${candidate.addedSide}:${candidate.addedIndex + end - 1}`))) end -= 1;
    const length = end - start;
    if (length < MIN_MOVE_LINES) continue;
    let substantive = 0;
    let exact = true;
    for (let offset = start; offset < end; offset += 1) {
      const removedIndex = candidate.removedIndex + offset;
      const addedIndex = candidate.addedIndex + offset;
      if (isSubstantive(from.normalized[removedIndex] ?? '')) substantive += 1;
      if (from.raw[removedIndex] !== to.raw[addedIndex]) exact = false;
    }
    if (substantive < length * SUBSTANTIVE_SHARE) continue;
    for (let offset = start; offset < end; offset += 1) {
      takenRemoved.add(`${candidate.removedSide}:${candidate.removedIndex + offset}`);
      takenAdded.add(`${candidate.addedSide}:${candidate.addedIndex + offset}`);
    }
    const removedIndex = candidate.removedIndex + start;
    const addedIndex = candidate.addedIndex + start;
    moves.push({
      from: { path: from.ref.path, hunk: from.ref.hunk, line: from.at[removedIndex] ?? 0, index: removedIndex },
      to: { path: to.ref.path, hunk: to.ref.hunk, line: to.at[addedIndex] ?? 0, index: addedIndex },
      lines: length,
      exact,
    });
  }
  return moves;
}

/** The moves whose `from` or `to` end sits in `ref`. */
export function movesTouching(moves: readonly MovedBlock[], ref: HunkRef): readonly MovedBlock[] {
  return moves.filter((move) => sameHunk(move.from, ref) || sameHunk(move.to, ref));
}

/** The file name of a path, for the note's words. */
export function moveNoteWords(move: MovedBlock, side: 'from' | 'to'): string {
  const other = side === 'from' ? move.to : move.from;
  const name = other.path.slice(other.path.lastIndexOf('/') + 1);
  const where = side === 'from' ? `Moved to ${name}` : `Moved from ${name}`;
  return `${where} · ${move.lines} ${move.lines === 1 ? 'line' : 'lines'}${move.exact ? '' : ', reindented'}`;
}
