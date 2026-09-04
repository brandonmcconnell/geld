import type { FileStats } from '../lib/diff-parse';
import type { ChangeTotals } from '../lib/format';
import { addTotals, EMPTY_TOTALS } from '../lib/format';
import type { HiddenCategory, PathMatcher } from '../lib/matcher';
import { createMatcher, TESTS_CATEGORY } from '../lib/matcher';
import type { GeldSettings } from '../lib/settings';
import { DiffSource } from './diff-source';
import { isOwnElement, queryAll, restoreManagedText } from './dom';
import { applyHeaderStats, findHeaderStatGroups, restoreHeaderStats } from './header-stats';
import type { DiffEntry, DiffView } from './model';
import { describePage } from './page';
import { removeHiddenSection, renderHiddenSection } from './ui/hidden-section';
import { detachBreakdownTooltip, removeTooltipElement } from './ui/tooltip';
import { removeTreeSection, renderTreeSection } from './ui/tree-section';
import { legacyAdapter } from './views/legacy';
import { reactAdapter } from './views/react';

const ATTR_CONTAINER = 'data-geld-container';
const ATTR_EXPANDED = 'data-geld-expanded';
const ATTR_ENTRY = 'data-geld';
const ATTR_TREE = 'data-geld-tree';
const ATTR_TOC = 'data-geld-toc-hidden';
const ATTR_FLASH = 'data-geld-flash';

const APPLY_DEBOUNCE_MS = 60;
/** How many progressive-load rounds we nudge before giving up on a reveal. */
const MAX_REVEAL_ATTEMPTS = 40;

interface PendingReveal {
  readonly path: string;
  readonly stateKey: string;
  attempts: number;
}

interface HiddenTotals {
  readonly totals: ChangeTotals;
  readonly incomplete: boolean;
}

function sumEntries(entries: readonly DiffEntry[]): HiddenTotals {
  let totals: ChangeTotals = EMPTY_TOTALS;
  let incomplete = false;
  for (const entry of entries) {
    if (entry.stats === null) incomplete = true;
    totals = addTotals(totals, {
      files: 1,
      additions: entry.stats?.additions ?? 0,
      deletions: entry.stats?.deletions ?? 0,
    });
  }
  return { totals, incomplete };
}

function sumFileStats(files: readonly FileStats[], matcher: PathMatcher): ChangeTotals {
  let totals: ChangeTotals = EMPTY_TOTALS;
  for (const file of files) {
    if (matcher.categorize(file.path) === null) continue;
    totals = addTotals(totals, { files: 1, additions: file.additions, deletions: file.deletions });
  }
  return totals;
}

/**
 * Owns the lifecycle of Geld on a GitHub tab: watches the DOM, classifies
 * diff entries, hides the ones that are tests and keeps the header counts and
 * side panels in sync. Every operation is idempotent so it can run after any
 * DOM mutation without accumulating state in the page.
 */
export class GeldController {
  private settings: GeldSettings;
  private matcher: PathMatcher;
  private readonly category: HiddenCategory = TESTS_CATEGORY;
  private observer: MutationObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly diffExpanded = new Map<string, boolean>();
  private readonly treeExpanded = new Map<string, boolean>();
  private readonly diffSource = new DiffSource(() => this.schedule());
  private currentView: DiffView | null = null;
  private pendingReveal: PendingReveal | null = null;
  private stopped = false;

  constructor(settings: GeldSettings) {
    this.settings = settings;
    this.matcher = createMatcher(settings);
  }

  start(): void {
    this.stopped = false;
    this.observer = new MutationObserver((records) => {
      if (records.every((record) => isOwnElement(record.target))) return;
      this.schedule();
    });
    this.observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    this.apply();
  }

  stop(): void {
    this.stopped = true;
    this.observer?.disconnect();
    this.observer = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.teardown();
  }

  updateSettings(settings: GeldSettings): void {
    this.settings = settings;
    this.matcher = createMatcher(settings);
    // Per-page toggles were made against the old defaults; start fresh.
    this.diffExpanded.clear();
    this.pendingReveal = null;
    this.teardown();
    this.apply();
  }

  /** Re-evaluate the page soon (debounced). Safe to call from anywhere. */
  requestRefresh(): void {
    this.schedule();
  }

  private schedule(): void {
    if (this.stopped || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.apply();
    }, APPLY_DEBOUNCE_MS);
  }

  private isDiffExpanded(key: string): boolean {
    return this.diffExpanded.get(key) ?? this.settings.expandedByDefault;
  }

  private setDiffExpanded(key: string, expanded: boolean): void {
    this.diffExpanded.set(key, expanded);
    this.apply();
  }

  private apply(): void {
    if (this.stopped) return;
    if (!this.settings.enabled) {
      this.teardown();
      return;
    }

    const page = describePage(new URL(window.location.href));
    const view = legacyAdapter.read() ?? reactAdapter.read();
    this.currentView = view;

    let hidden: HiddenTotals | null = null;
    let renderedEntryCount = 0;

    if (view !== null) {
      renderedEntryCount = view.entries.length;
      hidden = this.applyView(view, page.stateKey);
      this.continuePendingReveal(view, page.stateKey);
    } else {
      this.teardownView();
    }

    // Header totals. Prefer the DOM when every file is rendered; otherwise fall
    // back to the raw diff so large or diff-less pages (conversation tab) are
    // still accurate.
    const groups = findHeaderStatGroups();
    const headerFileCount = groups.map((group) => group.original?.files ?? 0).reduce((a, b) => Math.max(a, b), 0);
    const domIsComplete = view !== null && (headerFileCount === 0 || renderedEntryCount >= headerFileCount);

    let headerHidden: ChangeTotals | null = domIsComplete ? hidden?.totals ?? EMPTY_TOTALS : null;
    if (headerHidden === null && page.diffUrl !== null && groups.length > 0) {
      const state = this.diffSource.request(page.diffUrl);
      if (state.status === 'ready') headerHidden = sumFileStats(state.files, this.matcher);
      else if (state.status === 'failed' && hidden !== null) headerHidden = hidden.totals;
    }

    if (headerHidden !== null) {
      for (const group of groups) applyHeaderStats(group, headerHidden, this.category.nounPlural);
    }

    this.observer?.takeRecords();
  }

  private applyView(view: DiffView, stateKey: string): HiddenTotals {
    const hiddenEntries: DiffEntry[] = [];
    const hiddenPaths = new Set<string>();
    const hiddenAnchors = new Set<string>();
    for (const entry of view.entries) {
      const isHidden = this.matcher.categorize(entry.path) !== null;
      entry.root.setAttribute(ATTR_ENTRY, isHidden ? 'hidden' : 'visible');
      if (!isHidden) continue;
      hiddenEntries.push(entry);
      hiddenPaths.add(entry.path);
      if (entry.anchor !== null) hiddenAnchors.add(entry.anchor);
    }

    const expanded = this.isDiffExpanded(stateKey);
    const hidden = sumEntries(hiddenEntries);

    if (hiddenEntries.length === 0) {
      // Nothing to hide: leave GitHub's layout completely untouched.
      view.container.removeAttribute(ATTR_CONTAINER);
      view.container.removeAttribute(ATTR_EXPANDED);
      for (const entry of view.entries) entry.root.removeAttribute(ATTR_ENTRY);
    } else {
      view.container.setAttribute(ATTR_CONTAINER, view.kind);
      view.container.toggleAttribute(ATTR_EXPANDED, expanded);
    }

    if (hiddenEntries.length > 0) {
      renderHiddenSection(
        view.container,
        {
          category: this.category,
          totals: hidden.totals,
          expanded,
          statsIncomplete: hidden.incomplete,
        },
        () => this.setDiffExpanded(stateKey, !this.isDiffExpanded(stateKey)),
      );
    } else {
      removeHiddenSection(view.container);
    }

    for (const [anchor, item] of view.tocItems) {
      item.toggleAttribute(ATTR_TOC, hiddenAnchors.has(anchor));
    }

    this.applyTree(view, stateKey);
    return hidden;
  }

  private applyTree(view: DiffView, stateKey: string): void {
    if (view.treeRoot === null) return;

    const entryPaths = new Set(view.entries.map((entry) => entry.path));
    const hiddenFiles: Array<{ path: string; available: boolean }> = [];
    for (const file of view.treeFiles) {
      const isHidden = this.matcher.categorize(file.path) !== null;
      file.element.setAttribute(ATTR_TREE, isHidden ? 'hidden' : 'visible');
      if (isHidden) hiddenFiles.push({ path: file.path, available: entryPaths.has(file.path) });
    }

    // Directories whose every file is hidden collapse away too. Process deepest
    // first so nested directories are evaluated before their parents.
    const directories = [...view.treeDirectories].sort(
      (a, b) => Number(b.getAttribute('aria-level') ?? 0) - Number(a.getAttribute('aria-level') ?? 0),
    );
    for (const directory of directories) {
      const hasVisible = directory.querySelector(`[${ATTR_TREE}="visible"]`) !== null;
      const hasHidden = directory.querySelector(`[${ATTR_TREE}="hidden"]`) !== null;
      directory.setAttribute(ATTR_TREE, !hasVisible && hasHidden ? 'hidden' : 'visible');
    }

    if (hiddenFiles.length === 0) {
      removeTreeSection(view.treeRoot.parentElement ?? document);
      return;
    }
    renderTreeSection(
      view.treeRoot,
      {
        category: this.category,
        files: hiddenFiles,
        expanded: this.treeExpanded.get(stateKey) ?? false,
      },
      () => {
        this.treeExpanded.set(stateKey, !(this.treeExpanded.get(stateKey) ?? false));
        this.apply();
      },
      (path) => this.reveal(path, stateKey),
    );
  }

  /** Expand the hidden section and scroll a specific hidden file into view. */
  private reveal(path: string, stateKey: string): void {
    const view = this.currentView;
    if (view === null) return;
    if (!this.isDiffExpanded(stateKey)) this.setDiffExpanded(stateKey, true);

    const entry = view.entries.find((candidate) => candidate.path === path);
    if (entry === undefined) {
      // Not rendered yet (GitHub loads big diffs progressively). Remember the
      // request and nudge the lazy loader by scrolling to the end of the list.
      this.pendingReveal = { path, stateKey, attempts: 0 };
      this.nudgeProgressiveLoading(view);
      return;
    }
    this.pendingReveal = null;
    view.expandEntry(entry);

    requestAnimationFrame(() => {
      entry.root.scrollIntoView({ block: 'start', behavior: 'instant' });
      entry.root.setAttribute(ATTR_FLASH, '');
      setTimeout(() => entry.root.removeAttribute(ATTR_FLASH), 1600);
      if (entry.anchor !== null) history.replaceState(history.state, '', `#${entry.anchor}`);
      this.keepAligned(entry.root);
    });
  }

  /**
   * Diff bodies above the target load lazily as we scroll past them, pushing
   * the target down after we aligned it. Re-align a few times while that
   * settles, but stop as soon as the user scrolls on their own.
   */
  private keepAligned(target: HTMLElement): void {
    const scrollMargin = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    const deadline = performance.now() + 2500;
    let userScrolled = false;
    const stop = (): void => {
      userScrolled = true;
    };
    const options: AddEventListenerOptions = { passive: true, once: true };
    window.addEventListener('wheel', stop, options);
    window.addEventListener('touchstart', stop, options);
    window.addEventListener('keydown', stop, options);

    const check = (): void => {
      if (userScrolled || performance.now() > deadline || !target.isConnected) {
        window.removeEventListener('wheel', stop);
        window.removeEventListener('touchstart', stop);
        window.removeEventListener('keydown', stop);
        return;
      }
      const drift = target.getBoundingClientRect().top - scrollMargin;
      if (Math.abs(drift) > 4) target.scrollIntoView({ block: 'start', behavior: 'instant' });
      setTimeout(check, 150);
    };
    setTimeout(check, 150);
  }

  private nudgeProgressiveLoading(view: DiffView): void {
    const last = view.container.lastElementChild;
    (last ?? view.container).scrollIntoView({ block: 'end', behavior: 'instant' });
  }

  /** Called after every apply: finish a reveal once its diff has been rendered. */
  private continuePendingReveal(view: DiffView, stateKey: string): void {
    const pending = this.pendingReveal;
    if (pending === null) return;
    if (pending.stateKey !== stateKey || pending.attempts >= MAX_REVEAL_ATTEMPTS) {
      this.pendingReveal = null;
      return;
    }
    if (view.entries.some((entry) => entry.path === pending.path)) {
      this.reveal(pending.path, stateKey);
      return;
    }
    pending.attempts += 1;
    this.nudgeProgressiveLoading(view);
  }

  private teardownView(): void {
    for (const element of queryAll(`[${ATTR_CONTAINER}]`)) {
      element.removeAttribute(ATTR_CONTAINER);
      element.removeAttribute(ATTR_EXPANDED);
    }
    for (const attribute of [ATTR_ENTRY, ATTR_TREE, ATTR_TOC, ATTR_FLASH]) {
      for (const element of queryAll(`[${attribute}]`)) element.removeAttribute(attribute);
    }
    removeHiddenSection(document);
    removeTreeSection(document);
    this.currentView = null;
  }

  private teardown(): void {
    this.teardownView();
    for (const group of findHeaderStatGroups()) restoreHeaderStats(group);
    for (const element of queryAll('[data-geld-original]')) restoreManagedText(element);
    for (const element of queryAll('[data-geld-stat-host]')) detachBreakdownTooltip(element);
    removeTooltipElement();
    this.observer?.takeRecords();
  }
}
