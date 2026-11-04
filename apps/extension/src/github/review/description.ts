import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import { ICON_CHEVRON_DOWN } from '../ui/icons';
import { ATTR_FINDABLE, setFindable } from './fold';

/** A long description with no headings to fold is cut to this height, behind a fade and "Show full description". */
export const DESCRIPTION_CAP_PX = 500;
/** How far past the cap the description must run before it is cut, so a cut never hides only a line or two. */
const CAP_SLACK_PX = 80;

/** On a block of the description hidden under a folded heading. */
const ATTR_FOLD = 'data-geld-desc-fold';
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
const RAIL_PROPERTIES = ['--geld-desc-depth', '--geld-desc-rails', '--geld-desc-rail-pos', '--geld-desc-rail-size'] as const;

/** One level of indentation, and the chevron's centre within it. Mirrored in style.css (description outline). */
const INDENT_PX = 24;
const CHEVRON_CENTER_PX = 10;

const TOGGLE_CLASS = 'geld-desc-toggle';
const MORE_CLASS = 'geld-desc-more';

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

/**
 * Every heading that has something under it, with the blocks its section runs to: up to the next heading of the
 * same or a higher level. A heading with nothing under it has nothing to fold and is left out.
 */
export function outlineOf(blocks: readonly Element[]): OutlineHeading[] {
  const levels = blocks.map(headingLevelOf);
  const outline: OutlineHeading[] = [];
  levels.forEach((level, index) => {
    if (level === null) return;
    let end = index + 1;
    let hasSubheadings = false;
    for (; end < levels.length; end++) {
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
const state = { page: '', open: new Map<string, boolean>(), capped: true };

let resizeObserver: ResizeObserver | null = null;
let observed: HTMLElement | null = null;

function descriptionBody(): HTMLElement | null {
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

function keyOf(heading: OutlineHeading, element: HTMLElement): string {
  const text = [...element.childNodes]
    .filter((node) => !(node instanceof Element && node.classList.contains(TOGGLE_CLASS)))
    .map((node) => node.textContent ?? '')
    .join('')
    .trim();
  return `${heading.index}:${text}`;
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
    // The chevron turns in this frame and the section shows in the next: laying out what was folded is the costly
    // part, and once the (composited) rotation has started that work can no longer hold it up.
    setFlag(block, ATTR_HEADING, opening ? 'open' : 'closed');
    const { signal } = wiring.signal;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!signal.aborted) applyTo(body);
    }));
  }, { signal: wiring.signal.signal });
}

/** Lift the cut for good: the reader is reading the description. */
function uncap(body: HTMLElement): void {
  if (!state.capped) return;
  state.capped = false;
  applyTo(body);
}

function syncMoreButton(body: HTMLElement, show: boolean): void {
  const next = body.nextElementSibling;
  const existing = next instanceof HTMLButtonElement && next.classList.contains(MORE_CLASS) ? next : null;
  // A button GitHub re-rendered from a copy of its markup, or one a retired copy made, keeps nothing of its listener.
  if (!show || (existing !== null && !wiring.buttons.has(existing))) existing?.remove();
  if (!show || (existing !== null && wiring.buttons.has(existing))) return;
  const more = createElement('button', { type: 'button', class: MORE_CLASS, [OWN_UI_ATTRIBUTE]: '' }, [svgFromString(ICON_CHEVRON_DOWN), createElement('span', {}, ['Show full description'])]);
  more.addEventListener('click', () => uncap(body), { signal: wiring.signal.signal });
  wiring.buttons.add(more);
  body.insertAdjacentElement('afterend', more);
}

/**
 * Opening any collapsible part of a cut description (a `<details>`) is reading it: the cut goes. And when the
 * browser's find-in-page matches text folded under a heading (`hidden="until-found"`), every section around it opens.
 */
function watchBody(body: HTMLElement): void {
  if (wiring.bodies.has(body)) return;
  wiring.bodies.add(body);
  const options = { capture: true, signal: wiring.signal.signal };
  // Neither `toggle` nor `beforematch` bubbles, so both are caught on the way down.
  body.addEventListener('toggle', (event) => {
    if (event.target instanceof HTMLDetailsElement && event.target.open) uncap(body);
  }, options);
  body.addEventListener('beforematch', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const blocks = [...body.children].filter((block) => !block.hasAttribute(OWN_UI_ATTRIBUTE));
    const index = blocks.findIndex((block) => block === target || block.contains(target));
    if (index < 0) return;
    for (const heading of outlineOf(blocks)) {
      if (heading.index >= index || index >= heading.end) continue;
      const key = blocks[heading.index]?.getAttribute(ATTR_KEY);
      if (key !== null && key !== undefined) state.open.set(key, true);
    }
    applyTo(body);
  }, options);
}

function measure(body: HTMLElement): void {
  // While cut, the body's scroll height is still its whole height, so this reads the same either way.
  setFlag(body, ATTR_LONG, body.scrollHeight > DESCRIPTION_CAP_PX + CAP_SLACK_PX ? '' : null);
}

function observe(body: HTMLElement): void {
  if (observed === body) return;
  resizeObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) if (entry.target instanceof HTMLElement && entry.target === observed) measure(entry.target);
  });
  if (observed !== null) resizeObserver.unobserve(observed);
  observed = body;
  resizeObserver.observe(body);
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
}

function applyTo(body: HTMLElement): void {
  const blocks = [...body.children].filter((block) => !block.hasAttribute(OWN_UI_ATTRIBUTE));
  const outline = outlineOf(blocks);
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
    const key = keyOf(heading, element);
    const open = state.open.get(key) ?? (heading === leading || heading.hasSubheadings);
    openNow.set(heading.index, open);
    setFlag(block, ATTR_KEY, key);
    setFlag(block, ATTR_HEADING, open ? 'open' : 'closed');
    const toggle = toggleOf(element);
    const title = key.slice(key.indexOf(':') + 1);
    setFlag(toggle, 'aria-expanded', String(open));
    setFlag(toggle, 'aria-label', `${open ? 'Collapse' : 'Expand'} section ${title}`);
    wire(block, body);
  }
  const hidden = hiddenBlocks(outline, (heading) => openNow.get(heading.index) ?? true);
  blocks.forEach((block, index) => {
    // `until-found`, so find-in-page still searches what is folded (see `watchBody`). Only Geld's own `hidden` is lifted.
    if (hidden.has(index)) {
      setFlag(block, ATTR_FOLD, '');
      setFlag(block, 'hidden', 'until-found');
      setFindable(block, true);
    } else if (block.hasAttribute(ATTR_FOLD)) {
      block.removeAttribute(ATTR_FOLD);
      if (block.getAttribute('hidden') === 'until-found') block.removeAttribute('hidden');
      setFindable(block, false);
    }
    if (folding.has(index)) return;
    // A block that no longer heads a section (the description was edited) gives up its control.
    setFlag(block, ATTR_HEADING, null);
    setFlag(block, ATTR_KEY, null);
    const element = headingElementOf(block);
    element?.querySelector(`:scope > .${TOGGLE_CLASS}`)?.remove();
  });
  const rails = railsOf(blocks.length, outline, hidden, (heading) => openNow.get(heading.index) ?? true);
  blocks.forEach((block, index) => {
    if (block instanceof HTMLElement) dressRails(block, rails.get(index) ?? null);
  });
  setFlag(body, ATTR_ON, '');
  // Only a description with no headings to fold is cut: one with headings is already short once folded.
  const cut = state.capped && outline.length === 0;
  setFlag(body, ATTR_CAP, cut ? '' : null);
  syncMoreButton(body, cut);
  watchBody(body);
  observe(body);
}

function clear(): void {
  // The page and its choices stay: showing the full timeline and back keeps what the reader opened.
  wiring.signal.abort();
  wiring = { signal: new AbortController(), blocks: new WeakSet(), bodies: new WeakSet(), buttons: new WeakSet() };
  if (observed !== null) resizeObserver?.unobserve(observed);
  observed = null;
  for (const element of document.querySelectorAll(`.${TOGGLE_CLASS}, .${MORE_CLASS}`)) element.remove();
  for (const element of document.querySelectorAll(`[${ATTR_DEPTH}]`)) {
    if (element instanceof HTMLElement) for (const name of RAIL_PROPERTIES) element.style.removeProperty(name);
  }
  for (const element of document.querySelectorAll(`[${ATTR_FOLD}]`)) {
    if (element.getAttribute('hidden') === 'until-found') element.removeAttribute('hidden');
    element.removeAttribute(ATTR_FINDABLE);
  }
  for (const name of [ATTR_FOLD, ATTR_HEADING, ATTR_KEY, ATTR_CAP, ATTR_LONG, ATTR_ON, ATTR_DEPTH]) {
    for (const element of document.querySelectorAll(`[${name}]`)) element.removeAttribute(name);
  }
}

/**
 * Shorten the pull request's description so the digest under it is in reach: every section folds under its
 * heading (sections with headings of their own start open, the innermost start closed, so the outline shows, and
 * the first section starts open too when the description opens on a heading).
 * A description with no headings to fold that is taller than {@link DESCRIPTION_CAP_PX} is cut there behind a
 * fade and "Show full description", until the reader clicks that or opens anything collapsible in it.
 * Only attributes and Geld's own controls are added, GitHub's nodes stay where they are.
 */
export function shortenDescription(on: boolean): void {
  if (!on) {
    clear();
    return;
  }
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
