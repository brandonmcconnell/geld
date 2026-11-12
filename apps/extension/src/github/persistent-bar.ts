/**
 * GitHub's bar over every tab of the new pull request page (Overview, Commits, Checks, Files changed; Nov 2026), always
 * shown: the number and title, then its actions ("Merge status", GitHub's review button, the panel toggles).
 */
const PERSISTENT_BAR = '[data-testid="diff-comparison-viewer-sticky-header-slot"][class*="Persistent"]';
export const PERSISTENT_BAR_INNER = `${PERSISTENT_BAR} [data-testid="diff-comparison-viewer-sticky-header-bar"] [class*="miniHeaderInner"]`;
const PERSISTENT_BAR_ACTIONS = `${PERSISTENT_BAR_INNER} > [class*="actions"]`;
/** What GitHub adds to the bar once the page header's tabs have scrolled under it, and takes away when they come back. */
const STUCK_MARK = `${PERSISTENT_BAR} [data-testid="mini-header-tab-switcher-trigger"]`;

export function persistentBarActions(): HTMLElement | null {
  return document.querySelector<HTMLElement>(PERSISTENT_BAR_ACTIONS);
}

/**
 * Whether the bar stands for the page header: GitHub's own React render adds its tab switcher (and the status label)
 * when the tabs leave the viewport, so a mutation callback reading this moves Geld's counts and review group in the
 * very frame GitHub's own parts move.
 */
export function persistentBarStuck(): boolean {
  return document.querySelector(STUCK_MARK) !== null;
}

/**
 * The new pull request page's header: GitHub writes the line counts after the branch names (its skeleton, then
 * `diffStat`) and leaves the tab row's counts wrapper empty. Geld hides those and stands its own in the tab row.
 */
export function newHeaderBranchGroup(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-component="PageHeader"] [class*="branchGroup"]:has(> [class*="branches"])');
}
