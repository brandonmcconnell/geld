/**
 * What agents and review bots wrote into the pull request's description (description-blocks.ts), for the digest's
 * Agent notes row: each tool's note as it reads now, and every distinct way it read before, from the description's own
 * edit history (edit-times.ts). Tools rewrite their part of the description as they run, so a note can change, vanish
 * from the description, or exist only in its past.
 */

import { firstSentence } from '@geld/review';
import { OWN_UI_ATTRIBUTE } from '../dom';
import { blockText } from './crawler';
import { toolBlocksOf } from './description-blocks';
import { descriptionBody, descriptionMarkdown, isBlankHeading } from './description';
import { logUrlOfCard, revisionBody, revisionMarkdown, revisionsIn, revisionState } from './edit-times';

/** One way a tool's note read: at a revision of the description (`at`), or as the page has it now (`at` null). */
export interface NoteVersion {
  readonly at: string | null;
  readonly blocks: readonly Element[];
  /** The note as the description has it now. */
  readonly current: boolean;
}

export interface AgentNote {
  /** The tool's id (description-blocks.ts `TOOL_SPECS`). */
  readonly id: string;
  readonly name: string;
  /** The review bot registry's id for the tool's mark. */
  readonly bot: string | null;
  /** Whether the description has this note now; a note found only in its history is not. */
  readonly present: boolean;
  /** The note's first sentence, or what its badges say. */
  readonly preview: string;
  /** Every distinct reading, oldest first: a reading identical to the one before, or one without the note, is not one. */
  readonly versions: readonly NoteVersion[];
}

/** One reading of the description: its top-level blocks at a revision (`at`), oldest first. */
export interface DescriptionReading {
  readonly at: string;
  readonly blocks: readonly Element[];
  /** That revision's Markdown, which says where a tool's block ends when the page cannot (description-blocks.ts). */
  readonly markdown?: string | null;
}

/** How far back the description's history is read: its newest revisions. */
const MAX_READINGS = 30;
/** Revisions read at once. */
const PARALLEL_READINGS = 3;

const textOf = (element: Element): string => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The blocks a tool can be found among: Geld's own controls and empty dividing headings left out. */
function sectionsOf(container: Element): Element[] {
  return [...container.children].filter((block) => !block.hasAttribute(OWN_UI_ATTRIBUTE) && !isBlankHeading(block));
}

interface Found {
  readonly id: string;
  readonly name: string;
  readonly bot: string | null;
  readonly blocks: Element[];
}

/** Each tool's blocks among `blocks`, by tool in the order each first appears (a tool found twice is one note). */
function toolsAmong(blocks: readonly Element[], markdown: string | null): Map<string, Found> {
  const found = new Map<string, Found>();
  for (const tool of toolBlocksOf(blocks, markdown)) {
    // The tool's own title ("Summary by CodeRabbit") says what the row already does, and a rule above it only parted it.
    const members = blocks.slice(tool.start, tool.end + 1).filter((block, offset) => block.tagName !== 'HR' && tool.start + offset !== tool.title);
    const entry = found.get(tool.id);
    if (entry === undefined) found.set(tool.id, { id: tool.id, name: tool.name, bot: tool.bot, blocks: members });
    else entry.blocks.push(...members);
  }
  return found;
}

/**
 * What a note says, for telling readings apart: its words, its links and its pictures' labels. The page and GitHub's
 * edit history render the same Markdown with different markup around it, so markup would tell every reading apart.
 */
export function noteSignature(blocks: readonly Element[]): string {
  return blocks
    .map((block) => {
      const links = [...block.querySelectorAll('a[href]')].map((link) => link.getAttribute('href') ?? '').join(' ');
      const labels = [...block.querySelectorAll('img[alt]')].map((image) => image.getAttribute('alt') ?? '').join(' ');
      return `${textOf(block)}\u0000${links}\u0000${labels}`;
    })
    .join('\u0001');
}

/** A note's one line: its first sentence, its own title and labels left out, or for badges only, what they say. */
export function notePreview(blocks: readonly Element[]): string {
  const content = blocks.filter((block) => !/^H[1-6]$/.test(block.tagName) && !block.classList.contains('markdown-heading'));
  for (const block of content) {
    const copy = block.cloneNode(true);
    if (!(copy instanceof Element)) continue;
    for (const label of copy.querySelectorAll('summary, .markdown-alert-title, sub, sup')) label.remove();
    const text = blockText(copy);
    // `firstSentence` answers "Comment" for no text at all, which is no preview of a note.
    if (text !== '') return firstSentence(text);
  }
  return content
    .flatMap((block) => [...block.querySelectorAll('img[alt]')].map((image) => image.getAttribute('alt')?.trim() ?? ''))
    .filter((alt) => alt !== '')
    .join(' · ');
}

/**
 * Every tool's note from the description as it reads now (`live`) and the readings of its history (oldest first,
 * the newest being the description as it is now when the history is whole). Notes the description has now come first,
 * in its order, then those found only in the past, most recently seen first. `liveMarkdown` (GitHub's Copy Markdown)
 * bounds the live notes as each reading's own Markdown bounds its notes, so the same note reads the same in both.
 */
export function notesFrom(live: readonly Element[], readings: readonly DescriptionReading[], liveMarkdown: string | null = null): AgentNote[] {
  const now = toolsAmong(live, liveMarkdown);
  const versions = new Map<string, NoteVersion[]>();
  const names = new Map<string, { readonly name: string; readonly bot: string | null }>();
  const lastSeen = new Map<string, number>();
  readings.forEach((reading, index) => {
    for (const tool of toolsAmong(reading.blocks, reading.markdown ?? null).values()) {
      names.set(tool.id, { name: tool.name, bot: tool.bot });
      lastSeen.set(tool.id, index);
      const list = versions.get(tool.id) ?? [];
      const previous = list.at(-1);
      if (previous === undefined || noteSignature(previous.blocks) !== noteSignature(tool.blocks)) list.push({ at: reading.at, blocks: tool.blocks, current: false });
      versions.set(tool.id, list);
    }
  });
  const notes: AgentNote[] = [];
  for (const tool of now.values()) {
    const past = versions.get(tool.id) ?? [];
    const latest = past.at(-1);
    // The page's own reading is the current one: the history's newest says the same once read, and is replaced by it.
    const same = latest !== undefined && noteSignature(latest.blocks) === noteSignature(tool.blocks);
    const all = [...(same ? past.slice(0, -1) : past), { at: same ? latest.at : null, blocks: tool.blocks, current: true }];
    notes.push({ id: tool.id, name: tool.name, bot: tool.bot, present: true, preview: notePreview(tool.blocks), versions: all });
  }
  const gone = [...versions.keys()].filter((id) => !now.has(id)).sort((a, b) => (lastSeen.get(b) ?? 0) - (lastSeen.get(a) ?? 0));
  for (const id of gone) {
    const past = versions.get(id) ?? [];
    const identity = names.get(id);
    const latest = past.at(-1);
    if (identity === undefined || latest === undefined) continue;
    notes.push({ id, name: identity.name, bot: identity.bot, present: false, preview: notePreview(latest.blocks), versions: past });
  }
  return notes;
}

/** The blocks of each revision read so far, kept for the page: a revision never changes. */
const readingBlocks = new Map<string, Element[]>();
const listeners = new Set<() => void>();

/** Run `listener` whenever a revision of the description lands (the history window keeps itself current). */
export function onNotesChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface AgentNotes {
  readonly notes: readonly AgentNote[];
  /** The description's history is still being read: more versions, or notes that are gone, may yet appear. */
  readonly reading: boolean;
}

/**
 * The notes in the description now, with its history as far as it has been read: the log first, then its newest
 * revisions a few at a time, `onChange` (and every `onNotesChange` listener) running as each lands.
 */
export function agentNotes(onChange: () => void): AgentNotes {
  const body = descriptionBody();
  if (body === null) return { notes: [], reading: false };
  const notify = (): void => {
    onChange();
    for (const listener of listeners) listener();
  };
  const live = sectionsOf(body);
  const log = logUrlOfCard(body);
  const readings: DescriptionReading[] = [];
  let reading = false;
  if (log !== null) {
    const revisions = revisionsIn(log, notify);
    if (revisions === null) reading = true;
    else {
      const wanted = revisions.slice(-MAX_READINGS);
      let inFlight = wanted.filter((revision) => revisionState(revision.url) === 'reading').length;
      for (const revision of wanted) {
        let blocks = readingBlocks.get(revision.url);
        if (blocks === undefined) {
          const state = revisionState(revision.url);
          if (state === 'failed') continue;
          if (state === 'unread' && inFlight >= PARALLEL_READINGS) {
            reading = true;
            continue;
          }
          if (state === 'unread') inFlight += 1;
          const content = revisionBody(revision.url, notify);
          if (content === undefined) {
            reading = true;
            continue;
          }
          if (content === null) continue;
          blocks = sectionsOf(content);
          readingBlocks.set(revision.url, blocks);
        }
        readings.push({ at: revision.at, blocks, markdown: revisionMarkdown(revision.url) });
      }
    }
  }
  return { notes: notesFrom(live, readings, descriptionMarkdown(body)), reading };
}

/** A copy of a note's blocks to show elsewhere, without what Geld set on the originals. */
export function noteCopy(blocks: readonly Element[]): Node[] {
  return blocks.map((block) => {
    const copy = block.cloneNode(true);
    if (copy instanceof Element) {
      for (const element of [copy, ...copy.querySelectorAll('*')]) {
        for (const name of [...element.getAttributeNames()]) if (name.startsWith('data-geld-')) element.removeAttribute(name);
        if (element.getAttribute('hidden') === 'until-found') element.removeAttribute('hidden');
      }
    }
    return copy;
  });
}

/** Forget the description's history (a new page). */
export function resetAgentNotes(): void {
  readingBlocks.clear();
}
