import type { HiddenCategory } from '@geld/core';
import type { ChangeTotals } from '@geld/core';
import { formatCount, parseCount } from '@geld/core';
import type { HiddenBreakdown } from './breakdown';
import { hidesAnything } from './breakdown';
import { hiddenLabel, hiddenNounPlural, statsBreakdown } from './breakdown';
import { originalText, parseLineStats, queryAll, restoreManagedText, setManagedText } from './dom';
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
  for (const srOnly of queryAll<HTMLElement>('span.sr-only, span[class*="VisuallyHidden"]')) {
    if (!/^\s*Lines changed:/i.test(originalText(srOnly))) continue;
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
function renderTestsLabel(group: HeaderStatGroup, text: string, count: number): void {
  let label = group.host.querySelector<HTMLElement>(`.${TESTS_COUNT_CLASS}`);
  if (label === null) {
    label = document.createElement('span');
    label.className = TESTS_COUNT_CLASS;
    label.setAttribute('data-geld-ui', '');
    if (group.additions !== null) {
      group.additions.insertAdjacentElement('beforebegin', label);
      // GitHub separates "+N" and "−M" with either a flex gap or a literal
      // space; a space after the label reproduces whichever is in use.
      if (!group.sentence) label.after(document.createTextNode(' '));
    } else {
      group.host.prepend(label);
    }
  }
  if (group.additions !== null) {
    // Match the neighbouring count exactly (GitHub styles those spans directly).
    const reference = getComputedStyle(group.additions);
    label.style.font = reference.font;
    label.style.letterSpacing = reference.letterSpacing;
  }
  // Inside a sentence ("… with 2 tests, 42 additions and 26 deletions.") we need a comma.
  const rendered = group.sentence ? `${text}, ` : text;
  if (label.textContent !== rendered) label.textContent = rendered;
  label.toggleAttribute('data-has-tests', count > 0);
}

/** Rewrite one header group so it shows totals without the hidden files. */
export function applyHeaderStats(
  group: HeaderStatGroup,
  hidden: HiddenBreakdown,
  activeCategories: readonly HiddenCategory[],
): void {
  // Nothing that could be hidden: GitHub's own numbers are right, so leave the header alone (no "0 hidden").
  if (group.original === null || activeCategories.length === 0) {
    restoreHeaderStats(group);
    return;
  }
  const nounPlural = hiddenNounPlural(activeCategories, hidden);
  renderTestsLabel(group, hiddenLabel(hidden, activeCategories), hidden.totals.files);
  if (!hidesAnything(hidden)) {
    restoreNumbers(group);
    return;
  }
  const all = group.original;
  const breakdown = statsBreakdown(all, hidden, nounPlural);
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

  attachBreakdownTooltip(group.host, () => breakdown);
}

export function restoreHeaderStats(group: HeaderStatGroup): void {
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
function restoreNumbers(group: HeaderStatGroup): void {
  for (const element of [group.additions, group.deletions, group.srOnly, ...group.fileCounts]) {
    if (element === null) continue;
    restoreManagedText(element);
    const title = element.getAttribute('data-geld-original-title');
    if (title !== null) {
      element.setAttribute('title', title);
      element.removeAttribute('data-geld-original-title');
    }
  }
  detachBreakdownTooltip(group.host);
}
