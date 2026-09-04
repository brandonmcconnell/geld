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
    view.container.setAttribute(ATTR_CONTAINER, view.kind);
    view.container.toggleAttribute(ATTR_EXPANDED, expanded);

    const hidden = sumEntries(hiddenEntries);
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
    const entry = view.entries.find((candidate) => candidate.path === path);
    if (entry === undefined) return;

    if (!this.isDiffExpanded(stateKey)) this.setDiffExpanded(stateKey, true);
    view.expandEntry(entry);

    requestAnimationFrame(() => {
      entry.root.scrollIntoView({ block: 'start', behavior: 'smooth' });
      entry.root.setAttribute(ATTR_FLASH, '');
      setTimeout(() => entry.root.removeAttribute(ATTR_FLASH), 1600);
      if (entry.anchor !== null) history.replaceState(history.state, '', `#${entry.anchor}`);
    });
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
