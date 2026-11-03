import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import { ICON_CHEVRON_DOWN } from '../ui/icons';

/** A description taller than this is cut to it, behind a fade and "Show full description". */
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

const wired = new WeakSet<HTMLElement>();

function toggleOf(element: HTMLElement): HTMLButtonElement {
  const existing = element.querySelector<HTMLButtonElement>(`:scope > .${TOGGLE_CLASS}`);
  if (existing !== null) return existing;
  const toggle = createElement('button', { type: 'button', class: TOGGLE_CLASS, [OWN_UI_ATTRIBUTE]: '' }, [svgFromString(ICON_CHEVRON_DOWN)]);
  element.prepend(toggle);
  return toggle;
}

function wire(block: HTMLElement, body: HTMLElement): void {
  if (wired.has(block)) return;
  wired.add(block);
  block.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    // A link in the heading (GitHub's own anchor, or one in the title) keeps its click; so does selecting the title.
    if (target.closest('a') !== null && target.closest(`.${TOGGLE_CLASS}`) === null) return;
    if (target.closest(`.${TOGGLE_CLASS}`) === null && window.getSelection()?.isCollapsed === false) return;
    const key = block.getAttribute(ATTR_KEY);
    if (key === null) return;
    state.open.set(key, block.getAttribute(ATTR_HEADING) !== 'open');
    // Opening or closing a section is reading the description: the cut would hide what was just opened.
    state.capped = false;
    applyTo(body);
  });
}

function moreButton(body: HTMLElement): HTMLButtonElement {
  const next = body.nextElementSibling;
  if (next instanceof HTMLButtonElement && next.classList.contains(MORE_CLASS)) return next;
  const more = createElement('button', { type: 'button', class: MORE_CLASS, [OWN_UI_ATTRIBUTE]: '' }, [svgFromString(ICON_CHEVRON_DOWN), createElement('span', {})]);
  more.addEventListener('click', () => {
    state.capped = !state.capped;
    applyTo(body);
  });
  body.insertAdjacentElement('afterend', more);
  return more;
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

function applyTo(body: HTMLElement): void {
  const blocks = [...body.children].filter((block) => !block.hasAttribute(OWN_UI_ATTRIBUTE));
  const outline = outlineOf(blocks);
  const folding = new Set(outline.map((heading) => heading.index));
  const openNow = new Map<number, boolean>();
  for (const heading of outline) {
    const block = blocks[heading.index];
    const element = block === undefined ? null : headingElementOf(block);
    if (!(block instanceof HTMLElement) || element === null) continue;
    const key = keyOf(heading, element);
    const open = state.open.get(key) ?? heading.hasSubheadings;
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
    setFlag(block, ATTR_FOLD, hidden.has(index) ? '' : null);
    if (folding.has(index)) return;
    // A block that no longer heads a section (the description was edited) gives up its control.
    setFlag(block, ATTR_HEADING, null);
    setFlag(block, ATTR_KEY, null);
    const element = headingElementOf(block);
    element?.querySelector(`:scope > .${TOGGLE_CLASS}`)?.remove();
  });
  setFlag(body, ATTR_CAP, state.capped ? '' : null);
  const more = moreButton(body);
  const label = state.capped ? 'Show full description' : 'Show less';
  const text = more.querySelector('span');
  if (text !== null && text.textContent !== label) text.textContent = label;
  setFlag(more, 'aria-expanded', String(!state.capped));
  observe(body);
}

function clear(): void {
  state.page = '';
  if (observed !== null) resizeObserver?.unobserve(observed);
  observed = null;
  for (const element of document.querySelectorAll(`.${TOGGLE_CLASS}, .${MORE_CLASS}`)) element.remove();
  for (const name of [ATTR_FOLD, ATTR_HEADING, ATTR_KEY, ATTR_CAP, ATTR_LONG]) {
    for (const element of document.querySelectorAll(`[${name}]`)) element.removeAttribute(name);
  }
}

/**
 * Shorten the pull request's description so the digest under it is in reach: every section folds under its
 * heading (sections with headings of their own start open, the innermost start closed, so the outline shows),
 * and a description still taller than {@link DESCRIPTION_CAP_PX} is cut there behind a fade and "Show full
 * description". Only attributes and Geld's own controls are added; GitHub's nodes stay where they are.
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
