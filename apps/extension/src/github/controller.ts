import type { HiddenCategory } from '@geld/core';
import { CATEGORIES } from '@geld/core';
import type { ChangeTotals } from '@geld/core';
import { subtractTotals } from '@geld/core';
import type { PathMatcher } from '@geld/core';
import { createMatcher } from '@geld/core';
import type { TabState } from '../lib/messages';
import { REVEAL_HASH_PREFIX } from '../lib/messages';
import type { RepoRule } from '@geld/core';
import { compileRepoRules, decideRepo, repoFromPathname } from '@geld/core';
import { whitespacePersistedItem } from '../lib/local-state';
import type { GeldSettings } from '@geld/core';
import type { Classified, HiddenBreakdown } from './breakdown';
import { breakdownFromFiles, buildBreakdown, EMPTY_BREAKDOWN } from './breakdown';
import { DiffSource } from './diff-source';
import { createElement, isOwnElement, OWN_UI_ATTRIBUTE, queryAll, restoreManagedText, svgFromString } from './dom';
import { detectHeadSha, shaFromCommitUrl } from './head-sha';
import type { HeaderStatGroup } from './header-stats';
import { applyHeaderStats, findHeaderStatGroups, restoreHeaderStats } from './header-stats';
import type { DiffEntry, DiffView } from './model';
import type { PageInfo } from './page';
import { describePage } from './page';
import { applyPrListStats, removePrListStats } from './pr-list';
import { removeHiddenSection, renderHiddenSection } from './ui/hidden-section';
import { detachBreakdownTooltip, removeTooltipElement } from './ui/tooltip';
import { CATEGORY_ICONS } from './ui/icons';
import type { TreeSectionFile } from './ui/tree-section';
import {
  applySidebarLayout,
  CHANGES_SECTION_ID,
  pinSidebarHeaders,
  removeSidebarLayout,
  removeTreeSection,
  renderChangesHeader,
  renderTreeSection,
} from './ui/tree-section';
import { legacyAdapter } from './views/legacy';
import { reactAdapter } from './views/react';
import { activateControl, findViewedControls, rewriteFilesLinksForWhitespace, WhitespaceRedirector } from './whitespace-viewed';

const ATTR_CONTAINER = 'data-geld-container';
const ATTR_EXPANDED = 'data-geld-expanded';
const ATTR_ENTRY = 'data-geld';
const ATTR_TREE = 'data-geld-tree';
/** On the tree root: `grouped` (accordion) or `inline` (files stay, faded, with category icons). */
const ATTR_TREE_MODE = 'data-geld-tree-mode';
const INLINE_ICON_CLASS = 'geld-tree-inline-icon';
const ATTR_SWAPPED_ICON = 'data-geld-swapped-icon';
const ATTR_TOC = 'data-geld-toc-hidden';
const ATTR_FLASH = 'data-geld-flash';

const APPLY_DEBOUNCE_MS = 60;
/** How many progressive-load rounds we nudge before giving up on a reveal. */
const MAX_REVEAL_ATTEMPTS = 40;

interface PendingReveal {
  readonly path: string;
  readonly stateKey: string;
  attempts: number;
  /** Binary-search bounds over the page's scroll position while hunting a virtualised entry, and the last position we set. */
  seek: { lo: number; hi: number; last: number | null } | null;
}

interface ClassifiedEntry extends Classified {
  readonly entry: DiffEntry;
}

export interface ControllerHooks {
  /** Receives the tab state after every pass (used for the toolbar badge). */
  readonly onTabState: (state: TabState) => void;
}

const HEADER_NODE_SELECTOR = '#diffstat, .toc-diff-stats, span.sr-only, span[class*="VisuallyHidden"]';

/** Did this batch insert something that could be (or contain) a header stat group? */
function headerNodesAdded(records: readonly MutationRecord[]): boolean {
  for (const record of records) {
    if (record.type !== 'childList') continue;
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches(HEADER_NODE_SELECTOR) || node.querySelector(HEADER_NODE_SELECTOR) !== null) return true;
    }
  }
  return false;
}

/**
 * Directories whose every file is hidden count as hidden too (collapsed away
 * in grouped mode, faded in inline mode). Deepest first, so nested directories
 * are evaluated before their parents.
 */
function markHiddenDirectories(treeDirectories: readonly HTMLElement[]): void {
  const directories = [...treeDirectories].sort(
    (a, b) => Number(b.getAttribute('aria-level') ?? 0) - Number(a.getAttribute('aria-level') ?? 0),
  );
  for (const directory of directories) {
    const hasVisible = directory.querySelector(`[${ATTR_TREE}="visible"]`) !== null;
    const hasHidden = directory.querySelector(`[${ATTR_TREE}="hidden"]`) !== null;
    directory.setAttribute(ATTR_TREE, !hasVisible && hasHidden ? 'hidden' : 'visible');
  }
}

/** GitHub's file icon in a tree row (both views draw an `octicon-file` leading visual). */
function treeRowIcon(row: HTMLElement): Element | null {
  for (const svg of row.querySelectorAll('svg')) {
    if (svg.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null) continue;
    if (/\bocticon-file\b/.test(svg.getAttribute('class') ?? '')) return svg;
  }
  return null;
}

/** Inline mode: show the category's icon in place of GitHub's file icon (or restore it). */
function setInlineIcon(row: HTMLElement, category: HiddenCategory | null): void {
  const existing = Array.from(row.querySelectorAll<HTMLElement>(`.${INLINE_ICON_CLASS}`)).find(
    (element) => element.closest('li') === row,
  );
  if (category === null) {
    existing?.remove();
    const swapped = row.querySelector(`[${ATTR_SWAPPED_ICON}]`);
    if (swapped !== null && swapped.closest('li') === row) swapped.removeAttribute(ATTR_SWAPPED_ICON);
    return;
  }
  if (existing !== undefined && existing.dataset.category === category.id) return;
  existing?.remove();
  const original = treeRowIcon(row);
  if (original === null) return;
  original.setAttribute(ATTR_SWAPPED_ICON, '');
  const icon = createElement('span', { class: INLINE_ICON_CLASS, [OWN_UI_ATTRIBUTE]: '', 'data-category': category.id, title: category.title }, [
    svgFromString(CATEGORY_ICONS[category.id]),
  ]);
  original.insertAdjacentElement('beforebegin', icon);
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
  diffPageUrl: null,
  onDiffPage: false,
};

/** The page that renders this page's diffs: PR → its files tab; commit/compare → itself. */
function diffPageUrlFor(page: PageInfo, url: URL): string | null {
  if (page.kind.startsWith('pull')) return `${url.origin}${page.stateKey}/files`;
  if (page.kind === 'commit' || page.kind === 'compare') return `${url.origin}${page.stateKey}`;
  return null;
}

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
  /** Which sidebar accordion panel is open per page ("changes" or a category id). */
  private readonly activePanel = new Map<string, string>();
  /** Inline mode: hidden files the user has opened/closed by hand per page; we stop touching those. */
  private readonly inlineTouched = new Map<string, Set<string>>();
  private readonly diffSource = new DiffSource(() => {
    // A diff (or the on-disk cache) just became available: settle the header
    // right away rather than after the debounce, then do the rest.
    this.applyHeaderNow();
    this.schedule();
  });
  private readonly whitespace = new WhitespaceRedirector(false, () => void whitespacePersistedItem.setValue(true));
  private currentView: DiffView | null = null;
  private currentPage: PageInfo | null = null;
  private pendingReveal: PendingReveal | null = null;
  /** Stops the previous reveal's re-align loop so two of them never fight over the scroll position. */
  private cancelAlign: (() => void) | null = null;
  private lastState: TabState = IDLE_STATE;
  private lastStateJson = '';
  private stopped = false;
  /** The last header numbers we settled on, re-applied synchronously if GitHub re-renders the header. */
  private settledHeader: {
    readonly stateKey: string;
    readonly sha: string | null;
    readonly hidden: HiddenBreakdown;
    readonly categories: readonly HiddenCategory[];
  } | null = null;
  private headerGroups: Array<{ readonly group: HeaderStatGroup; readonly additionsText: string | null }> = [];

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
      // Header first, synchronously: this callback runs before the browser
      // paints, so a (re-)rendered header never shows GitHub's number when the
      // filtered one is already known or cached.
      if (this.settledHeader === null) {
        if (headerNodesAdded(records)) this.applyHeaderNow();
      } else {
        this.reassertHeader();
      }
      this.schedule();
    });
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      // "Viewed" toggles flip these without adding or removing nodes.
      attributes: true,
      attributeFilter: ['aria-pressed', 'aria-checked', 'aria-label', 'data-file-user-viewed'],
    });
    // Legacy checkboxes change without any attribute mutation.
    document.addEventListener('change', this.onChangeEvent, true);
    // Inline layout: a real click on a hidden file hands control of it to the user.
    document.addEventListener('click', this.onUserClick, true);
    this.apply();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    document.removeEventListener('change', this.onChangeEvent, true);
    document.removeEventListener('click', this.onUserClick, true);
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
    this.settledHeader = null;
    // Per-page toggles were made against the old defaults; start fresh.
    this.diffExpanded.clear();
    this.inlineTouched.clear();
    this.pendingReveal = null;
    this.teardown();
    this.apply();
  }

  private readonly onUserClick = (event: MouseEvent): void => {
    if (!event.isTrusted || this.settings.groupHidden || this.currentPage === null || this.currentView === null) return;
    const target = event.target instanceof Element ? event.target : null;
    const root = target?.closest<HTMLElement>(`[${ATTR_ENTRY}="hidden"]`) ?? null;
    if (root === null) return;
    const entry = this.currentView.entries.find((candidate) => candidate.root === root);
    if (entry === undefined) return;
    const key = this.currentPage.stateKey;
    const touched = this.inlineTouched.get(key) ?? new Set<string>();
    touched.add(entry.path);
    this.inlineTouched.set(key, touched);
  };

  private readonly onChangeEvent = (event: Event): void => {
    if (event.target instanceof HTMLInputElement && event.target.type === 'checkbox' && !isOwnElement(event.target)) this.schedule();
  };

  /**
   * Turn on every "Viewed" control of the hidden files, looking them up right
   * now: GitHub's React view re-renders and virtualises file headers, so any
   * element found earlier may no longer be in the page.
   */
  private markHiddenViewed(): void {
    const view = legacyAdapter.read() ?? reactAdapter.read();
    if (view === null) return;
    const matcher = this.matcherFor(repoFromPathname(window.location.pathname));
    for (const entry of view.entries) {
      if (matcher.categorize(entry.path) === null) continue;
      for (const control of findViewedControls(entry.root).unviewed) activateControl(control);
    }
    this.schedule();
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

  /** Popup's "go to file": expand the hidden files and scroll to `path` (works while diffs still load). */
  revealPath(path: string): void {
    if (this.currentPage === null) return;
    this.reveal(path, this.currentPage.stateKey);
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
    // A deliberate show/hide-all overrides files the user toggled one by one.
    this.inlineTouched.delete(key);
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
      this.consumeRevealHash(page.stateKey);
      this.continuePendingReveal(view, page.stateKey);
    } else {
      this.teardownView();
    }

    const header = this.applyHeaderTotals(page, url, matcher, view, renderedEntryCount, hidden);
    const headerHidden = header.hidden;
    const allTotals = header.all;

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
      hasDiff: view !== null || (page.diffUrl !== null && header.hasGroups),
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
      diffPageUrl: diffPageUrlFor(page, url),
      onDiffPage: view !== null,
    });

    this.observer?.takeRecords();
  }

  /** Arriving via `#geld-reveal=<path>` (from the popup on another tab of the PR): reveal, then drop the hash. */
  private consumeRevealHash(stateKey: string): void {
    const { hash } = window.location;
    if (!hash.startsWith(REVEAL_HASH_PREFIX)) return;
    let path: string;
    try {
      path = decodeURIComponent(hash.slice(REVEAL_HASH_PREFIX.length));
    } catch {
      return;
    }
    history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}`);
    this.reveal(path, stateKey);
  }

  private applyView(
    view: DiffView,
    stateKey: string,
    matcher: PathMatcher,
  ): { readonly breakdown: HiddenBreakdown; readonly expanded: boolean } {
    if (!this.settings.groupHidden) return this.applyInlineView(view, stateKey, matcher);
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
      let unviewedCount = 0;
      let viewedCount = 0;
      for (const item of hiddenEntries) {
        const controls = findViewedControls(item.entry.root);
        unviewedCount += controls.unviewed.length;
        viewedCount += controls.viewed.length;
      }
      renderHiddenSection(
        view.container,
        { breakdown, activeCategories: matcher.activeCategories, expanded, unviewedCount, viewedCount },
        {
          onToggle: () => this.setDiffExpanded(stateKey, !this.isDiffExpanded(stateKey, everythingHidden)),
          onMarkViewed: () => this.markHiddenViewed(),
        },
      );
    }

    for (const [anchor, item] of view.tocItems) item.toggleAttribute(ATTR_TOC, hiddenAnchors.has(anchor));

    this.applyTree(view, stateKey, matcher);
    return { breakdown, expanded };
  }

  /**
   * Inline layout: nothing moves. Hidden diffs stay in place but start
   * collapsed (using GitHub's own control, so the user can open them); the
   * file tree keeps GitHub's list and only fades the hidden files, swapping
   * their file icon for the category's. Header counts are adjusted as usual.
   */
  private applyInlineView(
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
    for (const item of classified) item.entry.root.setAttribute(ATTR_ENTRY, item.category === null ? 'visible' : 'hidden');
    // None of the grouped chrome applies here.
    view.container.removeAttribute(ATTR_CONTAINER);
    view.container.removeAttribute(ATTR_EXPANDED);
    removeHiddenSection(view.container);
    for (const item of view.tocItems.values()) item.removeAttribute(ATTR_TOC);

    // "Expanded" here means "not collapsed by us". The state is enforced on
    // every pass (GitHub re-renders some headers expanded, e.g. rich diffs
    // that load in two steps) except for files the user has clicked, which
    // are theirs from then on. The adapters are no-ops when already in state.
    const expanded = this.isDiffExpanded(stateKey, false);
    const touched = this.inlineTouched.get(stateKey);
    for (const item of classified) {
      if (item.category === null || touched?.has(item.path) === true) continue;
      if (expanded) view.expandEntry(item.entry);
      else view.collapseEntry(item.entry);
    }

    this.applyInlineTree(view, matcher);
    return { breakdown: buildBreakdown(classified), expanded };
  }

  private applyInlineTree(view: DiffView, matcher: PathMatcher): void {
    if (view.treeRoot === null) return;
    const host = view.treeRoot.parentElement ?? document;
    removeTreeSection(host);
    removeSidebarLayout(host);
    view.treeRoot.setAttribute(ATTR_TREE_MODE, 'inline');
    for (const file of view.treeFiles) {
      const category = matcher.categorize(file.path);
      file.element.setAttribute(ATTR_TREE, category === null ? 'visible' : 'hidden');
      setInlineIcon(file.element, category);
    }
    markHiddenDirectories(view.treeDirectories);
  }

  private applyTree(view: DiffView, stateKey: string, matcher: PathMatcher): void {
    if (view.treeRoot === null) return;
    view.treeRoot.setAttribute(ATTR_TREE_MODE, 'grouped');
    for (const element of view.treeRoot.querySelectorAll<HTMLElement>(`.${INLINE_ICON_CLASS}`)) element.remove();
    for (const element of view.treeRoot.querySelectorAll<HTMLElement>(`[${ATTR_SWAPPED_ICON}]`)) element.removeAttribute(ATTR_SWAPPED_ICON);

    const entryPaths = new Set(view.entries.map((entry) => entry.path));
    const byCategory = new Map<HiddenCategory, TreeSectionFile[]>();
    let visibleFiles = 0;
    for (const file of view.treeFiles) {
      const category = matcher.categorize(file.path);
      file.element.setAttribute(ATTR_TREE, category === null ? 'visible' : 'hidden');
      if (category === null) {
        visibleFiles += 1;
        continue;
      }
      const list = byCategory.get(category) ?? [];
      list.push({ path: file.path, available: entryPaths.has(file.path), statusIcon: file.statusIcon });
      byCategory.set(category, list);
    }

    markHiddenDirectories(view.treeDirectories);

    const host = view.treeRoot.parentElement ?? document;
    const present = new Set<string>(Array.from(byCategory.keys(), (category) => category.id));
    if (present.size === 0) {
      // Nothing hidden: GitHub's sidebar stays exactly as it was.
      removeTreeSection(host);
      removeSidebarLayout(host);
      return;
    }

    // One panel open at a time; fall back to GitHub's tree if the remembered
    // panel's category has nothing on this page.
    let active = this.activePanel.get(stateKey) ?? CHANGES_SECTION_ID;
    if (active !== CHANGES_SECTION_ID && !present.has(active)) active = CHANGES_SECTION_ID;
    const activate = (panel: string): void => {
      const current = this.activePanel.get(stateKey) ?? CHANGES_SECTION_ID;
      this.activePanel.set(stateKey, current === panel ? CHANGES_SECTION_ID : panel);
      this.apply();
    };

    applySidebarLayout(view.treeRoot, active);
    renderChangesHeader(view.treeRoot, { count: visibleFiles, active: active === CHANGES_SECTION_ID, view: view.kind }, () =>
      activate(CHANGES_SECTION_ID),
    );

    removeTreeSection(host, present);
    let previous: HTMLElement | null = null;
    for (const category of CATEGORIES) {
      const files = byCategory.get(category);
      if (files === undefined) continue;
      previous = renderTreeSection(
        view.treeRoot,
        { category, view: view.kind, stateKey, files, active: active === category.id },
        () => activate(category.id),
        (path) => this.reveal(path, stateKey),
        previous,
      );
    }
    pinSidebarHeaders(view.treeRoot);
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
    this.whitespace.ensure(url, page.stateKey);
  }

  /** Expand the hidden section and scroll a specific hidden file into view. */
  private reveal(path: string, stateKey: string): void {
    const view = this.currentView;
    if (view === null) return;
    this.cancelAlign?.();
    this.cancelAlign = null;
    if (this.settings.groupHidden && !this.isDiffExpanded(stateKey, false)) this.setDiffExpanded(stateKey, true);

    const entry = view.entries.find((candidate) => candidate.path === path);
    if (entry === undefined) {
      // Not in the DOM: GitHub's React view virtualises the list and the legacy
      // view loads big diffs progressively. Remember the request and go looking.
      this.pendingReveal = { path, stateKey, attempts: 0, seek: null };
      this.seekEntry(view, this.pendingReveal);
      return;
    }
    this.finishReveal(view, entry, stateKey, true);
  }

  /**
   * Move the page so the target's diff gets rendered. Legacy pages load
   * everything once the end is reached, so scroll there. The React view only
   * renders what is on screen, so binary-search the scroll position using the
   * file tree's order (the diff list follows it) until the entry appears.
   */
  private seekEntry(view: DiffView, pending: PendingReveal): void {
    const order = new Map(view.treeFiles.map((file, index) => [file.path, index] as const));
    const target = order.get(pending.path);
    if (view.kind === 'legacy' || target === undefined) {
      this.nudgeProgressiveLoading(view);
      return;
    }
    const scroller = document.scrollingElement ?? document.documentElement;
    const maxScroll = Math.max(0, scroller.scrollHeight - window.innerHeight);
    const total = Math.max(1, view.treeFiles.length - 1);
    let seek = pending.seek;
    let next: number;
    if (seek === null) {
      // First guess: the file's share of the tree, as a share of the page.
      seek = { lo: 0, hi: maxScroll, last: null };
      pending.seek = seek;
      next = Math.round((maxScroll * target) / total);
    } else {
      // Narrow the bounds using what got rendered at the position we last set
      // (not scrollY, which GitHub may still be animating).
      const rendered = view.entries.map((entry) => order.get(entry.path)).filter((index): index is number => index !== undefined);
      if (seek.last !== null && rendered.length > 0) {
        if (Math.max(...rendered) < target) seek.lo = seek.last;
        else if (Math.min(...rendered) > target) seek.hi = seek.last;
      }
      // The page grows as the virtualiser measures more rows; keep the upper bound honest.
      if (seek.hi >= maxScroll - 8) seek.hi = maxScroll;
      if (seek.hi - seek.lo < 8) {
        // Converged without finding it: the orders differ; fall back to the end.
        this.nudgeProgressiveLoading(view);
        return;
      }
      next = Math.round((seek.lo + seek.hi) / 2);
    }
    seek.last = next;
    window.scrollTo({ top: next, behavior: 'instant' });
  }

  private finishReveal(view: DiffView, entry: DiffEntry, stateKey: string, scroll: boolean): void {
    this.pendingReveal = null;
    view.expandEntry(entry);
    if (!this.settings.groupHidden) {
      // Inline layout: opening it on request counts as the user's choice.
      const touched = this.inlineTouched.get(stateKey) ?? new Set<string>();
      touched.add(entry.path);
      this.inlineTouched.set(stateKey, touched);
    }
    requestAnimationFrame(() => {
      if (scroll) entry.root.scrollIntoView({ block: 'start', behavior: 'instant' });
      entry.root.setAttribute(ATTR_FLASH, '');
      setTimeout(() => entry.root.removeAttribute(ATTR_FLASH), 1600);
      if (entry.anchor !== null) history.replaceState(history.state, '', `#${entry.anchor}`);
      if (scroll) this.keepAligned(entry.root);
    });
  }

  /**
   * Diff bodies above the target load lazily as we scroll past them, pushing
   * the target down after we aligned it. Re-align a few times while that
   * settles, but stop as soon as the user scrolls on their own.
   */
  private keepAligned(target: HTMLElement): void {
    const scrollMargin = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    const deadline = performance.now() + 1500;
    let stableChecks = 0;
    let userScrolled = false;
    const stop = (): void => {
      userScrolled = true;
    };
    this.cancelAlign = stop;
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
      if (Math.abs(drift) > 4) {
        stableChecks = 0;
        // Correct by the drift itself rather than re-running scrollIntoView, so
        // a virtualised list settling above us does not cause visible jumps.
        window.scrollBy({ top: drift, behavior: 'instant' });
      } else if ((stableChecks += 1) >= 3) {
        return;
      }
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
    const entry = view.entries.find((candidate) => candidate.path === pending.path);
    if (entry !== undefined) {
      this.finishReveal(view, entry, stateKey, true);
      return;
    }
    pending.attempts += 1;
    this.seekEntry(view, pending);
  }

  /**
   * Header totals. On pull request and commit pages the head commit is known,
   * so the raw diff (cached on disk per commit) is the only source: it is
   * final the moment it is available, whereas DOM totals step down file by
   * file while GitHub streams the diff in. Until it is available GitHub's own
   * numbers stay untouched; there is never an intermediate value. Pages
   * without a commit key (compare) use the DOM once every file is rendered.
   */
  private applyHeaderTotals(
    page: PageInfo,
    url: URL,
    matcher: PathMatcher,
    view: DiffView | null,
    renderedEntryCount: number,
    hidden: HiddenBreakdown | null,
  ): { readonly hidden: HiddenBreakdown | null; readonly all: ChangeTotals | null; readonly hasGroups: boolean } {
    const groups = findHeaderStatGroups();
    const headerFileCount = groups.map((group) => group.original?.files ?? 0).reduce((a, b) => Math.max(a, b), 0);
    const expectedFileCount = Math.max(headerFileCount, view?.treeFiles.length ?? 0);
    const domIsComplete = view !== null && (expectedFileCount === 0 || renderedEntryCount >= expectedFileCount);
    const sha = page.kind.startsWith('pull') ? detectHeadSha() : page.kind === 'commit' ? shaFromCommitUrl(url.pathname) : null;

    let headerHidden: HiddenBreakdown | null = null;
    let allTotals: ChangeTotals | null = groups.find((group) => group.original !== null)?.original ?? null;
    if (page.diffUrl !== null && groups.length > 0 && (sha !== null || !domIsComplete)) {
      const state = this.diffSource.request(page.diffUrl, sha);
      if (state.status === 'ready') {
        const fromDiff = breakdownFromFiles(state.files, matcher);
        headerHidden = fromDiff.hidden;
        allTotals ??= fromDiff.all;
      } else if (state.status === 'failed' && domIsComplete) {
        headerHidden = hidden ?? EMPTY_BREAKDOWN;
      }
    } else if (domIsComplete) {
      headerHidden = hidden ?? EMPTY_BREAKDOWN;
    }
    if (headerHidden !== null) {
      this.settledHeader = { stateKey: page.stateKey, sha, hidden: headerHidden, categories: matcher.activeCategories };
      this.applyHeader(groups, headerHidden, matcher.activeCategories);
    } else {
      // A new head commit (or another page) invalidates what we settled on.
      if (this.settledHeader !== null && (this.settledHeader.stateKey !== page.stateKey || this.settledHeader.sha !== sha)) {
        this.settledHeader = null;
      }
      this.headerGroups = [];
    }
    return { hidden: headerHidden, all: allTotals, hasGroups: groups.length > 0 };
  }

  /** Header-only pass for the pre-paint paths; the full apply() follows debounced. */
  private applyHeaderNow(): void {
    if (this.stopped || !this.settings.enabled) return;
    const url = new URL(window.location.href);
    const page = describePage(url);
    if (page.diffUrl === null) return;
    const repo = repoFromPathname(url.pathname);
    if (repo !== null && !decideRepo(this.repoRules, repo).allowed) return;
    this.currentPage = page;
    this.applyHeaderTotals(page, url, this.matcherFor(repo), null, 0, null);
    this.observer?.takeRecords();
  }

  private applyHeader(groups: readonly HeaderStatGroup[], hidden: HiddenBreakdown, categories: readonly HiddenCategory[]): void {
    for (const group of groups) applyHeaderStats(group, hidden, categories);
    this.headerGroups = groups.map((group) => ({ group, additionsText: group.additions?.textContent ?? null }));
  }

  /**
   * GitHub's React header is mounted several times while a page streams in,
   * each time with the unfiltered numbers. Called from the mutation callback
   * (before paint): if a header we rewrote is gone or reverted, rewrite the
   * current one immediately with the numbers we already settled on.
   */
  private reassertHeader(): void {
    const settled = this.settledHeader;
    if (settled === null || this.currentPage?.stateKey !== settled.stateKey) return;
    const stale = this.headerGroups.some(
      ({ group, additionsText }) => !group.host.isConnected || (group.additions !== null && group.additions.textContent !== additionsText),
    );
    if (!stale) return;
    const groups = findHeaderStatGroups();
    if (groups.length === 0) return;
    this.applyHeader(groups, settled.hidden, settled.categories);
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
    for (const attribute of [ATTR_ENTRY, ATTR_TREE, ATTR_TREE_MODE, ATTR_TOC, ATTR_FLASH, ATTR_SWAPPED_ICON]) {
      for (const element of queryAll(`[${attribute}]`)) element.removeAttribute(attribute);
    }
    for (const element of queryAll(`.${INLINE_ICON_CLASS}`)) element.remove();
    removeHiddenSection(document);
    removeTreeSection(document);
    removeSidebarLayout(document);
    this.currentView = null;
  }

  private teardown(): void {
    this.settledHeader = null;
    this.headerGroups = [];
    this.teardownView();
    removePrListStats();
    for (const group of findHeaderStatGroups()) restoreHeaderStats(group);
    for (const element of queryAll('[data-geld-original]')) restoreManagedText(element);
    for (const element of queryAll('[data-geld-stat-host]')) detachBreakdownTooltip(element);
    removeTooltipElement();
    this.observer?.takeRecords();
  }
}

