/**
 * The blocks review bots write into a pull request's description, told apart by the HTML comments each bot
 * brackets its block with (raw Markdown, as GitHub's "Copy Markdown" hands it over; the rendered page drops
 * comments). Surveyed on public pull requests in Nov 2026:
 *
 * - CodeRabbit: `<!-- This is an auto-generated comment: release notes by coderabbit.ai -->` … `<!-- end of
 *   auto-generated comment: release notes by coderabbit.ai -->`, around a "## Summary by CodeRabbit" heading
 *   (sometimes twice) and its list.
 * - Cursor Bugbot: `<!-- CURSOR_SUMMARY -->` … `<!-- /CURSOR_SUMMARY -->`, around a `> [!NOTE]` alert ending
 *   "Written by Cursor Bugbot for commit …", formerly after a `---`.
 * - Greptile: `<!-- greptile_comment -->` … `<!-- /greptile_comment -->`, around `<details open>` blocks
 *   ("Greptile Summary", "Confidence Score: N/5", "Important Files Changed"; an `<h3>Greptile Summary</h3>` in
 *   older ones), a `<sub>` footer and "Greptile also left N inline comments".
 */

export type DescriptionBotId = 'coderabbit' | 'bugbot' | 'greptile';

interface Brackets {
  readonly bot: DescriptionBotId;
  readonly start: RegExp;
  readonly end: RegExp;
}

const BRACKETS: readonly Brackets[] = [
  {
    bot: 'coderabbit',
    start: /<!--\s*This is an auto-generated comment: release notes by coderabbit\.ai\s*-->/gi,
    end: /<!--\s*end of auto-generated comment: release notes by coderabbit\.ai\s*-->/gi,
  },
  { bot: 'bugbot', start: /<!--\s*CURSOR_SUMMARY\s*-->/g, end: /<!--\s*\/CURSOR_SUMMARY\s*-->/g },
  { bot: 'greptile', start: /<!--\s*greptile_comment\s*-->/g, end: /<!--\s*\/greptile_comment\s*-->/g },
];

export interface DescriptionBotSegment {
  readonly bot: DescriptionBotId;
  /**
   * The words the author wrote after this block and before the next bot's (or the end), as plain lowercase words:
   * empty when the block runs to the next one, which is the usual case since bots append.
   */
  readonly after: string;
}

/** Lowercase letters and digits, one space between words: rendered text and Markdown compare as the same words. */
export function plainWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Markdown to the words it shows: comments, images, tags, link targets and code fences' syntax go. */
function markdownWords(markdown: string): string {
  return plainWords(
    markdown
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/https?:\/\/\S+/g, ' '),
  );
}

interface Found {
  readonly bot: DescriptionBotId;
  readonly at: number;
  /** Where the block's end marker ends, or null when it has none. */
  readonly after: number | null;
}

/** The bots' blocks in a description's Markdown, in the order they stand. */
export function descriptionBotSegments(markdown: string): DescriptionBotSegment[] {
  const starts: Found[] = [];
  for (const brackets of BRACKETS) {
    for (const match of markdown.matchAll(brackets.start)) {
      const at = match.index;
      brackets.end.lastIndex = at + match[0].length;
      const end = brackets.end.exec(markdown);
      starts.push({ bot: brackets.bot, at, after: end === null ? null : end.index + end[0].length });
    }
  }
  starts.sort((a, b) => a.at - b.at);
  return starts.map((found, index) => {
    const next = starts[index + 1];
    // A block with no end marker of its own runs to the next one: nothing of the author's can be told after it.
    if (found.after === null) return { bot: found.bot, after: '' };
    const tail = markdown.slice(found.after, next === undefined ? undefined : Math.max(found.after, next.at));
    return { bot: found.bot, after: markdownWords(tail) };
  });
}
