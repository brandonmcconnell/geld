import { createElement, OWN_UI_ATTRIBUTE } from '../dom';
import { editCountOf } from './edit-times';

/** On the description header's line while it is slimmed: everything in it but the kept parts is hidden. */
const ATTR_LINE = 'data-geld-desc-byline';
/** On a part of that line that stays: the author, the time, the edit menu (and GitHub's picture for narrow screens). */
const ATTR_KEEP = 'data-geld-desc-keep';
/** On the edit menu's summary while it reads "N edits" instead of "edited by <last editor>". */
const ATTR_EDITS = 'data-geld-desc-edits';
const EDITS_CLASS = 'geld-desc-edits';

const KEEP = ':scope > strong, :scope > a.js-timestamp, :scope > .js-comment-edit-history, :scope > .d-md-none';

let on = false;

/** The line of the pull request description's header that holds the author, the time and the edit menu. */
function bylineLine(): HTMLElement | null {
  const card = document.querySelector('.js-command-palette-pull-body') ?? document.querySelector('.js-discussion .js-comment-container');
  const heading = card?.querySelector('.timeline-comment-header h3');
  if (!(heading instanceof HTMLElement)) return null;
  const line = heading.querySelector(':scope > .d-flex');
  return line instanceof HTMLElement ? line : heading;
}

function setFlag(element: Element, name: string, value: string | null): void {
  if (value === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

export function editsWords(count: number | null): string {
  if (count === null) return 'edited';
  return `${count} ${count === 1 ? 'edit' : 'edits'}`;
}

function dressEdits(line: HTMLElement): void {
  const history = line.querySelector(':scope > .js-comment-edit-history');
  const summary = history?.querySelector('summary');
  const log = history?.querySelector('details-menu[src*="show_edit_history_log"]')?.getAttribute('src') ?? null;
  if (!(summary instanceof HTMLElement)) return;
  const words = editsWords(log === null ? null : editCountOf(log, () => {
    if (on) compactDescriptionByline(true);
  }));
  setFlag(summary, ATTR_EDITS, '');
  const holder = summary.querySelector(':scope > .position-relative') ?? summary;
  let edits = holder.querySelector(`:scope > .${EDITS_CLASS}`);
  if (edits === null) {
    edits = createElement('span', { class: EDITS_CLASS, [OWN_UI_ATTRIBUTE]: '' }, [words]);
    holder.prepend(edits);
  } else if (edits.textContent !== words) {
    edits.textContent = words;
  }
}

function clear(): void {
  for (const element of document.querySelectorAll(`.${EDITS_CLASS}`)) element.remove();
  for (const name of [ATTR_LINE, ATTR_KEEP, ATTR_EDITS]) {
    for (const element of document.querySelectorAll(`[${name}]`)) element.removeAttribute(name);
  }
}

/**
 * The description's header says who wrote it and when, and how often it was edited: GitHub's "commented", the App
 * it was posted with (whose mark is already on the author's picture) and "edited by <last editor>" go, and the edit
 * menu reads "3 edits" and still opens GitHub's edit history. Only attributes and Geld's own label are added.
 */
export function compactDescriptionByline(enabled: boolean): void {
  on = enabled;
  if (!enabled) {
    clear();
    return;
  }
  const line = bylineLine();
  if (line === null) return;
  setFlag(line, ATTR_LINE, '');
  const kept = new Set(line.querySelectorAll(KEEP));
  for (const child of line.children) setFlag(child, ATTR_KEEP, kept.has(child) ? '' : null);
  dressEdits(line);
}
