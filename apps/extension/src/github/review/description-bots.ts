import type { DescriptionBotId } from '@geld/review';
import { descriptionBotSegments, plainWords } from '@geld/review';

/** On the heading Geld adds for a bot's block that has none of its own (Greptile's `<details>`, Bugbot's note). */
export const ATTR_BOT_HEAD = 'data-geld-desc-bot';

/** A bot's block in the description, as blocks of the rendered body: `start` up to (not including) `end`. */
export interface BotSection {
  readonly bot: DescriptionBotId;
  readonly start: number;
  readonly end: number;
  /** The words for a heading Geld adds; null when the block opens on a heading of its own. */
  readonly title: string | null;
}

function headingText(block: Element): string | null {
  const heading = block.matches('h1, h2, h3, h4, h5, h6') ? block : block.matches('.markdown-heading') ? block.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6') : null;
  return heading === null ? null : (heading.textContent ?? '').trim();
}

function summaryText(block: Element): string {
  return block instanceof HTMLDetailsElement ? (block.querySelector(':scope > summary')?.textContent ?? '').trim() : '';
}

function isBugbotNote(block: Element): boolean {
  if (!block.matches('.markdown-alert, blockquote')) return false;
  return block.querySelector('a[href*="cursor.com/dashboard"]') !== null || /written by cursor bugbot/i.test(block.textContent ?? '');
}

/** Whether `block` is where `bot`'s block starts on the rendered page. */
function startsBlock(bot: DescriptionBotId, block: Element): boolean {
  if (block.getAttribute(ATTR_BOT_HEAD) === bot) return true;
  switch (bot) {
    case 'coderabbit':
      return /^summary by coderabbit$/i.test(headingText(block) ?? '');
    case 'bugbot':
      return isBugbotNote(block);
    case 'greptile':
      return /^greptile summary$/i.test(headingText(block) ?? '') || /^greptile summary\b/i.test(summaryText(block));
  }
}

/** Words for the heading Geld adds: the bot and its verdict, since the block's own first line repeats its name. */
function titleFor(bot: DescriptionBotId, block: Element, section: readonly Element[]): string | null {
  if (headingText(block) !== null) return null;
  switch (bot) {
    case 'coderabbit':
      return 'Summary by CodeRabbit';
    case 'greptile': {
      const score = section.map(summaryText).map((text) => /^confidence score:\s*(\d)\s*\/\s*5/i.exec(text)?.[1]).find((found) => found !== undefined);
      return score === undefined ? 'Greptile' : `Greptile · ${score}/5`;
    }
    case 'bugbot': {
      const risk = (block.querySelector('strong')?.textContent ?? '').trim();
      return /^\w+ risk$/i.test(risk) ? `Cursor Bugbot · ${risk}` : 'Cursor Bugbot';
    }
  }
}

const ALL_BOTS: readonly DescriptionBotId[] = ['coderabbit', 'bugbot', 'greptile'];

/** The bots present, in order, with the author's words after each; from the page's own signatures when there is no Markdown. */
function segmentsFor(blocks: readonly Element[], markdown: string | null): { bot: DescriptionBotId; after: string }[] {
  if (markdown !== null) return descriptionBotSegments(markdown);
  const seen: { bot: DescriptionBotId; at: number }[] = [];
  for (const bot of ALL_BOTS) {
    const at = blocks.findIndex((block) => startsBlock(bot, block));
    if (at >= 0) seen.push({ bot, at });
  }
  return seen.sort((a, b) => a.at - b.at).map(({ bot }) => ({ bot, after: '' }));
}

const PROBE_WORDS = 6;

/** The first block from `from` that reads as the start of `after` (the author's words after a bot's block). */
function resumeAt(blocks: readonly Element[], from: number, to: number, after: string): number | null {
  const probe = after.split(' ').slice(0, PROBE_WORDS).join(' ');
  for (let index = from; index < to; index++) {
    const block = blocks[index];
    if (block === undefined) continue;
    const words = plainWords(block.textContent ?? '');
    if (words !== '' && (words.startsWith(probe) || probe.startsWith(words))) return index;
  }
  return null;
}

/**
 * Where each bot's block stands among the description's rendered blocks. The Markdown's markers (GitHub's "Copy
 * Markdown", when the page has it) say which bots wrote into it and whether the author wrote anything after; the
 * rendered blocks say where each starts. A block runs to the next bot's, or to the end, or to where the author's
 * words resume; Bugbot's is its note alone (and a `---` just before it, which its older notes carried).
 */
export function botSectionsOf(blocks: readonly Element[], markdown: string | null): BotSection[] {
  const segments = segmentsFor(blocks, markdown);
  const starts: { bot: DescriptionBotId; after: string; start: number }[] = [];
  let from = 0;
  for (const segment of segments) {
    const at = blocks.findIndex((block, index) => index >= from && startsBlock(segment.bot, block));
    if (at < 0) continue;
    const previous = blocks[at - 1];
    const ruled = segment.bot === 'bugbot' && previous?.tagName === 'HR' && at - 1 >= from;
    starts.push({ ...segment, start: ruled ? at - 1 : at });
    from = at + 1;
  }
  return starts.map((found, index) => {
    const next = starts[index + 1]?.start ?? blocks.length;
    let end = next;
    if (found.bot === 'bugbot') {
      const note = blocks.findIndex((block, at) => at >= found.start && at < next && isBugbotNote(block));
      if (note >= 0) end = note + 1;
    } else if (found.after !== '') {
      end = resumeAt(blocks, found.start + 1, next, found.after) ?? next;
    }
    let firstAt = found.start;
    if (blocks[firstAt]?.hasAttribute(ATTR_BOT_HEAD) === true) firstAt++;
    if (blocks[firstAt]?.tagName === 'HR') firstAt++;
    const first = blocks[firstAt];
    return { bot: found.bot, start: found.start, end, title: first === undefined ? null : titleFor(found.bot, first, blocks.slice(firstAt, end)) };
  });
}
