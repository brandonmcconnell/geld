import { isOwnElement } from './dom';

/**
 * Where on the page a mutation batch landed, so a pass can redo only the
 * part that changed. Measured on github.com (Oct 2026): a third of all
 * batches are the document head (the title changes with every notification
 * count), and most of the rest outside the page's content are the global
 * navigation, the footer and Primer's tooltips, none of which Geld reads.
 *
 * - `chrome`: head, global navigation, footer, tooltips. Nothing of Geld's
 *   lives there; a batch of only these schedules nothing at all.
 * - `lists`: PR rows, hovercards, popovers and the portal root (menus, the
 *   stack popover, dialogs land there).
 * - `conversation`: the timeline, the merge box, the sidebar.
 * - `files`: the diff list, the file tree, the files toolbar.
 * - `header`: the page header and its tabs (the diffstat lives there).
 * - `unknown`: anything else, which gets the full pass as before.
 *
 * Order matters: the timeline is checked before the files containers so a
 * review thread's diff inside it counts as conversation, not files.
 */
export type Region = 'chrome' | 'lists' | 'conversation' | 'files' | 'header' | 'unknown';

const CHROME = 'head, title, .header-wrapper, header.AppHeader, header.GlobalNav, footer, [class*="TooltipV2"], tool-tip';
const LISTS =
  '.js-issue-row, li[id*="-list-view-node-"], [role="listitem"], [class*="ListView"], .js-navigation-container, .js-hovercard-content, [class*="StackState"], [class*="StackList"], .Popover, #__primerPortalRoot__, [data-portal-root]';
const CONVERSATION =
  '.js-discussion, [data-testid="issue-timeline-container"], [data-testid="pull-request-timeline"], .pull-discussion-timeline, #discussion_bucket, [data-testid="issue-viewer-container"], [data-testid="issue-body"], [data-testid="mergebox-border-container"], react-partial[partial-name*="merge" i], [data-testid="mergebox-partial"], #partial-pull-merging, .pull-merging, .js-pull-merging, .mergeability-details, .merge-pr, .js-merge-pr, #partial-discussion-sidebar, [data-testid="issue-viewer-metadata-pane"], .Layout-sidebar, .js-socket-channel';
const FILES =
  '#files, #diff_file_tree, file-tree, [data-testid="virtualized-diffs-list"], [class*="PullRequestDiffsList"], [class*="DiffFileTree"], [class*="TreeView"], [role="tree"], .js-diff-progressive-container, #toc, .pr-toolbar, [class*="FilesToolbar"], copilot-diff-entry, .diff-view, [data-geld-sidebar]';
const HEADER = '.gh-header, [data-component="PageHeader"], #partial-discussion-header, .tabnav, .UnderlineNav, #diffstat, .toc-diff-stats, [class*="PullRequestHeader"], [class*="PullRequestTabs"], .pagehead';

/** Batches larger than this are page loads or navigations; they get the full pass without a look. */
const MAX_CLASSIFIED = 300;

function regionOf(node: Node): Region {
  const element = node instanceof Element ? node : node.parentElement;
  if (element === null || element === document.documentElement) return element === null ? 'unknown' : 'chrome';
  if (element.closest(CHROME) !== null) return 'chrome';
  if (element.closest(LISTS) !== null) return 'lists';
  if (element.closest(CONVERSATION) !== null) return 'conversation';
  if (element.closest(FILES) !== null) return 'files';
  if (element.closest(HEADER) !== null) return 'header';
  return 'unknown';
}

/**
 * The regions a batch touched (Geld's own elements aside). Stops at the
 * first `unknown`: the full pass follows anyway.
 */
export function regionsOf(records: readonly MutationRecord[]): ReadonlySet<Region> {
  const regions = new Set<Region>();
  if (records.length > MAX_CLASSIFIED) return regions.add('unknown');
  const seen = new Set<Node>();
  for (const record of records) {
    if (seen.has(record.target)) continue;
    seen.add(record.target);
    if (isOwnElement(record.target)) continue;
    const region = regionOf(record.target);
    regions.add(region);
    if (region === 'unknown') break;
  }
  return regions;
}

/** Whether `scope` lies entirely within `regions` (an empty scope does not). */
export function scopeWithin(scope: ReadonlySet<Region>, regions: readonly Region[]): boolean {
  if (scope.size === 0) return false;
  for (const region of scope) if (!regions.includes(region)) return false;
  return true;
}
