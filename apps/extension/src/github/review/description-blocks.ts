/**
 * What tools append to a pull request description, recognised in the rendered page. Each tool marks its content
 * with HTML comments in the Markdown (`<!-- CURSOR_SUMMARY -->`, "auto-generated comment by CodeRabbit"), but
 * GitHub strips comments when it renders, so a tool is known here by what does render: its own heading, its badge
 * or link, its closing line. Surveyed on public pull requests in Nov 2026.
 */

/** One tool's content among the description's top-level blocks, from `start` to `end` inclusive. */
export interface ToolBlock {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  /**
   * Whether the content is known to stop at `end`, so what follows is the author's again. A heading with no closing
   * line of its own (CodeRabbit's summary) runs as its heading's section does.
   */
  readonly bounded: boolean;
}

interface ToolSpec {
  readonly id: string;
  /** The block that opens the tool's content. */
  readonly starts: (block: Element) => boolean;
  /** The block that closes it, searched from the start on. Without one, a heading's section or the start alone. */
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

const headingIs = (title: RegExp) => (block: Element): boolean => {
  const heading = headingOf(block);
  return heading !== null && title.test(textOf(heading));
};

const hrefsOf = (block: Element): string[] => [...block.querySelectorAll('a[href]')].map((link) => link.getAttribute('href') ?? '');

const linksTo = (target: RegExp) => (block: Element): boolean => hrefsOf(block).some((href) => target.test(href));

const TOOL_SPECS: readonly ToolSpec[] = [
  { id: 'coderabbit', starts: headingIs(/^Summary by CodeRabbit$/i) },
  { id: 'sourcery', starts: headingIs(/^Summary by Sourcery$/i) },
  // Its "View guided diff" button closes the summary.
  { id: 'cubic', starts: headingIs(/^Summary by cubic$/i), ends: linksTo(/^https:\/\/(?:www\.)?cubic\.dev\/pr\//) },
  {
    id: 'greptile',
    starts: (block) => block.tagName === 'DETAILS' && /^Greptile Summary$/i.test(textOf(block.querySelector(':scope > summary') ?? block)),
    // "Reviews (N): Last reviewed commit … | Re-trigger Greptile", then sometimes "Greptile also left N inline comments".
    ends: linksTo(/^https:\/\/app\.greptile\.com\//),
    trails: (block) => block.tagName === 'BLOCKQUOTE' && /\bGreptile\b/.test(textOf(block)),
  },
  {
    id: 'ellipsis',
    starts: (block) => linksTo(/^https:\/\/(?:www\.)?ellipsis\.dev\b/)(block) && /description was created by Ellipsis/i.test(textOf(block)),
    ends: (block) => linksTo(/^https:\/\/(?:www\.)?ellipsis\.dev\b/)(block) && /^Generated with .* by ellipsis\.dev$/i.test(textOf(block)),
  },
  // The Note alert headed by the risk level and signed "Written by Cursor Bugbot for commit …".
  { id: 'bugbot', starts: (block) => block.classList.contains('markdown-alert') && /Written by Cursor Bugbot\b/.test(textOf(block)) },
  // A Cursor agent's "Open in Web" / "Open in Cursor" badges.
  {
    id: 'cursor-agent',
    starts: (block) => {
      const hrefs = hrefsOf(block);
      return hrefs.length > 0 && textOf(block) === '' && hrefs.every((href) => /^https:\/\/cursor\.com\/(?:agents|background-agent)\b/.test(href));
    },
  },
  { id: 'claude-code', starts: (block) => linksTo(/^https:\/\/(?:claude\.com\/claude-code|claude\.ai\/code)\b/)(block) && /^(?:🤖 )?Generated with Claude Code$/.test(textOf(block)) },
  { id: 'devin', starts: (block) => linksTo(/^https:\/\/app\.devin\.ai\/sessions\//)(block) && /^Link to Devin (?:session|run)\b/i.test(textOf(block)) },
];

/** Every tool's content among `blocks`, in order and never overlapping. */
export function toolBlocksOf(blocks: readonly Element[]): ToolBlock[] {
  const found: ToolBlock[] = [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    const spec = block === undefined ? undefined : TOOL_SPECS.find((candidate) => candidate.starts(block));
    if (block === undefined || spec === undefined) continue;
    const isHeading = headingOf(block) !== null;
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
    const bounded = end >= 0 || !isHeading;
    if (end < 0) end = index;
    while (spec.trails !== undefined && end + 1 < blocks.length) {
      const trail = blocks[end + 1];
      if (trail === undefined || !spec.trails(trail)) break;
      end += 1;
    }
    found.push({ id: spec.id, start: index, end, bounded });
    index = end;
  }
  return found;
}

/**
 * Where every open section of the description ends: at the start of a tool's content, so it is never nested under
 * the author's last heading, and just after a tool's content that is known to stop, so what follows is top level.
 */
export function sectionResetsOf(tools: readonly ToolBlock[]): Set<number> {
  const resets = new Set<number>();
  for (const tool of tools) {
    resets.add(tool.start);
    if (tool.bounded) resets.add(tool.end + 1);
  }
  return resets;
}
