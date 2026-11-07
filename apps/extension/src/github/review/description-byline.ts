/** On the description header's line while it is slimmed: everything in it but the kept parts is hidden. */
const ATTR_LINE = 'data-geld-desc-byline';
/** On a part of that line that stays: the author, the time, the edit menu (and GitHub's picture for narrow screens). */
const ATTR_KEEP = 'data-geld-desc-keep';

const KEEP = ':scope > strong, :scope > a.js-timestamp, :scope > .js-comment-edit-history, :scope > .d-md-none';

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

function clear(): void {
  for (const name of [ATTR_LINE, ATTR_KEEP]) {
    for (const element of document.querySelectorAll(`[${name}]`)) element.removeAttribute(name);
  }
}

/**
 * The description's header says who wrote it, when, and that it was edited: GitHub's "commented" and the App it
 * was posted with (whose mark is already on the author's picture) go. The edit menu keeps GitHub's own words and
 * opens its edit history. Only attributes are added, so GitHub's text never flickers between two versions.
 */
export function compactDescriptionByline(enabled: boolean): void {
  if (!enabled) {
    clear();
    return;
  }
  const line = bylineLine();
  if (line === null) return;
  setFlag(line, ATTR_LINE, '');
  const kept = new Set(line.querySelectorAll(KEEP));
  for (const child of line.children) setFlag(child, ATTR_KEEP, kept.has(child) ? '' : null);
}
