/**
 * What an agent's note in the description says at a glance, and which notes are reviews instead (agent-notes.ts).
 * Kept apart from agent-notes.ts, which reads the page, so the panel can use it where no document exists.
 */

import type { AgentNote } from './agent-notes';
import { verdictOf } from './description-blocks';

/** What a note says at a glance, for its line's glyph: words to read, or a warning (Bugbot's medium or high risk). */
export interface NoteTone {
  readonly kind: 'info' | 'warning';
  /** The glyph's name for screen readers and its tooltip: the risk Bugbot states, else "Note". */
  readonly label: string;
}

export function noteTone(note: AgentNote): NoteTone {
  const risk = note.id === 'bugbot' ? verdictOf('bugbot', note.versions.at(-1)?.blocks ?? []) : null;
  if (risk === null) return { kind: 'info', label: 'Note' };
  return { kind: /^low\b/i.test(risk) ? 'info' : 'warning', label: risk };
}

/**
 * The tools whose block in the description is a review, not a note: Greptile, set to write its summary into the
 * description instead of a comment, gives its confidence score and findings there. While the description has it, the
 * Review bots row reads it as the bot's summary (overview.ts `descriptionReviewComments`) and Agent notes leaves it out.
 */
export const DESCRIPTION_REVIEWERS: ReadonlySet<string> = new Set(['greptile']);
