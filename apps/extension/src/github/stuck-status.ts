import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from './dom';
import type { MergeConflicts } from './merge-actions';
import { reactSettled } from './react-hydration';
import { attachTooltipMessage } from './ui/tooltip';
import { ICON_MERGEABILITY_FAILURE } from './ui/icons';

/**
 * GitHub's Overview sometimes never answers its own top card: the status row stays its loading row ("Checking whether
 * “works on my machine” applies here…", skeleton picture and button) while its merge box, polled every two seconds,
 * says the pull request cannot merge for a conflict, its own or one down its stack (geld#705 and #706, Nov 2026, with
 * Geld off too). While that loading row has stood `STUCK_MS`, the conflict is drawn in its place as GitHub draws it
 * when it does answer (vercel/next.js#101859's "Merge conflicts" row), and GitHub's own row takes over the moment it
 * comes.
 */
const STUCK_MS = 5000;
const LOADING_ROW = 'section[aria-label="Recommended action"] [data-testid="for-you-item-row"][data-item-id="loading"]';
const ATTR_HIDDEN = 'data-geld-stuck-hidden';
const ROW_CLASS = 'geld-stuck-status';
const VIEW_STATUS = 'button[data-dd-action-name="pull_requests.merge.view_status"]';
/** How long Resolve conflicts waits for GitHub's merge status panel to show its own button. */
const PANEL_WAIT_MS = 6000;

let loading: { readonly row: Element; readonly since: number } | null = null;
let timer: number | null = null;
let shown: { readonly row: HTMLElement; readonly signature: string; readonly abort: AbortController } | null = null;
let latest: MergeConflicts | null = null;

/** Draws or removes the stand-in for a stuck loading row, from the merge box's `conflicts`; cheap enough for every pass. */
export function syncStuckStatus(conflicts: MergeConflicts | null): void {
  latest = conflicts;
  const row = document.querySelector(LOADING_ROW);
  if (row === null || conflicts === null || !reactSettled(row)) {
    if (row === null) loading = null;
    removeStuckStatus(row !== null);
    return;
  }
  if (loading?.row !== row) loading = { row, since: Date.now() };
  const waited = Date.now() - loading.since;
  if (waited < STUCK_MS) {
    removeStuckStatus(true);
    scheduleRecheck(STUCK_MS - waited);
    return;
  }
  show(row, conflicts);
}

/** Takes the stand-in away and shows GitHub's loading row again; `keepClock` while the same loading row still stands. */
export function removeStuckStatus(keepClock = false): void {
  if (!keepClock) {
    loading = null;
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  }
  for (const hidden of document.querySelectorAll(`[${ATTR_HIDDEN}]`)) hidden.removeAttribute(ATTR_HIDDEN);
  if (shown === null) return;
  shown.abort.abort();
  shown.row.remove();
  shown = null;
}

function scheduleRecheck(ms: number): void {
  if (timer !== null) return;
  timer = window.setTimeout(() => {
    timer = null;
    syncStuckStatus(latest);
  }, ms + 50);
}

function signatureOf(conflicts: MergeConflicts): string {
  return JSON.stringify(conflicts);
}

function show(loadingRow: Element, conflicts: MergeConflicts): void {
  const signature = signatureOf(conflicts);
  if (shown !== null && shown.signature === signature && shown.row.isConnected && shown.row.nextElementSibling === loadingRow) {
    if (!loadingRow.hasAttribute(ATTR_HIDDEN)) loadingRow.setAttribute(ATTR_HIDDEN, '');
    return;
  }
  removeStuckStatus(true);
  const abort = new AbortController();
  const row = buildRow(conflicts, loadingRow, abort.signal);
  // Beside GitHub's loading row, which stays where React put it, hidden: React replaces it when GitHub answers, and the
  // next pass, which that mutation brings before paint, takes this row away.
  loadingRow.before(row);
  loadingRow.setAttribute(ATTR_HIDDEN, '');
  shown = { row, signature, abort };
}

function buildRow(conflicts: MergeConflicts, loadingRow: Element, signal: AbortSignal): HTMLElement {
  const title = conflicts.own ? 'Merge conflicts' : 'Merge conflicts in the stack';
  const subtext = createElement('div', { class: `${ROW_CLASS}__subtext` });
  if (conflicts.own) {
    const files = conflicts.files;
    if (files.length === 0) subtext.append('Resolve the merge conflicts before this can merge.');
    else {
      // GitHub's "merge conflicts" opens a list of the files; Geld's tooltip holds the same list.
      const trigger = createElement('button', { type: 'button', class: `${ROW_CLASS}__files` }, ['merge conflicts']);
      attachTooltipMessage(trigger, `${files.length === 1 ? 'File' : 'Files'} with merge conflicts: ${files.map((file) => `\`${file}\``).join(', ')}`, signal);
      subtext.append('Resolve the ', trigger, ' before this can merge.');
    }
  } else if (conflicts.pull !== null) {
    const link = createElement('a', { class: `${ROW_CLASS}__pull`, href: conflicts.pull.path, 'data-hovercard-type': 'pull_request', 'data-hovercard-url': `${conflicts.pull.path}/hovercard` }, [`#${conflicts.pull.number}`]);
    subtext.append('Resolve the merge conflicts in ', link, ' before this can merge.');
  }
  const resolve = createElement('button', { type: 'button', class: 'btn btn-sm' }, ['Resolve conflicts']);
  resolve.addEventListener('click', () => void pressGitHubResolve(signal), { signal });
  // GitHub's own row classes, read from the loading row, keep the card's borders and spacing exactly; the grid is Geld's.
  const item = createElement('li', { class: `${loadingRow.className} ${ROW_CLASS}`.trim(), 'data-testid': 'geld-stuck-status', [OWN_UI_ATTRIBUTE]: '' }, [
    createElement('div', { class: `${ROW_CLASS}__row` }, [
      createElement('div', { class: `${ROW_CLASS}__visual` }, [createElement('span', { class: `${ROW_CLASS}__icon` }, [createElement('span', { class: `${ROW_CLASS}__glyph` }, [svgFromString(ICON_MERGEABILITY_FAILURE)])])]),
      createElement('div', { class: `${ROW_CLASS}__title` }, [title]),
      subtext,
      createElement('div', { class: `${ROW_CLASS}__actions` }, [resolve]),
    ]),
  ]);
  return item;
}

/**
 * GitHub's own Resolve conflicts, in its merge status panel: it opens the web editor, or for a stack its dialog of
 * `gh stack` commands, and says what the reader may do. The panel is opened if it is not, and its button pressed once
 * it shows; a panel that never shows its button is left open, the conflict in it. The wait ends with the row (`signal`)
 * or the pull request it was pressed on: on another pull request's panel the button would be that one's.
 */
async function pressGitHubResolve(signal: AbortSignal): Promise<void> {
  const page = pullPathOf(window.location.pathname);
  const here = (): boolean => !signal.aborted && pullPathOf(window.location.pathname) === page;
  const toggle = [...document.querySelectorAll<HTMLButtonElement>(VIEW_STATUS)].find((button) => button.getClientRects().length > 0) ?? null;
  if (panelResolveButton() === null && toggle !== null && toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
  const started = Date.now();
  while (here() && Date.now() - started < PANEL_WAIT_MS) {
    const button = panelResolveButton();
    if (button !== null) {
      button.click();
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
}

function pullPathOf(path: string): string | null {
  return /^\/[^/]+\/[^/]+\/pull\/\d+/.exec(path)?.[0] ?? null;
}

/** The merge status panel's Resolve conflicts, under its "This branch (or stack) has conflicts that must be resolved". */
function panelResolveButton(): HTMLButtonElement | null {
  for (const button of document.querySelectorAll<HTMLButtonElement>('button')) {
    if (button.closest(`.${ROW_CLASS}`) !== null || !/^\s*Resolve conflicts\s*$/.test(button.textContent ?? '')) continue;
    let box: Element | null = button.parentElement;
    for (let depth = 0; box !== null && depth < 6; depth += 1, box = box.parentElement) {
      if (/has conflicts that must be resolved/i.test(box.textContent ?? '')) return button;
    }
  }
  return null;
}
