import type { HiddenCategory } from '@geld/core';
import type { ChangeTotals } from '@geld/core';
import { formatCount, parseCount } from '@geld/core';
import type { HiddenBreakdown } from './breakdown';
import { hidesAnything } from './breakdown';
import type { StatsBreakdown } from './breakdown';
import { hiddenLabel, hiddenNounPlural, statsBreakdown } from './breakdown';
import { createElement, OWN_UI_ATTRIBUTE, originalText, parseLineStats, queryAll, restoreManagedText, setManagedText } from './dom';
import { attachBreakdownTooltip, detachBreakdownTooltip } from './ui/tooltip';

/** A "+93 −53" pair somewhere in the page header, plus the element to hang a tooltip on. */
export interface HeaderStatGroup {
  readonly host: HTMLElement;
  readonly additions: HTMLElement | null;
  readonly deletions: HTMLElement | null;
  readonly srOnly: HTMLElement | null;
  /** Elements whose text contains the total file count ("18", "18 files changed", ...). */
  readonly fileCounts: readonly HTMLElement[];
  readonly original: ChangeTotals | null;
  /** The numbers are words in a sentence (compare page) rather than a `+N −M` pair. */
  readonly sentence: boolean;
}

const FILE_COUNT_TEXT = /^\s*\(?\d[\d,]*\)?\s*$|\bfiles?\b/i;

const HEADER_HOST_SELECTOR = '#diffstat, .toc-diff-stats';
const SR_ONLY_SELECTOR = 'span.sr-only, span[class*="VisuallyHidden"]';
const LINES_CHANGED = /^\s*Lines changed:/i;

/**
 * Does `node`, just inserted, hold a header stat group? Decided as tightly as
 * `findHeaderStatGroups` would: a diffstat host, or a "Lines changed:" reader
 * sentence outside any diff entry. A streamed diff file is full of screen-
 * reader spans, and a looser test used to send every such batch through a
 * page-wide header scan, synchronously, before paint.
 */
export function holdsHeaderStats(node: Element): boolean {
  if (isInsideDiffEntry(node)) return false;
  if (node.matches(HEADER_HOST_SELECTOR) || node.querySelector(HEADER_HOST_SELECTOR) !== null) return true;
  if (node instanceof HTMLElement && node.matches(SR_ONLY_SELECTOR)) return LINES_CHANGED.test(originalText(node));
  for (const span of node.querySelectorAll<HTMLElement>(SR_ONLY_SELECTOR)) {
    if (LINES_CHANGED.test(originalText(span)) && !isInsideDiffEntry(span)) return true;
  }
  return false;
}

/** A text change inside a screen-reader span: GitHub may fill "Lines changed: …" into a span it inserted empty. */
export function isSrOnlyText(node: Node): boolean {
  const parent = node.parentElement;
  return parent !== null && parent.matches(SR_ONLY_SELECTOR) && !isInsideDiffEntry(parent);
}

function isInsideDiffEntry(element: Element): boolean {
  return (
    element.closest('[data-geld-ui]') !== null ||
    element.closest('.file, copilot-diff-entry, [data-diff-anchor], [role="region"][aria-labelledby^="heading-"]') !==
      null
  );
}

function readOriginalTotals(
  additions: HTMLElement | null,
  deletions: HTMLElement | null,
  srOnly: HTMLElement | null,
  fileCounts: readonly HTMLElement[],
): ChangeTotals | null {
  const fromSrOnly = parseLineStats(srOnly === null ? null : originalText(srOnly));
  const added = fromSrOnly?.additions ?? parseCount(additions === null ? null : originalText(additions));
  const deleted = fromSrOnly?.deletions ?? parseCount(deletions === null ? null : originalText(deletions));
  if (added === null || deleted === null) return null;
  let files = 0;
  for (const element of fileCounts) {
    const count = parseCount(originalText(element));
    if (count !== null) {
      files = count;
      break;
    }
  }
  return { files, additions: added, deletions: deleted };
}

/** A stat group assembled from elements found by a catalog diffstat surface (no file count on those). */
export function statGroupFrom(host: HTMLElement, additions: HTMLElement | null, deletions: HTMLElement | null, srOnly: HTMLElement | null): HeaderStatGroup {
  return { host, additions, deletions, srOnly, fileCounts: [], original: readOriginalTotals(additions, deletions, srOnly, []), sentence: false };
}

/** Legacy PR "Files changed" tab: `#diffstat` in the tab bar plus `#files_tab_counter`. */
function findLegacyTabnavGroup(): HeaderStatGroup | null {
  const host = document.getElementById('diffstat');
  if (host === null) return null;
  const additions = host.querySelector<HTMLElement>('.color-fg-success');
  const deletions = host.querySelector<HTMLElement>('.color-fg-danger');
  const fileCounts = [document.getElementById('files_tab_counter')].filter(
    (element): element is HTMLElement => element !== null,
  );
  return {
    host,
    additions,
    deletions,
    srOnly: null,
    fileCounts,
    original: readOriginalTotals(additions, deletions, null, fileCounts),
    sentence: false,
  };
}

/** Compare view: "Showing 18 changed files with 93 additions and 53 deletions." */
function findCompareGroup(): HeaderStatGroup | null {
  const host = document.querySelector<HTMLElement>('.toc-diff-stats');
  if (host === null) return null;
  const strongs = queryAll<HTMLElement>('strong', host);
  const additions = strongs.find((element) => /addition/i.test(originalText(element))) ?? null;
  const deletions = strongs.find((element) => /deletion/i.test(originalText(element))) ?? null;
  const fileCounts = queryAll<HTMLElement>('button.js-details-target, .js-details-target', host).filter((element) =>
    /changed files?/i.test(originalText(element)),
  );
  return {
    host,
    additions,
    deletions,
    srOnly: null,
    fileCounts,
    original: readOriginalTotals(additions, deletions, null, fileCounts),
    sentence: true,
  };
}

/**
 * React headers (PR conversation/files header and commit header) all share a
 * `span.sr-only` "Lines changed: N additions & M deletions" next to coloured
 * `+N` / `-M` spans.
 */
function findReactGroups(): HeaderStatGroup[] {
  const groups: HeaderStatGroup[] = [];
  for (const srOnly of queryAll<HTMLElement>(SR_ONLY_SELECTOR)) {
    if (!LINES_CHANGED.test(originalText(srOnly))) continue;
    if (isInsideDiffEntry(srOnly)) continue;
    const host = srOnly.parentElement;
    if (host === null) continue;
    const additions =
      host.querySelector<HTMLElement>('.fgColor-success, .color-fg-success') ??
      Array.from(host.children).find(
        (child): child is HTMLElement => child instanceof HTMLElement && /^\s*\+/.test(originalText(child)),
      ) ??
      null;
    const deletions =
      host.querySelector<HTMLElement>('.fgColor-danger, .color-fg-danger') ??
      Array.from(host.children).find(
        (child): child is HTMLElement => child instanceof HTMLElement && /^\s*[-\u2212]/.test(originalText(child)),
      ) ??
      null;
    const fileCounts = findReactFileCounts(host);
    groups.push({
      host,
      additions,
      deletions,
      srOnly,
      fileCounts,
      original: readOriginalTotals(additions, deletions, srOnly, fileCounts),
      sentence: false,
    });
  }
  return groups;
}

function findReactFileCounts(host: HTMLElement): HTMLElement[] {
  const counts: HTMLElement[] = [];
  // Commit header: sibling paragraph "18 files changed".
  const commitContainer = host.closest<HTMLElement>('[class*="commitFilesChangedContainer"]');
  if (commitContainer !== null) {
    for (const element of queryAll<HTMLElement>('p, span, h2, h3', commitContainer)) {
      if (element.contains(host) || host.contains(element)) continue;
      if (/\d[\d,]*\s+files?\s+changed/i.test(originalText(element))) counts.push(element);
    }
  }
  // PR header: the "Files changed" tab counter and its visually hidden twin.
  const filesTab = document.getElementById('prs-files-anchor-tab');
  if (filesTab !== null) {
    for (const element of queryAll<HTMLElement>('[data-component="CounterLabel"], [class*="VisuallyHidden"]', filesTab)) {
      if (FILE_COUNT_TEXT.test(originalText(element)) && parseCount(originalText(element)) !== null) counts.push(element);
    }
  }
  return counts;
}

export function findHeaderStatGroups(): HeaderStatGroup[] {
  const groups: HeaderStatGroup[] = [];
  const legacy = findLegacyTabnavGroup();
  if (legacy !== null) groups.push(legacy);
  const compare = findCompareGroup();
  if (compare !== null) groups.push(compare);
  groups.push(...findReactGroups());
  return groups;
}

/** Geld's line counts where GitHub shows none (`syncCountsStandIn`), found and rewritten like GitHub's own. */
export const ATTR_COUNTS_STAND_IN = 'data-geld-counts-stand-in';
const COUNTS_STAND_CLASS = 'geld-counts-stand';

export function isCountsStandIn(element: Element): boolean {
  return element.hasAttribute(ATTR_COUNTS_STAND_IN);
}

/** The pull request header's tab row, where GitHub floats its line counts. */
function pullTabRow(): HTMLElement | null {
  return queryAll<HTMLElement>('[data-component="PageHeader"] [class*="PageHeader-Navigation"]').find((row) => row.querySelector('#prs-files-anchor-tab') !== null) ?? null;
}

/**
 * GitHub leaves the tab bar's line counts out when there are no line changes (a change of binary files only:
 * mintlify/landing#886), rendering their wrapper empty, so the header showed no counts and no breakdown. `want` (the
 * page's diff is loaded and has no added or removed lines) puts a stand-in of GitHub's shape in that wrapper, or in a
 * wrapper of Geld's where there is none, for the header pass to rewrite as it does GitHub's. GitHub's own counts always
 * win: once a push brings line changes they render, and the stand-in goes; when a push takes them away, it comes back.
 * Not marked as Geld's UI, which the header scan skips (`isInsideDiffEntry`): it is read and rewritten as GitHub's are.
 * True when the page changed.
 */
export function syncCountsStandIn(want: boolean): boolean {
  const existing = document.querySelector<HTMLElement>(`[${ATTR_COUNTS_STAND_IN}]`);
  const row = pullTabRow();
  const real = row !== null && queryAll<HTMLElement>(SR_ONLY_SELECTOR, row).some((span) => LINES_CHANGED.test(originalText(span)) && span.closest(`[${ATTR_COUNTS_STAND_IN}]`) === null);
  if (!want || row === null || real) {
    if (existing === null) return false;
    removeCountsStandIn();
    return true;
  }
  if (existing !== null && row.contains(existing)) return false;
  removeCountsStandIn();
  let home = row.querySelector<HTMLElement>(':scope > [class*="rightContentWrapper"]');
  if (home === null) {
    home = createElement('div', { class: COUNTS_STAND_CLASS });
    row.prepend(home);
  }
  home.append(
    createElement('div', { class: 'd-flex flex-items-center gap-1', [ATTR_COUNTS_STAND_IN]: '' }, [
      createElement('span', { 'aria-hidden': 'true', class: 'f6 fgColor-success text-bold' }, ['+0']),
      createElement('span', { 'aria-hidden': 'true', class: 'f6 fgColor-danger text-bold' }, ['-0']),
      createElement('span', { class: 'sr-only' }, ['Lines changed: 0 additions & 0 deletions']),
    ]),
  );
  return true;
}

export function removeCountsStandIn(): void {
  for (const host of queryAll<HTMLElement>(`[${ATTR_COUNTS_STAND_IN}]`)) {
    detachBreakdownTooltip(host);
    host.remove();
  }
  for (const stand of queryAll<HTMLElement>(`.${COUNTS_STAND_CLASS}`)) stand.remove();
  // Its narrow-screen copy in the state row; GitHub's counts, if they took its place, make their own.
  for (const mirror of queryAll<HTMLElement>(`.${MIRROR_CLASS}`)) {
    detachBreakdownTooltip(mirror);
    mirror.remove();
  }
}

const COUNT_NOUNS = /\b(files?|additions?|deletions?|changes?|lines?)\b/i;

/**
 * Replace the first number in `text` and fix singular/plural agreement for the
 * noun that follows it ("1 file changed", "2 additions", ...).
 */
export function replaceCount(text: string, count: number): string {
  const replaced = text.replace(/\d[\d,]*/, formatCount(count));
  return replaced.replace(COUNT_NOUNS, (word) => {
    const singular = word.endsWith('s') ? word.slice(0, -1) : word;
    return count === 1 ? singular : `${singular}s`;
  });
}

function signPrefix(text: string): string {
  const match = /^\s*([^\d\s]*)/.exec(text);
  return match?.[1] ?? '';
}

/**
 * Rewrite a header number while preserving how GitHub formatted it: bare
 * signed numbers ("+93", "−53", "18") keep their sign, sentences ("93 additions",
 * "18 files changed") keep their words.
 */
function rewriteNumber(original: string, value: number, fallbackSign: string): string {
  if (/^\s*[+\-\u2212]?\s*\d[\d,]*\s*$/.test(original)) {
    return `${signPrefix(original) || fallbackSign}${formatCount(value)}`;
  }
  return replaceCount(original, value);
}

export const TESTS_COUNT_CLASS = 'geld-tests-count';

/**
 * "N tests" label placed to the left of the +/− counts. Always present (even
 * "0 tests") so it is obvious the numbers have been checked; underlined only
 * when there is a breakdown to show on hover.
 */
function renderTestsLabel(group: HeaderStatGroup, text: string, count: number): HTMLElement {
  let label = group.host.querySelector<HTMLElement>(`.${TESTS_COUNT_CLASS}`);
  // The first count GitHub renders. A deletions-only change has no "+N" span
  // at all (not "+0"), so the "−M" span is the neighbour then.
  const neighbour = group.additions ?? group.deletions;
  if (label === null) {
    label = document.createElement('span');
    label.className = TESTS_COUNT_CLASS;
    label.setAttribute('data-geld-ui', '');
    if (neighbour !== null) {
      neighbour.insertAdjacentElement('beforebegin', label);
      // GitHub separates "+N" and "−M" with either a flex gap or a literal
      // space; a space after the label reproduces whichever is in use.
      if (!group.sentence) label.after(document.createTextNode(' '));
    } else {
      group.host.prepend(label);
    }
  }
  if (neighbour !== null && label.style.font === '') {
    // Match the neighbouring count exactly (GitHub styles those spans directly).
    // Once, when the label is made: reading a computed style forces a style
    // recalculation of whatever the page has dirtied, and this runs on every
    // pass while a diff streams in.
    const reference = getComputedStyle(neighbour);
    label.style.font = reference.font;
    label.style.letterSpacing = reference.letterSpacing;
  }
  // Inside a sentence ("… with 2 tests, 42 additions and 26 deletions.") we need a comma.
  const rendered = group.sentence ? `${text}, ` : text;
  if (label.textContent !== rendered) label.textContent = rendered;
  label.toggleAttribute('data-has-tests', count > 0);
  return label;
}

/** Rewrite one header group so it shows totals without the hidden files. */
export function applyHeaderStats(
  group: HeaderStatGroup,
  hidden: HiddenBreakdown,
  activeCategories: readonly HiddenCategory[],
  /** The diff's file count, when the header's own numbers carry none (a pull request header: lines only). */
  files = 0,
): void {
  // Nothing that could be hidden: GitHub's own numbers are right, so leave the header alone (no "0 hidden").
  if (group.original === null || activeCategories.length === 0) {
    restoreHeaderStats(group);
    return;
  }
  const nounPlural = hiddenNounPlural(activeCategories, hidden);
  const tooltipAnchor = renderTestsLabel(group, hiddenLabel(hidden, activeCategories), hidden.totals.files);
  const all = group.original.files === 0 && files > 0 ? { ...group.original, files } : group.original;
  if (!hidesAnything(hidden)) {
    // GitHub's numbers stand, and the breakdown is still there to read (the files and their counts) unless there is
    // nothing at all: a change of binary files only reads "+0 −0" over a file that changed (mintlify/landing#886).
    const changed = all.files > 0 || all.additions > 0 || all.deletions > 0;
    const whole = changed ? statsBreakdown(all, hidden, nounPlural, activeCategories) : null;
    restoreNumbers(group, whole !== null);
    if (whole !== null) attachBreakdownTooltip(group.host, tooltipAnchor, () => whole, { align: 'end', flush: true });
    syncNarrowMirror(group, hiddenLabel(hidden, activeCategories), false, group.original, whole === null ? null : () => whole);
    return;
  }
  const breakdown = statsBreakdown(all, hidden, nounPlural, activeCategories);
  const { visible } = breakdown;

  if (group.additions !== null) {
    setManagedText(group.additions, rewriteNumber(originalText(group.additions), visible.additions, '+'));
  }
  if (group.deletions !== null) {
    setManagedText(group.deletions, rewriteNumber(originalText(group.deletions), visible.deletions, '\u2212'));
  }
  if (group.srOnly !== null) {
    setManagedText(
      group.srOnly,
      `Lines changed excluding ${nounPlural}: ${formatCount(visible.additions)} additions & ${formatCount(
        visible.deletions,
      )} deletions (${formatCount(all.additions)} & ${formatCount(all.deletions)} including ${nounPlural})`,
    );
  }
  for (const element of group.fileCounts) {
    setManagedText(element, rewriteNumber(originalText(element), visible.files, ''));
    if (element.hasAttribute('title')) {
      if (!element.hasAttribute('data-geld-original-title')) {
        element.setAttribute('data-geld-original-title', element.getAttribute('title') ?? '');
      }
      element.setAttribute('title', formatCount(visible.files));
    }
  }

  // The header's counts end the line at the page column's edge, right above the tab bar: the box hangs flush with
  // that edge and from that bar (its top border on the bar's, top corners square), as a drawer out of the header.
  attachBreakdownTooltip(group.host, tooltipAnchor, () => breakdown, { align: 'end', flush: true });
  syncNarrowMirror(group, hiddenLabel(hidden, activeCategories), hidden.totals.files > 0, visible, () => breakdown);
}

const MIRROR_CLASS = 'geld-header-mirror';

/**
 * GitHub drops the header diffstat on narrow screens (its wrapper is
 * `hideWhenVeryNarrowContainer`), and the tab bar has no room for it. A copy
 * of the counts then goes beside the state label ("Open"), after the stack
 * button when there is one, and is shown exactly while the original is not
 * (checked on every apply; the controller re-applies on resize).
 */
function syncNarrowMirror(group: HeaderStatGroup, label: string, hasTests: boolean, visible: ChangeTotals, provider: (() => StatsBreakdown) | null): void {
  const header = group.host.closest<HTMLElement>('[data-component="PageHeader"]');
  const stateRow = header?.querySelector<HTMLElement>('[data-component="StateLabel"]')?.parentElement ?? null;
  if (stateRow === null || stateRow.contains(group.host)) return;
  let mirror = stateRow.querySelector<HTMLElement>(`.${MIRROR_CLASS}`);
  if (mirror === null) {
    mirror = createElement('span', { class: MIRROR_CLASS, [OWN_UI_ATTRIBUTE]: '' }, [
      createElement('span', { class: `${MIRROR_CLASS}__tests ${TESTS_COUNT_CLASS}` }),
      createElement('span', { class: `${MIRROR_CLASS}__add` }),
      createElement('span', { class: `${MIRROR_CLASS}__del` }),
    ]);
    stateRow.append(mirror);
  } else if (stateRow.lastElementChild !== mirror) {
    stateRow.append(mirror);
  }
  const [tests, add, del] = mirror.children;
  if (tests instanceof HTMLElement) {
    if (tests.textContent !== label) tests.textContent = label;
    tests.toggleAttribute('data-has-tests', hasTests);
  }
  const addText = `+${formatCount(visible.additions)}`;
  const delText = `\u2212${formatCount(visible.deletions)}`;
  if (add instanceof HTMLElement && add.textContent !== addText) add.textContent = addText;
  if (del instanceof HTMLElement && del.textContent !== delText) del.textContent = delText;
  mirror.hidden = group.host.getClientRects().length > 0;
  if (provider === null) detachBreakdownTooltip(mirror);
  else attachBreakdownTooltip(mirror, tests instanceof HTMLElement ? tests : mirror, provider, { align: 'end' });
}

function removeNarrowMirror(group: HeaderStatGroup): void {
  const header = group.host.closest<HTMLElement>('[data-component="PageHeader"]');
  for (const mirror of header?.querySelectorAll<HTMLElement>(`.${MIRROR_CLASS}`) ?? []) {
    detachBreakdownTooltip(mirror);
    mirror.remove();
  }
}

export function restoreHeaderStats(group: HeaderStatGroup): void {
  removeNarrowMirror(group);
  restoreNumbers(group);
  for (const label of group.host.querySelectorAll(`.${TESTS_COUNT_CLASS}`)) {
    const spacer = label.nextSibling;
    if (spacer !== null && spacer.nodeType === Node.TEXT_NODE && (spacer.nodeValue ?? '').trim() === '') {
      spacer.remove();
    }
    label.remove();
  }
}

/** Put GitHub's original numbers back and drop the tooltip, keeping the label. */
function restoreNumbers(group: HeaderStatGroup, keepTooltip = false): void {
  for (const element of [group.additions, group.deletions, group.srOnly, ...group.fileCounts]) {
    if (element === null) continue;
    restoreManagedText(element);
    const title = element.getAttribute('data-geld-original-title');
    if (title !== null) {
      element.setAttribute('title', title);
      element.removeAttribute('data-geld-original-title');
    }
  }
  // Detaching forgets the host while its listeners stay bound, so a tooltip about to be attached again stays attached.
  if (!keepTooltip) detachBreakdownTooltip(group.host);
}
