import type { HiddenCategory } from '../lib/categories';
import { CATEGORIES } from '../lib/categories';
import type { ChangeTotals } from '../lib/format';
import { subtractTotals } from '../lib/format';
import type { PathMatcher } from '../lib/matcher';
import { createMatcher } from '../lib/matcher';
import type { TabState } from '../lib/messages';
import type { RepoRule } from '../lib/repo-rules';
import { compileRepoRules, decideRepo, repoFromPathname } from '../lib/repo-rules';
import { whitespacePersistedItem } from '../lib/local-state';
import type { GeldSettings } from '../lib/settings';
import type { Classified, HiddenBreakdown } from './breakdown';
import { breakdownFromFiles, buildBreakdown, EMPTY_BREAKDOWN } from './breakdown';
import { DiffSource } from './diff-source';
import { isOwnElement, queryAll, restoreManagedText } from './dom';
import { detectHeadSha, shaFromCommitUrl } from './head-sha';
import { applyHeaderStats, findHeaderStatGroups, restoreHeaderStats } from './header-stats';
import type { DiffEntry, DiffView } from './model';
import type { PageInfo } from './page';
import { describePage } from './page';
import { applyPrListStats, removePrListStats } from './pr-list';
import { removeHiddenSection, renderHiddenSection } from './ui/hidden-section';
import { detachBreakdownTooltip, removeTooltipElement } from './ui/tooltip';
import type { TreeSectionFile } from './ui/tree-section';
import { removeTreeSection, renderTreeSection } from './ui/tree-section';
import { legacyAdapter } from './views/legacy';
import { reactAdapter } from './views/react';
import { findUnviewedControls, rewriteFilesLinksForWhitespace, WhitespaceRedirector } from './whitespace-viewed';

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

interface ClassifiedEntry extends Classified {
  readonly entry: DiffEntry;
}

export interface ControllerHooks {
  /** Receives the tab state after every pass (used for the toolbar badge). */
  readonly onTabState: (state: TabState) => void;
}

const IDLE_STATE: TabState = {
  repo: null,
  allowed: true,
  rule: null,
  hasDiff: false,
  hiddenCount: 0,
  all: null,
  visible: null,
  categories: [],
  expanded: false,
};

/**
 * Owns the lifecycle of Geld on a GitHub tab: watches the DOM, classifies
 * diff entries, hides the ones that match an enabled category and keeps the
 * header counts and side panels in sync. Every operation is idempotent so it
 * can run after any DOM mutation without accumulating state in the page.
 */
export class GeldController {
  private settings: GeldSettings;
  private repoRules: readonly RepoRule[];
  private readonly matchers = new Map<string, PathMatcher>();
  private observer: MutationObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly diffExpanded = new Map<string, boolean>();
  private readonly treeExpanded = new Map<string, boolean>();
  private readonly diffSource = new DiffSource(() => this.schedule());
  private readonly whitespace = new WhitespaceRedirector(false, () => void whitespacePersistedItem.setValue(true));
  private currentView: DiffView | null = null;
  private currentPage: PageInfo | null = null;
  private pendingReveal: PendingReveal | null = null;
  private lastState: TabState = IDLE_STATE;
  private lastStateJson = '';
  private stopped = false;

  constructor(
    settings: GeldSettings,
    private readonly hooks: ControllerHooks,
  ) {
    this.settings = settings;
    this.repoRules = compileRepoRules(settings.repoRules);
    void whitespacePersistedItem.getValue().then((persisted) => this.whitespace.setPersisted(persisted));
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
    this.repoRules = compileRepoRules(settings.repoRules);
    this.matchers.clear();
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

  /** Keyboard shortcut: show/hide the hidden files on this page for this session. */
  toggleHidden(): void {
    if (!this.settings.shortcutEnabled || this.currentPage === null || this.currentView === null) return;
    const key = this.currentPage.stateKey;
    this.setDiffExpanded(key, !this.isDiffExpanded(key, false));
  }

  getTabState(): TabState {
    return this.lastState;
  }

  /** Matchers are cached per repository because custom patterns can be repo-scoped. */
  private matcherFor(repo: string | null): PathMatcher {
    const key = repo ?? '';
    let matcher = this.matchers.get(key);
    if (matcher === undefined) {
      matcher = createMatcher(this.settings, repo);
      this.matchers.set(key, matcher);
    }
    return matcher;
  }

  private schedule(): void {
    if (this.stopped || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.apply();
    }, APPLY_DEBOUNCE_MS);
  }

  private isDiffExpanded(key: string, everythingHidden: boolean): boolean {
    // When every file on the page is hidden there is nothing left to review,
    // so start expanded unless the user has toggled this page themselves.
    return this.diffExpanded.get(key) ?? (everythingHidden || this.settings.expandedByDefault);
  }

  private setDiffExpanded(key: string, expanded: boolean): void {
    this.diffExpanded.set(key, expanded);
    this.apply();
  }

  private apply(): void {
    if (this.stopped) return;
    if (!this.settings.enabled) {
      this.teardown();
      this.publish({ ...IDLE_STATE, allowed: false });
      return;
    }

    const url = new URL(window.location.href);
    const page = describePage(url);
    this.currentPage = page;
    const repo = repoFromPathname(url.pathname);
    const decision = repo === null ? { allowed: true, rule: null } : decideRepo(this.repoRules, repo);

    if (!decision.allowed) {
      this.teardown();
      this.publish({ ...IDLE_STATE, repo, allowed: false, rule: decision.rule?.raw ?? null });
      return;
    }

    const matcher = this.matcherFor(repo);
    const view = legacyAdapter.read() ?? reactAdapter.read();
    this.currentView = view;

    let hidden: HiddenBreakdown | null = null;
    let renderedEntryCount = 0;
    let expanded = false;

    if (view !== null) {
      renderedEntryCount = view.entries.length;
      const result = this.applyView(view, page.stateKey, matcher);
      hidden = result.breakdown;
      expanded = result.expanded;
      this.continuePendingReveal(view, page.stateKey);
    } else {
      this.teardownView();
    }

    // Header totals. Prefer the DOM when every file is rendered; otherwise fall
    // back to the raw diff so large or diff-less pages (conversation tab) are
    // still accurate. The diff is cached per head commit, so revisits are free.
    const groups = findHeaderStatGroups();
    const headerFileCount = groups.map((group) => group.original?.files ?? 0).reduce((a, b) => Math.max(a, b), 0);
    const domIsComplete = view !== null && (headerFileCount === 0 || renderedEntryCount >= headerFileCount);

    let headerHidden: HiddenBreakdown | null = domIsComplete ? hidden ?? EMPTY_BREAKDOWN : null;
    let allTotals: ChangeTotals | null = groups.find((group) => group.original !== null)?.original ?? null;
    if (headerHidden === null && page.diffUrl !== null && groups.length > 0) {
      const sha = page.kind.startsWith('pull') ? detectHeadSha() : page.kind === 'commit' ? shaFromCommitUrl(url.pathname) : null;
      const state = this.diffSource.request(page.diffUrl, sha);
      if (state.status === 'ready') {
        const fromDiff = breakdownFromFiles(state.files, matcher);
        headerHidden = fromDiff.hidden;
        allTotals ??= fromDiff.all;
      } else if (state.status === 'failed' && hidden !== null) {
        headerHidden = hidden;
      }
    }
    if (headerHidden !== null) {
      for (const group of groups) applyHeaderStats(group, headerHidden, matcher.activeCategories);
    }

    this.applyWhitespace(page, view, url);

    if (this.settings.showListStats) {
      applyPrListStats({
        matcherFor: (rowRepo) => this.matcherFor(rowRepo),
        repoRules: this.repoRules,
        diffSource: this.diffSource,
        onRowVisible: () => this.schedule(),
      });
    } else {
      removePrListStats();
    }

    const effectiveHidden = headerHidden ?? hidden;
    this.publish({
      repo,
      allowed: true,
      rule: null,
      hasDiff: view !== null || (page.diffUrl !== null && groups.length > 0),
      hiddenCount: effectiveHidden?.totals.files ?? 0,
      all: allTotals,
      visible: allTotals !== null && effectiveHidden !== null ? subtractTotals(allTotals, effectiveHidden.totals) : null,
      categories: (effectiveHidden?.categories ?? []).map((entry) => ({
        id: entry.category.id,
        title: entry.category.title,
        count: entry.totals.files,
        paths: entry.paths,
      })),
      expanded,
    });

    this.observer?.takeRecords();
  }

  private applyView(
    view: DiffView,
    stateKey: string,
    matcher: PathMatcher,
  ): { readonly breakdown: HiddenBreakdown; readonly expanded: boolean } {
    const classified: ClassifiedEntry[] = view.entries.map((entry) => ({
      entry,
      path: entry.path,
      category: matcher.categorize(entry.path),
      stats: entry.stats,
    }));
    const hiddenEntries = classified.filter((item) => item.category !== null);
    const hiddenAnchors = new Set<string>();
    for (const item of classified) {
      item.entry.root.setAttribute(ATTR_ENTRY, item.category === null ? 'visible' : 'hidden');
      if (item.category !== null && item.entry.anchor !== null) hiddenAnchors.add(item.entry.anchor);
    }

    const everythingHidden = hiddenEntries.length > 0 && hiddenEntries.length === classified.length;
    const expanded = this.isDiffExpanded(stateKey, everythingHidden);
    const breakdown = buildBreakdown(classified);

    if (hiddenEntries.length === 0) {
      // Nothing to hide: leave GitHub's layout completely untouched.
      view.container.removeAttribute(ATTR_CONTAINER);
      view.container.removeAttribute(ATTR_EXPANDED);
      for (const item of classified) item.entry.root.removeAttribute(ATTR_ENTRY);
      removeHiddenSection(view.container);
    } else {
      view.container.setAttribute(ATTR_CONTAINER, view.kind);
      view.container.toggleAttribute(ATTR_EXPANDED, expanded);
      const unviewed = hiddenEntries.flatMap((item) => findUnviewedControls(item.entry.root));
      renderHiddenSection(
        view.container,
        { breakdown, activeCategories: matcher.activeCategories, expanded, unviewedCount: unviewed.length },
        {
          onToggle: () => this.setDiffExpanded(stateKey, !this.isDiffExpanded(stateKey, everythingHidden)),
          onMarkViewed: () => {
            for (const control of unviewed) control.click();
            this.schedule();
          },
        },
      );
    }

    for (const [anchor, item] of view.tocItems) item.toggleAttribute(ATTR_TOC, hiddenAnchors.has(anchor));

    this.applyTree(view, stateKey, matcher);
    return { breakdown, expanded };
  }

  private applyTree(view: DiffView, stateKey: string, matcher: PathMatcher): void {
    if (view.treeRoot === null) return;

    const entryPaths = new Set(view.entries.map((entry) => entry.path));
    const byCategory = new Map<HiddenCategory, TreeSectionFile[]>();
    for (const file of view.treeFiles) {
      const category = matcher.categorize(file.path);
      file.element.setAttribute(ATTR_TREE, category === null ? 'visible' : 'hidden');
      if (category === null) continue;
      const list = byCategory.get(category) ?? [];
      list.push({ path: file.path, available: entryPaths.has(file.path), statusIcon: file.statusIcon });
      byCategory.set(category, list);
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

    const host = view.treeRoot.parentElement ?? document;
    removeTreeSection(host, new Set(Array.from(byCategory.keys(), (category) => category.id)));
    let previous: HTMLElement | null = null;
    for (const category of CATEGORIES) {
      const files = byCategory.get(category);
      if (files === undefined) continue;
      const key = `${stateKey}#${category.id}`;
      previous = renderTreeSection(
        view.treeRoot,
        { category, view: view.kind, stateKey, files, expanded: this.treeExpanded.get(key) ?? false },
        () => {
          this.treeExpanded.set(key, !(this.treeExpanded.get(key) ?? false));
          this.apply();
        },
        (path) => this.reveal(path, stateKey),
        previous,
      );
    }
  }

  /**
   * GitHub hides whitespace-only changes when the URL carries `?w=1`. Rewrite
   * the "Files changed" links so navigation lands there directly, and redirect
   * once when a diff page was opened without it.
   */
  private applyWhitespace(page: PageInfo, view: DiffView | null, url: URL): void {
    if (!this.settings.hideWhitespace) return;
    rewriteFilesLinksForWhitespace();
    if (view === null) return;
    if (page.kind !== 'pull-files' && page.kind !== 'commit' && page.kind !== 'compare') return;
    this.whitespace.ensure(url);
  }

  /** Expand the hidden section and scroll a specific hidden file into view. */
  private reveal(path: string, stateKey: string): void {
    const view = this.currentView;
    if (view === null) return;
    if (!this.isDiffExpanded(stateKey, false)) this.setDiffExpanded(stateKey, true);

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

  private publish(state: TabState): void {
    this.lastState = state;
    const json = JSON.stringify(state);
    if (json === this.lastStateJson) return;
    this.lastStateJson = json;
    this.hooks.onTabState(state);
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
    removePrListStats();
    for (const group of findHeaderStatGroups()) restoreHeaderStats(group);
    for (const element of queryAll('[data-geld-original]')) restoreManagedText(element);
    for (const element of queryAll('[data-geld-stat-host]')) detachBreakdownTooltip(element);
    removeTooltipElement();
    this.observer?.takeRecords();
  }
}

