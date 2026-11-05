import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import { ICON_CHEVRON_DOWN } from '../ui/icons';
import { botAppAvatar, botById } from '@geld/review';
import { toolBlocksOf, verdictOf } from './description-blocks';
import { ATTR_FINDABLE, setFindable } from './fold';

/** A long description with no headings to fold is cut to this height, behind a fade and "Show full description". */
export const DESCRIPTION_CAP_PX = 500;
/** How far past the cap the description must run before it is cut, so a cut never hides only a line or two. */
const CAP_SLACK_PX = 80;

/** On a block of the description hidden under a folded heading. */
const ATTR_FOLD = 'data-geld-desc-fold';
/** On an author's block wholly past the cut: hidden `until-found`, as a fold is, so find-in-page still reaches it. */
const ATTR_CUT = 'data-geld-desc-cut';
/** On the author's block the cut runs through, clipped at `--geld-desc-cut-height`. */
const ATTR_CUT_EDGE = 'data-geld-desc-cut-edge';
const CUT_HEIGHT_PROPERTY = '--geld-desc-cut-height';
/** On GitHub's reactions row while it stands above the agents' summaries, raised by `--geld-desc-lift`. */
const ATTR_LIFTED = 'data-geld-desc-lifted';
const LIFT_PROPERTY = '--geld-desc-lift';
/** On the body: how far the agents' summaries are lowered to make room for the reactions row above them. */
const DROP_PROPERTY = '--geld-desc-drop';
/**
 * On the block that shows last when hidden ones come after it in the DOM (the agents', or the author's while the agents'
 * are away in the digest): GitHub only drops the margin of the body's last child, and the box ends the body's padding
 * below the text, as far as the text stands from the left.
 */
const ATTR_LAST = 'data-geld-desc-last';
/** On a heading block that folds: `open` or `closed`. */
const ATTR_HEADING = 'data-geld-desc-heading';
/** On a heading block: the key its open state is remembered by this visit. */
const ATTR_KEY = 'data-geld-desc-key';
/** On the description body while it may be cut to the cap. */
const ATTR_CAP = 'data-geld-desc-cap';
/** On the description body while its whole height passes the cap. */
const ATTR_LONG = 'data-geld-desc-long';
/** On the description body while it is shortened: scopes the slimmer headings. */
const ATTR_ON = 'data-geld-desc';
/** On a block indented under an open heading, or drawing a rail: its rails are in its inline custom properties. */
const ATTR_DEPTH = 'data-geld-desc-depth';
/** On a heading with nothing to read in it, hidden while the description is shortened. */
const ATTR_BLANK = 'data-geld-desc-blank';
/** On the description body while what tools appended is gathered at its foot under "Agent notes". */
const ATTR_AGENTS = 'data-geld-desc-agents';
/** On a tool's own title or the rule above its content, which its injected heading stands for: hidden. */
const ATTR_AGENT_HIDDEN = 'data-geld-desc-agent-hidden';
/** On each block of a tool's content, and on its injected heading: the tool's id. */
const ATTR_AGENT = 'data-geld-desc-agent';
/** On the description body while tools' content is away in the digest's Agent notes row: it is hidden here. */
const ATTR_TOOLS = 'data-geld-desc-tools';
/** On each block of a tool's content while it is away: the tool's id. */
const ATTR_TOOL = 'data-geld-desc-tool';
/** The flex `order` that puts the tools' content after the author's. Mirrored in style.css. */
const ORDER_PROPERTY = '--geld-desc-order';
const RAIL_PROPERTIES = ['--geld-desc-depth', '--geld-desc-rails', '--geld-desc-rail-pos', '--geld-desc-rail-size', '--geld-desc-edge'] as const;

/** One level of indentation, and the chevron's centre within it. Mirrored in style.css (description outline). */
const INDENT_PX = 24;
const CHEVRON_CENTER_PX = 10;

const TOGGLE_CLASS = 'geld-desc-toggle';
const MORE_CLASS = 'geld-desc-more';
/** The "Agent notes" heading over the tools' headings. */
const AGENTS_CLASS = 'geld-desc-agents';
/** A tool's injected heading. */
const AGENT_CLASS = 'geld-desc-agent';

export interface OutlineHeading {
  /** Index of the heading among the body's blocks. */
  readonly index: number;
  readonly level: number;
  /** Index of the first block after this heading's section. */
  readonly end: number;
  /** The section holds headings of its own (it is open by default, so the tree shows). */
  readonly hasSubheadings: boolean;
}

/**
 * The heading level of a top-level block of rendered Markdown, or null. GitHub renders a heading either bare
 * (`<h2>`) or, on current github.com, wrapped with its anchor (`<div class="markdown-heading"><h2 class="heading-element">`).
 */
export function headingLevelOf(block: Element): number | null {
  const heading = headingElementOf(block);
  return heading === null ? null : Number(heading.tagName.slice(1));
}

function headingElementOf(block: Element): HTMLElement | null {
  const isHeading = (element: Element | null): element is HTMLElement => element instanceof HTMLElement && /^H[1-6]$/.test(element.tagName);
  if (isHeading(block)) return block;
  if (block.classList.contains('markdown-heading') && isHeading(block.firstElementChild)) return block.firstElementChild;
  return null;
}

const BLANK_TEXT = /^[\s\u200b-\u200d\u2060\ufeff]*$/;

/**
 * A heading block with nothing to read in it: some bots post `## &nbsp;` or an empty `<h2>` for the thin rule
 * GitHub draws under it, finer than a `---`. GitHub's anchor link and Geld's toggle are not its content.
 */
export function isBlankHeading(block: Element): boolean {
  const heading = headingElementOf(block);
  if (heading === null) return false;
  const copy = heading.cloneNode(true);
  if (!(copy instanceof Element)) return false;
  for (const extra of copy.querySelectorAll(`a.anchor, .${TOGGLE_CLASS}`)) extra.remove();
  if (copy.querySelector('img, picture, video, svg:not(.octicon-link)') !== null) return false;
  return BLANK_TEXT.test(copy.textContent ?? '');
}

/** The description's own top-level blocks, without Geld's controls. */
function blocksOf(body: HTMLElement): Element[] {
  return [...body.children].filter((block) => !block.hasAttribute(OWN_UI_ATTRIBUTE));
}

/** The blocks the outline is built from: dividers neither fold nor head anything. */
function sectionBlocks(body: HTMLElement): Element[] {
  return blocksOf(body).filter((block) => !isBlankHeading(block));
}

/** One tool's content gathered under its own heading at the foot of the description (every block it wrote, merged). */
interface ToolGroup {
  readonly id: string;
  readonly name: string;
  readonly bot: string | null;
  /** The heading Geld gives it: its logo and name, folding what it wrote. */
  readonly heading: HTMLElement;
  /** What it wrote, its own title and the rules above it left out. */
  readonly content: readonly Element[];
  /** Its own title ("Summary by CodeRabbit") and rules: the injected heading stands for them, so they are hidden. */
  readonly hidden: readonly Element[];
  /** Its first block on the page, which the injected heading stands before. */
  readonly first: Element;
}

interface Layout {
  /** What the outline is built from, in the order it shows: the author's blocks, then each tool's heading and content. */
  readonly blocks: readonly Element[];
  readonly outline: readonly OutlineHeading[];
  readonly groups: readonly ToolGroup[];
  /** Every tool's blocks by tool id, while the digest's Agent notes row shows them (`state.toolsAway`): hidden here. */
  readonly away: ReadonlyMap<Element, string>;
}

/** A tool's heading, kept across passes: Geld's own `h3`, with the tool's logo before its name. */
function toolHeadingOf(body: HTMLElement, id: string, name: string, bot: string | null, verdict: string | null): HTMLElement {
  const label = verdict === null ? name : `${name} · ${verdict}`;
  const existing = [...body.querySelectorAll<HTMLElement>(`:scope > .${AGENT_CLASS}`)].find((heading) => heading.getAttribute(ATTR_AGENT) === id);
  if (existing !== undefined) {
    const shown = existing.querySelector(`.${AGENT_CLASS}__name`);
    if (shown !== null && shown.textContent !== label) shown.textContent = label;
    return existing;
  }
  const registry = bot === null ? null : botById(bot);
  const logo = registry === null ? null : botAppAvatar(registry, 40);
  return createElement('h3', { class: AGENT_CLASS, [OWN_UI_ATTRIBUTE]: '', [ATTR_AGENT]: id }, [
    ...(logo === null ? [] : [createElement('img', { class: `${AGENT_CLASS}__logo`, src: logo, alt: '', width: '20', height: '20' }, [])]),
    createElement('span', { class: `${AGENT_CLASS}__name` }, [label]),
  ]);
}

/** The description's Markdown, from GitHub's own "Copy Markdown" item in its ⋯ menu: the one place its HTML comments survive. */
export function descriptionMarkdown(body: HTMLElement): string | null {
  const copy = body.closest('.timeline-comment, .js-comment-container')?.querySelector('clipboard-copy[data-dd-action-name="pr.description.copy_markdown"]');
  return copy?.getAttribute('value') ?? null;
}

/**
 * The description's outline, with what tools appended (description-blocks.ts) gathered at its foot under "Agent
 * summaries": one heading per tool, each folding everything that tool wrote, wherever in the description it wrote it.
 * The author's sections end before them, so nothing of a tool's is ever nested under the author's last heading, and a
 * tool's own headings inside its content never split it.
 */
function layoutOf(body: HTMLElement): Layout {
  const sections = sectionBlocks(body);
  const found = new Map<string, { name: string; bot: string | null; content: Element[]; hidden: Element[]; first: Element }>();
  const isTool = new Map<Element, string>();
  for (const tool of toolBlocksOf(sections, descriptionMarkdown(body))) {
    const start = sections[tool.start];
    if (start === undefined) continue;
    const group = found.get(tool.id) ?? { name: tool.name, bot: tool.bot, content: [], hidden: [], first: start };
    found.set(tool.id, group);
    sections.slice(tool.start, tool.end + 1).forEach((block, offset) => {
      isTool.set(block, tool.id);
      if (block.tagName === 'HR' || tool.start + offset === tool.title) group.hidden.push(block);
      else group.content.push(block);
    });
  }
  const groups = state.toolsAway ? [] : [...found].map(([id, group]): ToolGroup => ({ id, name: group.name, bot: group.bot, heading: toolHeadingOf(body, id, group.name, group.bot, verdictOf(id, group.content)), content: group.content, hidden: group.hidden, first: group.first }));
  const author = sections.filter((block) => !isTool.has(block));
  // Every section ends where a tool's content was, so what the author wrote after it is top level again; and the
  // tools' headings, after the author's last block, are top level too.
  const resets = new Set<number>([author.length]);
  sections.forEach((block, index) => {
    const next = sections[index + 1];
    if (isTool.has(block) && next !== undefined && !isTool.has(next)) resets.add(author.indexOf(next));
  });
  if (state.toolsAway) return { blocks: author, outline: outlineOf(author, resets), groups: [], away: isTool };
  const blocks = [...author, ...groups.flatMap((group) => [group.heading, ...group.content])];
  const inTool = new Set(groups.flatMap((group) => group.content));
  const levels = blocks.map((block) => (inTool.has(block) ? null : headingLevelOf(block)));
  return { blocks, outline: outlineOf(blocks, resets, levels), groups, away: new Map() };
}

/**
 * Every heading that has something under it, with the blocks its section runs to: up to the next heading of the
 * same or a higher level, or to the first of `resets` after it, where every section ends. A heading with nothing
 * under it has nothing to fold and is left out. `levels` says each block's heading level, by default its own.
 */
export function outlineOf(blocks: readonly Element[], resets: ReadonlySet<number> = new Set(), levels: readonly (number | null)[] = blocks.map(headingLevelOf)): OutlineHeading[] {
  const outline: OutlineHeading[] = [];
  levels.forEach((level, index) => {
    if (level === null) return;
    let end = index + 1;
    let hasSubheadings = false;
    for (; end < levels.length; end++) {
      if (resets.has(end)) break;
      const next = levels[end];
      if (next === null || next === undefined) continue;
      if (next <= level) break;
      hasSubheadings = true;
    }
    if (end > index + 1) outline.push({ index, level, end, hasSubheadings });
  });
  return outline;
}

/** The blocks hidden when the headings `isOpen` says are closed are folded: everything inside a closed section. */
export function hiddenBlocks(outline: readonly OutlineHeading[], isOpen: (heading: OutlineHeading) => boolean): Set<number> {
  const hidden = new Set<number>();
  for (const heading of outline) {
    if (isOpen(heading)) continue;
    for (let index = heading.index + 1; index < heading.end; index++) hidden.add(index);
  }
  return hidden;
}

/**
 * One vertical rail beside a block: for the open section at nesting `level`, passing on to the next block
 * (`through`), stopping at this block's last line (`end`), or, on an open heading itself, starting at its
 * chevron (`own`).
 */
export interface Rail {
  readonly level: number;
  readonly kind: 'through' | 'end' | 'own';
}

export interface BlockRails {
  /** Open sections the block sits in, which is how far it is indented. */
  readonly depth: number;
  readonly rails: readonly Rail[];
}

/**
 * The indentation and rails of every visible block: each open section draws a line from its heading's chevron
 * down to the end of its last visible block, so nested sections read as a tree.
 */
export function railsOf(blockCount: number, outline: readonly OutlineHeading[], hidden: ReadonlySet<number>, isOpen: (heading: OutlineHeading) => boolean): Map<number, BlockRails> {
  const lastVisible = new Map<number, number>();
  for (const heading of outline) {
    for (let index = heading.end - 1; index > heading.index; index--) {
      if (!hidden.has(index)) {
        lastVisible.set(heading.index, index);
        break;
      }
    }
  }
  const result = new Map<number, BlockRails>();
  for (let index = 0; index < blockCount; index++) {
    if (hidden.has(index)) continue;
    const enclosing = outline.filter((heading) => heading.index < index && index < heading.end);
    const rails: Rail[] = enclosing.map((heading, level) => ({ level, kind: lastVisible.get(heading.index) === index ? 'end' : 'through' }));
    const own = outline.find((heading) => heading.index === index);
    if (own !== undefined && isOpen(own) && lastVisible.has(own.index)) rails.push({ level: enclosing.length, kind: 'own' });
    if (enclosing.length > 0 || rails.length > 0) result.set(index, { depth: enclosing.length, rails });
  }
  return result;
}

/** What the reader changed on this page: headings opened or closed by hand, and whether the cut was lifted. */
const state = { page: '', open: new Map<string, boolean>(), capped: true, toolsAway: false };

let resizeObserver: ResizeObserver | null = null;
let observed: HTMLElement | null = null;
let observedRow: HTMLElement | null = null;

export function descriptionBody(): HTMLElement | null {
  const body =
    document.querySelector('.js-comment-container .js-comment-body') ??
    document.querySelector('[data-testid="issue-body"] .markdown-body') ??
    document.querySelector('.timeline-comment .comment-body');
  return body instanceof HTMLElement ? body : null;
}

function setFlag(element: Element, name: string, value: string | null): void {
  if (value === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

/** `position` is the block's place among all the description's blocks, dividers included, so blanking one keeps the rest. */
function keyOf(position: number, element: HTMLElement): string {
  const text = [...element.childNodes]
    .filter((node) => !(node instanceof Element && node.classList.contains(TOGGLE_CLASS)))
    .map((node) => node.textContent ?? '')
    .join('')
    .trim();
  return `${position}:${text}`;
}

/**
 * Everything this copy has wired, dropped together on cleanup: a content-script copy that retires must leave no
 * listener behind, or both copies would handle each click and the second would undo the first.
 */
let wiring = { signal: new AbortController(), blocks: new WeakSet<HTMLElement>(), bodies: new WeakSet<HTMLElement>(), buttons: new WeakSet<HTMLButtonElement>() };

function toggleOf(element: HTMLElement): HTMLButtonElement {
  const existing = element.querySelector<HTMLButtonElement>(`:scope > .${TOGGLE_CLASS}`);
  if (existing !== null) return existing;
  const toggle = createElement('button', { type: 'button', class: TOGGLE_CLASS, [OWN_UI_ATTRIBUTE]: '' }, [svgFromString(ICON_CHEVRON_DOWN)]);
  element.prepend(toggle);
  return toggle;
}

function wire(block: HTMLElement, body: HTMLElement): void {
  if (wiring.blocks.has(block)) return;
  wiring.blocks.add(block);
  block.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    // A link in the heading (GitHub's own anchor, or one in the title) keeps its click; so does selecting the title.
    if (target.closest('a') !== null && target.closest(`.${TOGGLE_CLASS}`) === null) return;
    if (target.closest(`.${TOGGLE_CLASS}`) === null && window.getSelection()?.isCollapsed === false) return;
    const key = block.getAttribute(ATTR_KEY);
    if (key === null) return;
    const opening = block.getAttribute(ATTR_HEADING) !== 'open';
    state.open.set(key, opening);
    // Opening a section is reading the description, so the cut goes with it, as on Show full description. An agent's
    // section stands below the cut, so opening it is not.
    if (opening && !block.classList.contains(AGENT_CLASS)) state.capped = false;
    // The chevron turns in this frame and the section shows in the next: laying out what was folded is the costly
    // part, and once the (composited) rotation has started that work can no longer hold it up.
    setFlag(block, ATTR_HEADING, opening ? 'open' : 'closed');
    const { signal } = wiring.signal;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (signal.aborted) return;
      applyTo(body);
      // A cut body keeps the cap's height whatever folds inside it, so no resize says it now fits: read it once more.
      requestAnimationFrame(() => {
        if (!signal.aborted) measure(body);
      });
    }));
  }, { signal: wiring.signal.signal });
}

/** Lift the cut for good: the reader is reading the description. */
function uncap(body: HTMLElement): void {
  if (!state.capped) return;
  state.capped = false;
  applyTo(body);
}

/**
 * "Show full description" stands inside the body, after the author's blocks and before the agents' (its `order` in the
 * stylesheet), so the agents' summaries show below the cut whatever it hides.
 */
function syncMoreButton(body: HTMLElement, show: boolean): void {
  const existing = body.querySelector<HTMLButtonElement>(`:scope > .${MORE_CLASS}`);
  // A button GitHub re-rendered from a copy of its markup, or one a retired copy made, keeps nothing of its listener.
  if (!show || (existing !== null && !wiring.buttons.has(existing))) existing?.remove();
  if (!show || (existing !== null && wiring.buttons.has(existing))) return;
  const more = createElement('button', { type: 'button', class: MORE_CLASS, [OWN_UI_ATTRIBUTE]: '' }, [svgFromString(ICON_CHEVRON_DOWN), createElement('span', {}, ['Show full description'])]);
  more.addEventListener('click', () => uncap(body), { signal: wiring.signal.signal });
  wiring.buttons.add(more);
  body.append(more);
}

/** The body's own block holding `node`, or null for the body itself. */
function blockHolding(body: HTMLElement, node: Element): Element | null {
  let block: Element | null = node;
  while (block !== null && block.parentElement !== body) block = block.parentElement;
  return block;
}

/** Whether `node` is in what an agent wrote, which stands below the cut: reading it is not reading the description. */
function inAgentBlock(body: HTMLElement, node: Element): boolean {
  return blockHolding(body, node)?.hasAttribute(ATTR_AGENT) === true;
}

/**
 * Opening any collapsible part of a cut description (a `<details>`) is reading it: the cut goes. And when the
 * browser's find-in-page matches text folded under a heading (`hidden="until-found"`), every section around it opens
 * and the cut goes too, so the match is not left under the fade.
 */
function watchBody(body: HTMLElement): void {
  if (wiring.bodies.has(body)) return;
  wiring.bodies.add(body);
  const options = { capture: true, signal: wiring.signal.signal };
  // Neither `toggle` nor `beforematch` bubbles, so both are caught on the way down.
  body.addEventListener('toggle', (event) => {
    if (event.target instanceof HTMLDetailsElement && event.target.open && !inAgentBlock(body, event.target)) uncap(body);
  }, options);
  // The block the cut runs through is `overflow: hidden`, which the browser still scrolls to show a find-in-page match
  // or a focused link below the cut. That text is under no folded heading, so no `beforematch` comes: the scroll is the
  // sign, and the cut goes. Scroll does not bubble, so it is caught on the way down too.
  body.addEventListener('scroll', (event) => {
    const edge = event.target;
    if (!(edge instanceof HTMLElement) || !edge.hasAttribute(ATTR_CUT_EDGE)) return;
    const offset = edge.scrollTop;
    if (offset <= 0 || !state.capped) return;
    uncap(body);
    // Uncut, the block no longer scrolls inside, so the match would drop by that much: the page takes it up instead.
    window.scrollBy({ top: offset, behavior: 'instant' });
  }, options);
  body.addEventListener('beforematch', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const { blocks, outline } = layoutOf(body);
    const index = blocks.findIndex((block) => block === target || block.contains(target));
    if (index < 0) return;
    for (const heading of outline) {
      if (heading.index >= index || index >= heading.end) continue;
      const key = blocks[heading.index]?.getAttribute(ATTR_KEY);
      if (key !== null && key !== undefined) state.open.set(key, true);
    }
    if (!inAgentBlock(body, target)) state.capped = false;
    applyTo(body);
  }, options);
}

/** Hide a block that is folded away, `until-found` so find-in-page still searches it (see `watchBody`). */
function fold(block: Element, flag: string): void {
  setFlag(block, flag, '');
  setFlag(block, 'hidden', 'until-found');
  setFindable(block, true);
}

/** Show a block Geld folded or cut, once neither holds it. Only Geld's own `hidden` is lifted. */
function unfold(block: Element, flag: string): void {
  if (!block.hasAttribute(flag)) return;
  block.removeAttribute(flag);
  if (block.hasAttribute(ATTR_FOLD) || block.hasAttribute(ATTR_CUT)) return;
  if (block.getAttribute('hidden') === 'until-found') block.removeAttribute('hidden');
  setFindable(block, false);
}

function clearCut(body: HTMLElement): void {
  for (const block of body.querySelectorAll(`:scope > [${ATTR_CUT}]`)) unfold(block, ATTR_CUT);
  for (const block of body.querySelectorAll(`:scope > [${ATTR_CUT_EDGE}]`)) {
    block.removeAttribute(ATTR_CUT_EDGE);
    if (block instanceof HTMLElement) setProperty(block, CUT_HEIGHT_PROPERTY, null);
  }
}

/**
 * Cut the author's blocks at {@link DESCRIPTION_CAP_PX}: those wholly past it are hidden, the one it runs through is
 * clipped, and the agents' blocks, laid out after the author's, are never touched. Read with the cut lifted, so a
 * change of width or of what is open is measured as it would lay out whole; reads first, then writes.
 */
function measure(body: HTMLElement): void {
  clearCut(body);
  const author = blocksOf(body).filter((block) => !block.hasAttribute(ATTR_AGENT) && !block.hasAttribute(ATTR_TOOL) && !block.hasAttribute(ATTR_BLANK));
  const top = body.getBoundingClientRect().top;
  const spans = author.map((block) => {
    const box = block.getBoundingClientRect();
    return { block, start: box.top - top, end: box.bottom - top };
  });
  const long = spans.some((span) => span.end > DESCRIPTION_CAP_PX + CAP_SLACK_PX);
  setFlag(body, ATTR_LONG, long ? '' : null);
  if (long && state.capped) {
    for (const { block, start, end } of spans) {
      if (start >= DESCRIPTION_CAP_PX) fold(block, ATTR_CUT);
      else if (end > DESCRIPTION_CAP_PX && block instanceof HTMLElement) {
        setFlag(block, ATTR_CUT_EDGE, '');
        setProperty(block, CUT_HEIGHT_PROPERTY, `${Math.round(DESCRIPTION_CAP_PX - start)}px`);
      }
    }
  }
  liftReactions(body);
}

/** GitHub's reactions row under the description (the reaction picker and its pills), outside the body, and its box. */
function reactionsRowOf(body: HTMLElement): { readonly row: HTMLElement; readonly box: HTMLElement } | null {
  const box = body.closest('.js-comment');
  const row = box?.querySelector('.pr-review-reactions, .comment-reactions') ?? null;
  return box instanceof HTMLElement && row instanceof HTMLElement && !body.contains(row) ? { row, box } : null;
}

function observe(body: HTMLElement): void {
  resizeObserver ??= new ResizeObserver((entries) => {
    if (observed === null) return;
    // The body and the reactions row both move what `measure` reads; one reading serves the batch.
    if (entries.some((entry) => entry.target === observed || entry.target === observedRow)) measure(observed);
  });
  if (observed !== body) {
    if (observed !== null) resizeObserver.unobserve(observed);
    observed = body;
    resizeObserver.observe(body);
  }
  // GitHub replaces the row when a reaction lands; the new one is observed, and observing it is a first reading.
  const row = reactionsRowOf(body)?.row ?? null;
  if (row === observedRow) return;
  if (observedRow !== null) resizeObserver.unobserve(observedRow);
  observedRow = row;
  if (row !== null) resizeObserver.observe(row);
}

const pixels = (length: string): number => Number.parseFloat(length) || 0;

function unlift(body: HTMLElement): void {
  setProperty(body, DROP_PROPERTY, null);
  for (const row of document.querySelectorAll(`[${ATTR_LIFTED}]`)) {
    row.removeAttribute(ATTR_LIFTED);
    if (row instanceof HTMLElement) setProperty(row, LIFT_PROPERTY, null);
  }
}

/**
 * GitHub's reactions row belongs to the author's description, but it stands after the body, under the agents'
 * summaries the body ends with. Neither can move (GitHub's nodes never do), so the two trade places on screen with
 * relative offsets, which lay nothing out again: the row, with the room under it down to the box's edge, is raised to
 * where the agents start (the band's top margin included), and the agents are lowered by that much, so they end the
 * box the body's own padding above its edge. Read with both offsets lifted, then written.
 */
function liftReactions(body: HTMLElement): void {
  const found = reactionsRowOf(body);
  const band = body.querySelector(`:scope > .${AGENTS_CLASS}`);
  unlift(body);
  if (found === null || !(band instanceof HTMLElement)) return;
  const rowTop = found.row.getBoundingClientRect().top;
  const rowHeight = found.row.getBoundingClientRect().height;
  const bandTop = band.getBoundingClientRect().top;
  if (rowHeight === 0 || band.getClientRects().length === 0) return;
  const boxStyle = getComputedStyle(found.box);
  const edge = found.box.getBoundingClientRect().bottom - pixels(boxStyle.borderBottomWidth) - pixels(boxStyle.paddingBottom);
  const start = bandTop - pixels(getComputedStyle(band).marginTop);
  setFlag(found.row, ATTR_LIFTED, '');
  setProperty(found.row, LIFT_PROPERTY, `${start - rowTop}px`);
  setProperty(body, DROP_PROPERTY, `${edge - rowTop}px`);
}

function setProperty(element: HTMLElement, name: string, value: string | null): void {
  if (value === null) {
    if (element.style.getPropertyValue(name) !== '') element.style.removeProperty(name);
  } else if (element.style.getPropertyValue(name) !== value) {
    element.style.setProperty(name, value);
  }
}

const RAIL_LINE = 'linear-gradient(var(--geld-desc-rail), var(--geld-desc-rail))';

/** Indent a block under its open headings and draw its rails, as custom properties its `::before` paints. */
function dressRails(block: HTMLElement, rails: BlockRails | null): void {
  if (rails === null) {
    setFlag(block, ATTR_DEPTH, null);
    for (const name of RAIL_PROPERTIES) setProperty(block, name, null);
    return;
  }
  setFlag(block, ATTR_DEPTH, String(rails.depth));
  setProperty(block, '--geld-desc-depth', String(rails.depth));
  const lines = rails.rails;
  // A 1px line starts half a pixel early so its centre, not its left edge, is under the chevron's centre.
  const x = (rail: Rail): string => `${rail.level * INDENT_PX + CHEVRON_CENTER_PX - 0.5}px`;
  setProperty(block, '--geld-desc-rails', lines.length === 0 ? null : lines.map(() => RAIL_LINE).join(', '));
  setProperty(block, '--geld-desc-rail-pos', lines.length === 0 ? null : lines.map((rail) => `${x(rail)} ${rail.kind === 'own' ? 'var(--geld-desc-chevron-y)' : '0'}`).join(', '));
  setProperty(
    block,
    '--geld-desc-rail-size',
    lines.length === 0
      ? null
      : lines.map((rail) => (rail.kind === 'through' ? '1px 100%' : rail.kind === 'end' ? '1px calc(100% - var(--geld-desc-after) - 1px)' : '1px calc(100% - var(--geld-desc-chevron-y))')).join(', '),
  );
  // The rails' ::before is placed from the padding edge, so a left border (an alert's, a quote's) would push them
  // right of the heading's. Chrome snaps that border to device pixels, so only its used width lines them up.
  const edge = lines.length === 0 ? '0px' : getComputedStyle(block).borderLeftWidth;
  setProperty(block, '--geld-desc-edge', edge === '0px' ? null : edge);
}

/**
 * What tools appended, at the foot whatever the author wrote after it: GitHub's nodes stay where they are, so the body
 * becomes a flex column and each tool's heading and content take a later `order`, after the "Agent notes" heading
 * (`order: 1`). Each tool's heading stands just before its first block. Everything else is left as GitHub has it.
 */
function dressAgents(body: HTMLElement, layout: Layout, all: readonly Element[]): void {
  const ids = new Set(layout.groups.map((group) => group.id));
  for (const heading of body.querySelectorAll(`:scope > .${AGENT_CLASS}`)) {
    if (!ids.has(heading.getAttribute(ATTR_AGENT) ?? '')) heading.remove();
  }
  const tools = new Set<Element>(layout.groups.flatMap((group) => [...group.content, ...group.hidden]));
  for (const block of all) {
    if (tools.has(block) || !(block instanceof HTMLElement)) continue;
    setFlag(block, ATTR_AGENT, null);
    setFlag(block, ATTR_AGENT_HIDDEN, null);
    setProperty(block, ORDER_PROPERTY, null);
  }
  const header = body.querySelector(`:scope > .${AGENTS_CLASS}`);
  if (layout.groups.length === 0) {
    header?.remove();
    setFlag(body, ATTR_AGENTS, null);
    return;
  }
  setFlag(body, ATTR_AGENTS, '');
  if (header === null) body.append(createElement('h2', { class: AGENTS_CLASS, [OWN_UI_ATTRIBUTE]: '' }, ['Agent notes']));
  layout.groups.forEach((group, index) => {
    // 1 is "Show full description", 2 the Agent notes band (style.css).
    const order = String(index + 3);
    if (group.heading.nextElementSibling !== group.first) group.first.before(group.heading);
    setProperty(group.heading, ORDER_PROPERTY, order);
    for (const block of [...group.content, ...group.hidden]) {
      if (!(block instanceof HTMLElement)) continue;
      setFlag(block, ATTR_AGENT, group.id);
      setFlag(block, ATTR_AGENT_HIDDEN, group.hidden.includes(block) ? '' : null);
      setProperty(block, ORDER_PROPERTY, order);
      if (group.hidden.includes(block)) {
        // A hidden title heads nothing: what it folded is the injected heading's now.
        setFlag(block, ATTR_HEADING, null);
        setFlag(block, ATTR_KEY, null);
        headingElementOf(block)?.querySelector(`:scope > .${TOGGLE_CLASS}`)?.remove();
        dressRails(block, null);
      }
    }
  });
}

/**
 * While the digest's Agent notes row shows what tools appended, their blocks are hidden here (`[data-geld-desc-tools]
 * > [data-geld-desc-tool]` in the stylesheet): the description is the author's, and nothing shows twice.
 */
function flagAway(body: HTMLElement, layout: Layout, all: readonly Element[]): void {
  setFlag(body, ATTR_TOOLS, layout.away.size > 0 ? '' : null);
  for (const block of all) {
    const tool = layout.away.get(block) ?? null;
    setFlag(block, ATTR_TOOL, tool);
    if (tool === null || !(block instanceof HTMLElement)) continue;
    setFlag(block, ATTR_HEADING, null);
    setFlag(block, ATTR_KEY, null);
    headingElementOf(block)?.querySelector(`:scope > .${TOGGLE_CLASS}`)?.remove();
    unfold(block, ATTR_FOLD);
    dressRails(block, null);
  }
}

function applyTo(body: HTMLElement): void {
  const all = blocksOf(body);
  // A divider is no section: it neither folds nor heads anything, nor counts as text before the first heading.
  const sections = sectionBlocks(body);
  for (const block of all) setFlag(block, ATTR_BLANK, sections.includes(block) ? null : '');
  for (const block of all) {
    if (!block.hasAttribute(ATTR_BLANK) || !(block instanceof HTMLElement)) continue;
    setFlag(block, ATTR_HEADING, null);
    setFlag(block, ATTR_KEY, null);
    headingElementOf(block)?.querySelector(`:scope > .${TOGGLE_CLASS}`)?.remove();
    unfold(block, ATTR_FOLD);
    dressRails(block, null);
  }
  const layout = layoutOf(body);
  const { blocks, outline } = layout;
  dressAgents(body, layout, all);
  flagAway(body, layout, all);
  const folding = new Set(outline.map((heading) => heading.index));
  const openNow = new Map<number, boolean>();
  // A description that opens on a heading keeps its substance in that first section, whatever its title says.
  // One that opens with text has it above the headings, so there every section starts by the outline rule alone.
  const first = outline[0];
  const leading = first !== undefined && blocks.slice(0, first.index).every((block) => headingLevelOf(block) !== null) ? first : null;
  for (const heading of outline) {
    const block = blocks[heading.index];
    const element = block === undefined ? null : headingElementOf(block);
    if (!(block instanceof HTMLElement) || element === null) continue;
    const agent = block.classList.contains(AGENT_CLASS) ? block.getAttribute(ATTR_AGENT) : null;
    const key = agent !== null ? `agent:${agent}` : keyOf(all.indexOf(block), element);
    // An agent's section starts closed even when nothing of the author's comes before it.
    const open = state.open.get(key) ?? (agent === null && (heading === leading || heading.hasSubheadings));
    openNow.set(heading.index, open);
    setFlag(block, ATTR_KEY, key);
    setFlag(block, ATTR_HEADING, open ? 'open' : 'closed');
    const toggle = toggleOf(element);
    const title = (element.textContent ?? '').trim();
    setFlag(toggle, 'aria-expanded', String(open));
    setFlag(toggle, 'aria-label', `${open ? 'Collapse' : 'Expand'} section ${title}`);
    wire(block, body);
  }
  const hidden = hiddenBlocks(outline, (heading) => openNow.get(heading.index) ?? true);
  blocks.forEach((block, index) => {
    if (hidden.has(index)) fold(block, ATTR_FOLD);
    else unfold(block, ATTR_FOLD);
    if (folding.has(index)) return;
    // A block that no longer heads a section (the description was edited) gives up its control.
    setFlag(block, ATTR_HEADING, null);
    setFlag(block, ATTR_KEY, null);
    const element = headingElementOf(block);
    element?.querySelector(`:scope > .${TOGGLE_CLASS}`)?.remove();
  });
  // The agents' blocks end the layout when they are here, and the author's when they are away: either way the last one
  // shown is the last block not folded away.
  const trailed = layout.groups.length > 0 || layout.away.size > 0;
  const lastShown = trailed ? blocks.findLastIndex((_, index) => !hidden.has(index)) : -1;
  for (const block of all) setFlag(block, ATTR_LAST, block === blocks[lastShown] ? '' : null);
  const rails = railsOf(blocks.length, outline, hidden, (heading) => openNow.get(heading.index) ?? true);
  blocks.forEach((block, index) => {
    if (block instanceof HTMLElement) dressRails(block, rails.get(index) ?? null);
  });
  setFlag(body, ATTR_ON, '');
  // Folded or not, the description is cut while taller than the cap: a long run of text before a heading near the end
  // folds nothing. Opening a section lifts the cut, so it never hides what the reader opened.
  const cut = state.capped;
  setFlag(body, ATTR_CAP, cut ? '' : null);
  if (!cut) clearCut(body);
  syncMoreButton(body, cut);
  watchBody(body);
  observe(body);
}

function release(): void {
  wiring.signal.abort();
  wiring = { signal: new AbortController(), blocks: new WeakSet(), bodies: new WeakSet(), buttons: new WeakSet() };
  if (observed !== null) resizeObserver?.unobserve(observed);
  if (observedRow !== null) resizeObserver?.unobserve(observedRow);
  observed = null;
  observedRow = null;
}

function clear(): void {
  // The page and its choices stay: showing the full timeline and back keeps what the reader opened.
  const body = observed;
  release();
  if (body !== null) unlift(body);
  for (const element of document.querySelectorAll(`[${ATTR_LIFTED}]`)) {
    element.removeAttribute(ATTR_LIFTED);
    if (element instanceof HTMLElement) element.style.removeProperty(LIFT_PROPERTY);
  }
  for (const element of document.querySelectorAll(`[data-geld-desc]`)) {
    if (element instanceof HTMLElement) element.style.removeProperty(DROP_PROPERTY);
  }
  for (const element of document.querySelectorAll(`.${TOGGLE_CLASS}, .${MORE_CLASS}, .${AGENTS_CLASS}, .${AGENT_CLASS}`)) element.remove();
  for (const element of document.querySelectorAll(`[${ATTR_AGENT}]`)) {
    if (element instanceof HTMLElement) element.style.removeProperty(ORDER_PROPERTY);
  }
  for (const element of document.querySelectorAll(`[${ATTR_DEPTH}]`)) {
    if (element instanceof HTMLElement) for (const name of RAIL_PROPERTIES) element.style.removeProperty(name);
  }
  for (const element of document.querySelectorAll(`[${ATTR_FOLD}], [${ATTR_CUT}]`)) {
    if (element.getAttribute('hidden') === 'until-found') element.removeAttribute('hidden');
    element.removeAttribute(ATTR_FINDABLE);
  }
  for (const element of document.querySelectorAll(`[${ATTR_CUT_EDGE}]`)) {
    if (element instanceof HTMLElement) element.style.removeProperty(CUT_HEIGHT_PROPERTY);
  }
  for (const name of [ATTR_TOOLS, ATTR_TOOL, ATTR_FOLD, ATTR_CUT, ATTR_CUT_EDGE, ATTR_HEADING, ATTR_KEY, ATTR_CAP, ATTR_LONG, ATTR_ON, ATTR_DEPTH, ATTR_BLANK, ATTR_AGENTS, ATTR_AGENT, ATTR_AGENT_HIDDEN, ATTR_LAST]) {
    for (const element of document.querySelectorAll(`[${name}]`)) element.removeAttribute(name);
  }
}

/**
 * Shorten the pull request's description so the digest under it is in reach: every section folds under its
 * heading (sections with headings of their own start open, the innermost start closed, so the outline shows, and
 * the first section starts open too when the description opens on a heading).
 * A description still taller than {@link DESCRIPTION_CAP_PX} once folded is cut there behind a fade and "Show full
 * description", until the reader clicks that, opens a section, or opens anything collapsible in it.
 * With `toolsAway`, what tools appended is hidden here, since the digest's Agent notes row shows it.
 * Only attributes and Geld's own controls are added, GitHub's nodes stay where they are.
 */
export function shortenDescription(on: boolean, options: { readonly toolsAway?: boolean } = {}): void {
  if (!on) {
    clear();
    return;
  }
  state.toolsAway = options.toolsAway === true;
  const page = location.pathname;
  if (state.page !== page) {
    state.page = page;
    state.open.clear();
    state.capped = true;
  }
  const body = descriptionBody();
  if (body === null) return;
  applyTo(body);
}

/** A description GitHub has rendered that is not shortened yet, as on a switch back to the conversation tab. */
export function descriptionUnshortened(): boolean {
  const body = descriptionBody();
  return body !== null && !body.hasAttribute(ATTR_ON);
}

/**
 * Stop handling the description but leave it as it is shown. On a switch to another tab GitHub keeps the
 * conversation on screen until the next page replaces it, and unfolding it then showed it whole for a moment.
 */
export function releaseDescription(): void {
  release();
}
