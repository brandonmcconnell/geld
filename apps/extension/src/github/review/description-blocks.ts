/**
 * What tools append to a pull request description, recognised in the rendered page. Each tool marks its content
 * with HTML comments in the Markdown (`<!-- CURSOR_SUMMARY -->`, "auto-generated comment by CodeRabbit"), but
 * GitHub strips comments when it renders, so a tool is known here by what does render: its own heading, its badge
 * or link, its closing line. Surveyed on public pull requests in Nov 2026.
 */

/** One tool's content among the description's top-level blocks, from `start` to `end` inclusive. */
export interface ToolBlock {
  readonly id: string;
  /** How the tool is named on its row. */
  readonly name: string;
  /** The review bot registry's id for the tool's mark, when it has one. */
  readonly bot: string | null;
  readonly start: number;
  readonly end: number;
  /** The tool's own heading ("Summary by CodeRabbit"), which its row stands in for. */
  readonly title: number | null;
}

interface ToolSpec {
  readonly id: string;
  readonly name: string;
  readonly bot: string | null;
  /** The block that opens the tool's content. */
  readonly starts: (block: Element) => boolean;
  /**
   * The block that closes it, searched from the start on. Without one, content opened by a heading runs as that
   * heading's section does (up to the next heading of its level or higher, or the next tool), any other the start alone.
   */
  readonly ends?: (block: Element) => boolean;
  /** Blocks right after the end that still belong to it. */
  readonly trails?: (block: Element) => boolean;
}

/** How far past its start a tool's closing block is looked for. */
const MAX_TOOL_BLOCKS = 40;

const textOf = (element: Element): string => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function headingOf(block: Element): Element | null {
  if (/^H[1-6]$/.test(block.tagName)) return block;
  const inner = block.firstElementChild;
  return block.classList.contains('markdown-heading') && inner !== null && /^H[1-6]$/.test(inner.tagName) ? inner : null;
}

const levelOf = (block: Element): number | null => {
  const heading = headingOf(block);
  return heading === null ? null : Number(heading.tagName.slice(1));
};

const headingIs = (title: RegExp) => (block: Element): boolean => {
  const heading = headingOf(block);
  return heading !== null && title.test(textOf(heading));
};

const hrefsOf = (block: Element): string[] => [...block.querySelectorAll('a[href]')].map((link) => link.getAttribute('href') ?? '');

const linksTo = (target: RegExp) => (block: Element): boolean => hrefsOf(block).some((href) => target.test(href));

/** Bugbot's signature under its note, read from the paragraph that holds it. */
const BUGBOT_SIGNATURE = /^(?:Written|Reviewed|Generated) by Cursor Bugbot\b/;

const TOOL_SPECS: readonly ToolSpec[] = [
  { id: 'coderabbit', name: 'CodeRabbit', bot: 'coderabbit', starts: headingIs(/^Summary by CodeRabbit$/i) },
  { id: 'sourcery', name: 'Sourcery', bot: 'sourcery', starts: headingIs(/^Summary by Sourcery$/i) },
  // Its "View guided diff" button closes the summary.
  { id: 'cubic', name: 'cubic', bot: 'cubic', starts: headingIs(/^Summary by cubic$/i), ends: linksTo(/^https:\/\/(?:www\.)?cubic\.dev\/pr\//) },
  {
    id: 'greptile',
    name: 'Greptile',
    bot: 'greptile',
    starts: (block) => block.tagName === 'DETAILS' && /^Greptile Summary$/i.test(textOf(block.querySelector(':scope > summary') ?? block)),
    // "Reviews (N): Last reviewed commit … | Re-trigger Greptile", then sometimes "Greptile also left N inline comments".
    ends: linksTo(/^https:\/\/app\.greptile\.com\//),
    trails: (block) => block.tagName === 'BLOCKQUOTE' && /\bGreptile\b/.test(textOf(block)),
  },
  {
    id: 'ellipsis',
    name: 'Ellipsis',
    bot: 'ellipsis',
    starts: (block) => linksTo(/^https:\/\/(?:www\.)?ellipsis\.dev\b/)(block) && /description was created by Ellipsis/i.test(textOf(block)),
    ends: (block) => linksTo(/^https:\/\/(?:www\.)?ellipsis\.dev\b/)(block) && /^Generated with .* by ellipsis\.dev$/i.test(textOf(block)),
  },
  // The Note alert headed by the risk level and signed "Written by Cursor Bugbot for commit …", since Nov 2026 "Reviewed
  // by Cursor Bugbot for commit …" (mintlify/mint#14335).
  // The signature is read in its own paragraph: the alert's text runs the paragraphs together ("onlyReviewed by").
  { id: 'bugbot', name: 'Cursor Bugbot', bot: 'bugbot', starts: (block) => block.classList.contains('markdown-alert') && [...block.querySelectorAll('p, sup, sub')].some((part) => BUGBOT_SIGNATURE.test(textOf(part))) },
  // A Cursor agent's "Open in Web" / "Open in Cursor" badges.
  {
    id: 'cursor-agent',
    name: 'Cursor',
    bot: 'bugbot',
    starts: (block) => {
      const hrefs = hrefsOf(block);
      return hrefs.length > 0 && textOf(block) === '' && hrefs.every((href) => /^https:\/\/cursor\.com\/(?:agents|background-agent)\b/.test(href));
    },
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    bot: 'claude',
    starts: (block) => linksTo(/^https:\/\/(?:claude\.com\/claude-code|claude\.ai\/code)\b/)(block) && /^(?:🤖 )?Generated with Claude Code$/.test(textOf(block)),
  },
  { id: 'devin', name: 'Devin', bot: 'devin', starts: (block) => linksTo(/^https:\/\/app\.devin\.ai\/sessions\//)(block) && /^Link to Devin (?:session|run)\b/i.test(textOf(block)) },
];

/**
 * The HTML comments a tool brackets its content with in the description's Markdown (GitHub's "Copy Markdown" keeps
 * them; the rendered page drops them). A heading-led summary has no closing line on the page, so its end marker is
 * the one way to know where the author's own words start again after it. Taken from #418's survey.
 */
const MARKERS: readonly { readonly id: string; readonly start: RegExp; readonly end: RegExp }[] = [
  { id: 'coderabbit', start: /<!--\s*This is an auto-generated comment: release notes by coderabbit\.ai\s*-->/gi, end: /<!--\s*end of auto-generated comment: release notes by coderabbit\.ai\s*-->/gi },
  { id: 'bugbot', start: /<!--\s*CURSOR_SUMMARY\s*-->/g, end: /<!--\s*\/CURSOR_SUMMARY\s*-->/g },
  { id: 'greptile', start: /<!--\s*greptile_comment\s*-->/g, end: /<!--\s*\/greptile_comment\s*-->/g },
  { id: 'cubic', start: /<!--\s*This is an auto-generated description by cubic\.\s*-->/gi, end: /<!--\s*End of auto-generated description by cubic\.\s*-->/gi },
];

/** Lowercase letters and digits, one space between words: the page's text and the Markdown compare as the same words. */
export function plainWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Bare URLs go on both sides: the Markdown's and the page's text must compare as the same words. */
const withoutUrls = (text: string): string => text.replace(/https?:\/\/\S+/g, ' ');

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** What an HTML entity in Markdown renders as; one this list does not know stays as written. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Markdown to the words it shows: comments, images, tags and link targets go, and entities read as they render. */
function markdownWords(markdown: string): string {
  return plainWords(
    withoutUrls(
      decodeEntities(
        markdown
          .replace(/<!--[\s\S]*?-->/g, ' ')
          .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
          .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
          .replace(/<[^>]+>/g, ' '),
      ),
    ),
  );
}

/** A rendered block's text as the same words `markdownWords` gives. */
const pageWords = (block: Element): string => plainWords(withoutUrls(block.textContent ?? ''));

/** How many of the author's words after a tool's end marker are enough to find where they start again on the page. */
const PROBE_WORDS = 6;

/**
 * For each tool, the first words the author wrote after each of its blocks in `markdown`, up to the next tool's
 * block: where the page's rendering of that tool stops. A block followed directly by another tool, or by nothing, has none.
 */
export function authorWordsAfter(markdown: string): Map<string, string[]> {
  const starts: { id: string; at: number; after: number | null }[] = [];
  for (const marker of MARKERS) {
    for (const match of markdown.matchAll(marker.start)) {
      marker.end.lastIndex = match.index + match[0].length;
      const end = marker.end.exec(markdown);
      starts.push({ id: marker.id, at: match.index, after: end === null ? null : end.index + end[0].length });
    }
  }
  starts.sort((a, b) => a.at - b.at);
  const words = new Map<string, string[]>();
  starts.forEach((found, index) => {
    if (found.after === null) return;
    const next = starts[index + 1];
    const tail = markdownWords(markdown.slice(found.after, next === undefined ? undefined : Math.max(found.after, next.at)));
    if (tail === '') return;
    words.set(found.id, [...(words.get(found.id) ?? []), tail.split(' ').slice(0, PROBE_WORDS).join(' ')]);
  });
  return words;
}

const specOf = (block: Element | undefined): ToolSpec | undefined => (block === undefined ? undefined : TOOL_SPECS.find((spec) => spec.starts(block)));

/**
 * Every tool's content among `blocks`, in order and never overlapping. With the description's `markdown`, a
 * heading-led summary stops where the author's own words after it start again (`authorWordsAfter`).
 */
export function toolBlocksOf(blocks: readonly Element[], markdown: string | null = null): ToolBlock[] {
  const resumes = markdown === null ? new Map<string, string[]>() : authorWordsAfter(markdown);
  const found: ToolBlock[] = [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    const spec = specOf(block);
    if (block === undefined || spec === undefined) continue;
    const level = levelOf(block);
    let end = -1;
    if (spec.ends !== undefined) {
      for (let next = index; next < Math.min(blocks.length, index + MAX_TOOL_BLOCKS); next++) {
        const candidate = blocks[next];
        if (candidate !== undefined && spec.ends(candidate)) {
          end = next;
          break;
        }
      }
    }
    if (end < 0 && level !== null) {
      end = index;
      while (end + 1 < blocks.length) {
        const next = blocks[end + 1];
        const nextLevel = next === undefined ? null : levelOf(next);
        if ((nextLevel !== null && nextLevel <= level) || specOf(next) !== undefined) break;
        const words = next === undefined ? '' : pageWords(next);
        if (words !== '' && (resumes.get(spec.id) ?? []).some((probe) => words.startsWith(probe) || probe.startsWith(words))) break;
        end += 1;
      }
    }
    if (end < 0) end = index;
    while (spec.trails !== undefined && end + 1 < blocks.length) {
      const trail = blocks[end + 1];
      if (trail === undefined || !spec.trails(trail)) break;
      end += 1;
    }
    // A rule just before the tool's content (the `---` above "Generated with Claude Code") is the tool's too.
    const previous = found.at(-1);
    const ruled = index > 0 && blocks[index - 1]?.tagName === 'HR' && (previous === undefined || previous.end < index - 1);
    found.push({ id: spec.id, name: spec.name, bot: spec.bot, start: ruled ? index - 1 : index, end, title: level === null ? null : index });
    index = end;
  }
  return found;
}

/** What a tool's content says of the pull request in a word or two, for its heading: Greptile's score, Bugbot's risk. */
export function verdictOf(id: string, content: readonly Element[]): string | null {
  const text = content.map((block) => block.textContent ?? '').join(' ');
  if (id === 'greptile') {
    const score = /Confidence Score:\s*(\d)\s*\/\s*5/i.exec(text);
    return score === null ? null : `${score[1] ?? ''}/5`;
  }
  if (id === 'bugbot') {
    const risk = content.flatMap((block) => [...block.querySelectorAll('strong')]).find((strong) => /^(Low|Medium|High) Risk$/i.test(strong.textContent?.trim() ?? ''));
    return risk?.textContent?.trim() ?? null;
  }
  return null;
}
