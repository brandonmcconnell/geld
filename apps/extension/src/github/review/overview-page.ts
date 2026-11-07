/**
 * GitHub's Overview tab (Nov 2026), the React page that replaces the
 * conversation for readers in its preview: a "For you" status strip, the
 * description in a box of its own, a Comments section (issue comments,
 * reviews with their threads, commit rows, newest first by default) and a
 * sidebar. The timeline's other events live in a side panel that is not in
 * the page until opened. Everything here reads that page; nothing on the
 * classic conversation matches it, so each helper answers null there.
 */

export const OVERVIEW_DESCRIPTION = 'section[aria-label="Description"]';
export const OVERVIEW_FOR_YOU = '[class*="CondensedForYouContainer"]';
/** One entry of the Comments section: a comment, a review with its threads, or a run of commits. */
export const OVERVIEW_ITEM = '[data-testid="timeline-item"]';
/** A review thread's own box inside its review (an `article` without an id, the review's being `pullrequestreview-N`). */
export const OVERVIEW_THREAD_FRAME = 'article:not([id])';
const COMMENTS_HEADING = 'h2#overview-comments';

export function overviewDescription(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(OVERVIEW_DESCRIPTION);
}

export function isOverviewPage(root: ParentNode = document): boolean {
  return overviewDescription(root) !== null;
}

/**
 * The gap the Overview's column leaves between its boxes, for a box of Geld's to take back so it grows out of the
 * description's edge as on the conversation; null off the Overview.
 */
export function overviewColumnGap(box: Element): string | null {
  if (!box.matches(OVERVIEW_DESCRIPTION) || box.parentElement === null) return null;
  const gap = getComputedStyle(box.parentElement).rowGap;
  return /^\d/.test(gap) ? gap : null;
}

/** The Comments section: its heading row, the list of entries and, signed in, the composer. */
export function overviewCommentsSection(root: ParentNode = document): HTMLElement | null {
  return root.querySelector(COMMENTS_HEADING)?.closest<HTMLElement>('section') ?? null;
}

/** The section's heading row (heading, view switch, filter and sort), which folds with the entries. */
export function overviewCommentsControls(section: HTMLElement): HTMLElement | null {
  const heading = section.querySelector(COMMENTS_HEADING);
  let row: Element | null = heading;
  while (row !== null && row.parentElement !== section) row = row.parentElement;
  return row instanceof HTMLElement ? row : null;
}

/**
 * Whether the Comments section shows one of its narrower views ("Unresolved", which lists open threads alone, or
 * "Mine") rather than everything ("All", its first segment). The For you strip's comments card leads there
 * (`?comments:mode=thread-previews`), so a reader who follows it asked to see that list.
 */
export function overviewCommentsFiltered(root: ParentNode = document): boolean {
  const first = allCommentsButton(root);
  return first !== null && first.getAttribute('aria-pressed') !== 'true';
}

function allCommentsButton(root: ParentNode): HTMLElement | null {
  return overviewCommentsSection(root)?.querySelector<HTMLElement>('ul[aria-label="Comments view mode"] li button[aria-pressed]') ?? null;
}

const ALL_PRESS_GAP_MS = 2000;
let allPressedAt = Number.NEGATIVE_INFINITY;

/**
 * Presses the Comments section's "All" when a narrower view is chosen, since the digest folds the view switch away
 * and only All has the composer: left on Unresolved or Mine the reader had no comment box and no way back to one.
 * Answers whether it pressed, at most once per `ALL_PRESS_GAP_MS` so a view GitHub does not switch is not pressed every pass.
 */
export function showAllOverviewComments(root: ParentNode = document, now = Date.now()): boolean {
  const all = allCommentsButton(root);
  if (all === null || all.getAttribute('aria-pressed') === 'true' || now - allPressedAt < ALL_PRESS_GAP_MS) return false;
  allPressedAt = now;
  all.click();
  return true;
}

const newestFirst = new WeakMap<Element, { readonly icon: Element; readonly descending: boolean }>();

/**
 * Whether the Comments section lists its entries newest first, as it does by
 * default ("Sort comments: Newest", the `sort-desc` octicon on its sort button;
 * the reader may pick oldest first or code order, which is kept in their
 * browser). Read from the button's glyph and remembered per section until the
 * glyph changes, since timeline order is asked for in every comparison of a sort.
 */
export function overviewNewestFirst(section: Element): boolean {
  const known = newestFirst.get(section);
  if (known !== undefined && known.icon.isConnected && section.contains(known.icon)) return known.descending;
  const icon = section.querySelector('svg.octicon-sort-desc, svg.octicon-sort-asc, svg.octicon-list-unordered');
  if (icon === null) return false;
  const descending = icon.classList.contains('octicon-sort-desc');
  newestFirst.set(section, { icon, descending });
  return descending;
}

/**
 * The resolved threads a review shows collapsed to their header ("Resolved",
 * the file and line, who resolved it), their comments in the page only once
 * opened: GitHub's own disclosure, pressed once each so the digest can read
 * them, as the classic page's minimized reviews are fetched. Only while the
 * timeline is folded, where nobody sees them open.
 */
export function openCollapsedThreads(root: ParentNode = document): number {
  let opened = 0;
  for (const button of root.querySelectorAll<HTMLButtonElement>(`${OVERVIEW_ITEM} button[aria-label^="Open review comment"]`)) {
    if (pressed.has(button)) continue;
    pressed.add(button);
    button.click();
    opened += 1;
  }
  return opened;
}

const pressed = new WeakSet<Element>();
