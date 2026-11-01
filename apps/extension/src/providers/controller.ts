import type { Catalog, ChangeTotals, FileStats, GeldSettings } from '@geld/core';
import { allCategories, BUNDLED_CATALOG, compileRepoRules, createMatcher, decideRepo, formatCount, isAutoViewed, isCategoryEnabled, pluralize, providerRepositoryScope, repositoryKey, subtractTotals } from '@geld/core';
import { breakdownFromFiles, hiddenLabel, hiddenNounPlural, statsBreakdown } from '../github/breakdown';
import type { HiddenBreakdown, StatsBreakdown } from '../github/breakdown';
import type { TabState } from '../lib/messages';
import { ProviderDiffSource, providerDiffKey } from './diff-source';
import { element, ProviderCounts } from './dom';
import { ProviderConversation } from './conversation';
import type { ProviderConversationServices } from './conversation';
import { ProviderHover } from './hover';
import { ProviderReveal } from './reveal';
import { ProviderCategoryTree } from './tree';
import { ProviderInlineTree } from './inline-tree';
import { ProviderHiddenAuthors } from './hidden-authors';
import { ProviderHeaderHints } from './header-hints';
import { applyProviderLineFolds, clearProviderLineFolds, PROVIDER_LINE_FOLDS_CHANGED } from './line-folds';
import { immutableProviderPage, isProviderReviewPage } from './types';
import type { ProviderAdapter, ProviderDiffEntry, ProviderDiffView, ProviderHeaderTarget, ProviderListRow, ProviderPage } from './types';
import type { ProviderRepoConfigSource } from './repo-config';
import type { RepoConfigChoices } from '../lib/local-state';

const HIDDEN = 'data-geld-provider-hidden';
const INLINE = 'data-geld-provider-inline';
const FLOW_WRAPPER = 'data-geld-provider-flow-wrapper';

interface SettledHeader {
  readonly key: string;
  readonly settings: GeldSettings;
  readonly effective: GeldSettings;
  readonly catalog: Catalog;
  readonly choices: RepoConfigChoices;
  readonly config: TabState['repoConfig'];
  readonly visible: ChangeTotals;
  readonly filtered: string | null;
  readonly headers: readonly HeaderSnapshot[];
  readonly hintLabel: string | null;
}

interface HeaderSnapshot { readonly nodes: readonly (HTMLElement | null | undefined)[]; readonly values: string }

interface HoverCounts {
  readonly stats: StatsBreakdown | null;
  readonly status: 'loading' | 'unavailable' | 'provisional' | 'ready';
  readonly reason?: string;
  readonly onIntent?: () => void;
  readonly anchor?: () => HTMLElement | null;
}

export const PROVIDER_IDLE_STATE: TabState = {
  repo: null, repoConfig: null, allowed: true, rule: null, hasDiff: false, hiddenCount: 0,
  all: null, visible: null, categories: [], expanded: false, diffPageUrl: null, onDiffPage: false,
};

function attribute(node: HTMLElement, name: string, value: string | null): void {
  if (value === null) { if (node.hasAttribute(name)) node.removeAttribute(name); }
  else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

export class ProviderController {
  private settings: GeldSettings;
  private catalog: Catalog;
  private readonly source: ProviderDiffSource;
  private readonly counts = new ProviderCounts();
  private readonly categoryTree = new ProviderCategoryTree();
  private readonly inlineTree = new ProviderInlineTree();
  private readonly hiddenAuthors: ProviderHiddenAuthors;
  private readonly headerHints = new ProviderHeaderHints();
  private readonly conversation: ProviderConversation;
  private readonly hover: ProviderHover;
  private readonly reveal: ProviderReveal;
  private readonly hoverCounts = new Map<HTMLElement, HoverCounts>();
  private readonly headerHosts = new Set<HTMLElement>();
  private observer: MutationObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pulse: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private pageKey = '';
  private expanded: boolean;
  private expansionKey: string | null = null;
  private readonly expansionChoices = new Map<string, boolean>();
  private readonly inlineTouched = new Map<string, Set<string>>();
  private state: TabState = PROVIDER_IDLE_STATE;
  private settledHeader: SettledHeader | null = null;
  private effectiveSettings: GeldSettings | null = null;
  private section: HTMLElement | null = null;
  private activeCategory: string | null = null;
  private layout: HTMLElement | null = null;
  private grouped = false;
  private readonly flowWrappers = new Map<HTMLElement, string | null>();
  private signature = '';
  private readonly touched = new Set<HTMLElement>();
  private readonly chips = new Set<HTMLElement>();
  private readonly collapsed = new Map<string, ProviderDiffEntry>();
  private readonly viewed = new Map<string, { readonly attempts: number; readonly at: number; readonly confirmed: boolean }>();
  private shownInline = new WeakMap<HTMLElement, string>();
  private readonly expandedLarge = new WeakMap<HTMLElement, Set<string>>();
  private rowObserver: IntersectionObserver | null = null;
  private readonly observedRows = new WeakSet<HTMLElement>();
  private readonly visibleRows = new WeakSet<HTMLElement>();
  private listDemand = new WeakMap<HTMLElement, string>();

  constructor(
    private readonly adapter: ProviderAdapter,
    settings: GeldSettings,
    private readonly publish: (state: TabState) => void,
    catalog: Catalog = BUNDLED_CATALOG,
    private readonly configs: ProviderRepoConfigSource | null = null,
    private choices: RepoConfigChoices = {},
    services: ProviderConversationServices = {},
  ) {
    this.settings = settings;
    this.catalog = catalog;
    this.expanded = settings.expandedByDefault;
    this.hiddenAuthors = new ProviderHiddenAuthors(adapter.id, () => this.requestRefresh());
    this.source = new ProviderDiffSource(adapter, () => this.requestRefresh(), undefined, {
      anonymous: () => adapter.id === 'bitbucket' && adapter.eagerListDiffs?.(document) !== true,
    });
    this.conversation = new ProviderConversation(adapter, () => this.requestRefresh(), services);
    this.reveal = new ProviderReveal(() => this.adapter.readDiff(document), () => this.pageKey);
    this.hover = new ProviderHover(adapter, this.source, () => this.settings, () => this.catalog, {
      settingsForPage: (page) => {
        const config = this.configs?.get(page, this.settings, this.choices);
        return config?.status === 'loading' ? null : config?.settings ?? this.settings;
      },
    });
  }

  start(): void {
    document.documentElement.setAttribute('data-geld-provider', this.adapter.id);
    this.hover.start();
    if (typeof IntersectionObserver !== 'undefined') {
      this.rowObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!(entry.target instanceof HTMLElement)) continue;
          if (entry.isIntersecting) this.visibleRows.add(entry.target);
          else this.visibleRows.delete(entry.target);
        }
        this.requestRefresh();
      }, { rootMargin: '200px' });
    }
    this.observer = new MutationObserver((records) => {
      if (!this.headerHints.needsRepair() && records.every((record) => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (target?.closest('[data-geld-ui]')) return true;
        if (record.type === 'attributes' && record.attributeName?.startsWith('data-geld') === true) return true;
        if (record.type !== 'childList') return false;
        const nodes = [...record.addedNodes, ...record.removedNodes];
        return nodes.length > 0 && nodes.every((node) => node instanceof Element && node.hasAttribute('data-geld-ui'));
      })) return;
      this.reassertHeader();
      this.requestRefresh(false);
    });
    this.observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
    document.addEventListener('visibilitychange', this.visibility);
    document.addEventListener('click', this.nativeTreeClick, true);
    document.addEventListener('click', this.nativeInlineActivate, true);
    document.addEventListener('keydown', this.nativeInlineActivate, true);
    document.addEventListener('DiffFileMounted', this.refreshEvent);
    document.addEventListener(PROVIDER_LINE_FOLDS_CHANGED, this.refreshEvent);
    this.pulse = setInterval(() => this.requestRefresh(), 15_000);
    this.visibility();
  }

  private readonly refreshEvent = (): void => this.requestRefresh();
  private readonly nativeInlineActivate = (event: Event): void => {
    if (!event.isTrusted || this.stopped || this.grouped
      || (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ')) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target === null || target.closest('[data-geld-ui]') !== null) return;
    const entry = this.adapter.readDiff(document)?.entries.find((item) => item.root.contains(target));
    if (entry !== undefined && this.state.categories.some((category) => category.paths.includes(entry.path))) this.markInlineTouched(entry.path);
  };

  private markInlineTouched(path: string): void {
    if (this.expansionKey === null) return;
    const paths = this.inlineTouched.get(this.expansionKey) ?? new Set<string>();
    paths.add(path);
    this.inlineTouched.set(this.expansionKey, paths);
    this.collapsed.delete(path);
    if (this.inlineTouched.size > 100) {
      const oldest = this.inlineTouched.keys().next().value;
      if (oldest !== undefined) this.inlineTouched.delete(oldest);
    }
  }
  private readonly nativeTreeClick = (event: MouseEvent): void => {
    if (!event.isTrusted || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || this.stopped) return;
    const target = event.target instanceof Element ? event.target : null;
    const link = target?.closest<HTMLAnchorElement>('a[href]');
    if (link === null || link === undefined || link.closest('[data-geld-ui]') !== null) return;
    const row = this.adapter.readDiff(document)?.tree.find((item) => item.link === link);
    if (row === undefined) return;
    const page = this.adapter.describe(new URL(link.href, document.URL), document);
    if (page === null || providerDiffKey(page) !== this.pageKey) return;
    const key = this.pageKey;
    queueMicrotask(() => { if (!this.stopped && this.pageKey === key && !document.hidden) this.revealPath(row.path); });
  };
  private readonly visibility = (): void => {
    this.source.setActive(!document.hidden);
    this.configs?.setActive(!document.hidden);
    if (document.hidden) {
      this.reveal.clear();
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
    } else this.apply();
  };

  requestRefresh(invalidateHeader = true): void {
    if (invalidateHeader) this.settledHeader = null;
    if (this.stopped || document.hidden || this.timer !== null) return;
    this.timer = setTimeout(() => { this.timer = null; this.apply(); }, 60);
  }

  updateSettings(settings: GeldSettings): void {
    const layoutChanged = settings.groupHidden !== this.settings.groupHidden;
    const defaultChanged = settings.expandedByDefault !== this.settings.expandedByDefault;
    if (settings !== this.settings) { this.expansionChoices.clear(); this.inlineTouched.clear(); }
    this.settings = settings;
    if (defaultChanged) this.setExpanded(settings.expandedByDefault, false);
    if (layoutChanged) this.restorePage();
    this.requestRefresh();
  }

  updateCatalog(catalog: Catalog): void { this.expansionChoices.clear(); this.inlineTouched.clear(); this.catalog = catalog; this.configs?.setCatalog(catalog); this.requestRefresh(); }
  updateRepoChoices(choices: RepoConfigChoices): void { this.expansionChoices.clear(); this.inlineTouched.clear(); this.choices = choices; this.requestRefresh(); }
  getTabState(): TabState { return this.state; }

  toggleHidden(): void {
    if (!this.settings.shortcutEnabled) return;
    this.setExpanded(!this.expanded);
    this.apply();
  }

  revealPath(path: string): void {
    const category = this.state.categories.find((item) => item.paths.includes(path));
    if (!this.grouped) {
      if ((this.effectiveSettings ?? this.settings).groupHidden) this.setExpanded(category !== undefined);
      if (category !== undefined) this.markInlineTouched(path);
      this.apply();
      this.reveal.request(path);
      return;
    }
    this.activeCategory = category?.id ?? null;
    this.setExpanded(category !== undefined);
    this.apply();
    this.categoryTree.selectCategory(category?.id ?? 'essential');
    this.reveal.request(path);
  }

  async clearDiffCache(): Promise<void> {
    this.reveal.clear();
    this.restorePage();
    this.state = PROVIDER_IDLE_STATE;
    this.publish(this.state);
    await this.source.clearCache();
    this.requestRefresh();
  }

  stop(): void {
    this.stopped = true;
    this.observer?.disconnect();
    this.observer = null;
    this.rowObserver?.disconnect();
    this.rowObserver = null;
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.pulse !== null) clearInterval(this.pulse);
    document.removeEventListener('visibilitychange', this.visibility);
    document.removeEventListener('click', this.nativeTreeClick, true);
    document.removeEventListener('click', this.nativeInlineActivate, true);
    document.removeEventListener('keydown', this.nativeInlineActivate, true);
    document.removeEventListener('DiffFileMounted', this.refreshEvent);
    document.removeEventListener(PROVIDER_LINE_FOLDS_CHANGED, this.refreshEvent);
    this.hover.stop();
    this.reveal.stop();
    this.source.stop();
    this.configs?.stop();
    this.conversation.clear();
    this.hiddenAuthors.clear();
    this.restorePage();
    if (document.documentElement.getAttribute('data-geld-provider') === this.adapter.id) document.documentElement.removeAttribute('data-geld-provider');
    this.state = PROVIDER_IDLE_STATE;
  }

  private restorePage(preserveHeaderHover = false): void {
    this.settledHeader = null;
    this.effectiveSettings = null;
    for (const host of [...this.hoverCounts.keys()]) {
      if (!preserveHeaderHover || !this.headerHosts.has(host)) this.forgetHover(host);
    }
    if (!preserveHeaderHover) this.headerHosts.clear();
    clearProviderLineFolds();
    this.counts.restore();
    for (const node of this.touched) { node.removeAttribute(HIDDEN); node.removeAttribute(INLINE); }
    this.touched.clear();
    this.layout?.classList.remove('geld-provider-diffs');
    this.layout = null;
    this.grouped = false;
    this.syncFlowWrappers([]);
    const livePaths = new Map(this.adapter.readDiff(document)?.entries.map((entry) => [entry.root, entry.path]) ?? []);
    for (const entry of this.collapsed.values()) if (entry.root.isConnected && livePaths.get(entry.root) === entry.path) entry.expand();
    this.collapsed.clear();
    this.shownInline = new WeakMap();
    this.section?.remove();
    this.categoryTree.clear();
    this.inlineTree.clear();
    this.headerHints.clear();
    this.activeCategory = null;
    this.section = null;
    this.signature = '';
    for (const chip of this.chips) chip.remove();
    this.chips.clear();
  }

  private apply(): void {
    try { this.applyPage(); }
    finally { this.hover.refresh(); this.reveal.refresh(); }
  }

  private applyPage(): void {
    if (this.stopped || document.hidden) return;
    const page = this.adapter.describe(new URL(window.location.href), document);
    const key = page === null ? window.location.href : providerDiffKey(page);
    if (key !== this.pageKey) {
      this.listDemand = new WeakMap();
      this.hiddenAuthors.clear();
      this.reveal.clear();
      this.source.beginVisit(key);
      this.restorePage();
      this.pageKey = key;
      this.expansionKey = null;
      this.expanded = this.settings.expandedByDefault;
      this.viewed.clear();
    }
    const decision = page === null ? { allowed: true, rule: null } : decideRepo(compileRepoRules(this.settings.repoRules), providerRepositoryScope(page.repository));
    if (!this.settings.enabled || !decision.allowed) {
      this.reveal.clear();
      this.source.setActive(false);
      this.configs?.setActive(false);
      this.conversation.clear();
      this.hiddenAuthors.clear();
      this.restorePage();
      this.state = {
        ...PROVIDER_IDLE_STATE, allowed: false, rule: decision.rule?.raw ?? null, repo: page?.repository.path ?? null,
        ...(page === null ? {} : { repository: page.repository }),
      };
      this.publish(this.state);
      return;
    }
    this.source.setActive(true);
    this.configs?.setActive(true);
    const view = page === null ? null : this.adapter.readDiff(document);
    const targets = page === null ? [] : this.adapter.headerTargets(document);
    const hasPageSurface = page !== null && (view !== null || targets.length > 0 || this.adapter.reviewHost?.(document) != null || this.adapter.actionHost?.(document) != null);
    const config = page === null || !hasPageSurface ? null : this.configs?.get(page, this.settings, this.choices) ?? null;
    const effective = config?.settings ?? this.settings;
    this.effectiveSettings = effective;
    const matcher = createMatcher(effective, page === null ? null : providerRepositoryScope(page.repository), this.catalog);
    this.conversation.apply(page !== null && hasPageSurface && isProviderReviewPage(page) ? page : null, effective);
    if (page === null) {
      this.bindHeaders([], { stats: null, status: 'unavailable' });
      this.state = PROVIDER_IDLE_STATE;
      this.applyLists();
      this.publish(this.state);
      return;
    }
    if (!hasPageSurface) {
      this.bindHeaders([], { stats: null, status: 'unavailable' });
      this.state = { ...PROVIDER_IDLE_STATE, repository: page.repository, repo: page.repository.path, repoConfig: config?.tab ?? null, diffPageUrl: page.diffPageUrl, onDiffPage: page.kind === 'diff' || page.kind === 'commit' || page.kind === 'compare' };
      this.applyLists();
      this.publish(this.state);
      return;
    }
    const result = this.source.get(page, true, true, true);
    if (result.status !== 'ready' || config?.status === 'loading') {
      this.restorePage(true);
      this.bindHeaders(targets, {
        stats: null,
        status: result.status === 'loading' || config?.status === 'loading' ? 'loading' : 'unavailable',
        ...(result.status === 'failed' ? { reason: result.reason } : {}),
      });
      this.state = {
        ...PROVIDER_IDLE_STATE, repository: page.repository, repo: page.repository.path, repoConfig: config?.tab ?? null,
        diffPageUrl: page.diffPageUrl, onDiffPage: page.kind === 'diff' || page.kind === 'commit' || page.kind === 'compare',
      };
      this.publish(this.state);
      return;
    }
    const files = result.result.files;
    const { all, hidden } = breakdownFromFiles(files, matcher, effective.hideCommentLines, view?.filteredPaths);
    if (view !== null) applyProviderLineFolds(view, files.map((file) => {
      if (matcher.categorizeFile(file) === null && view.filteredPaths.has(file.path) === false) return file;
      const { commentLines, ...withoutComments } = file;
      void commentLines;
      return withoutComments;
    }), effective);
    const visible = subtractTotals(subtractTotals(all, hidden.totals), hidden.filtered);
    const expansionKey = JSON.stringify([key, result.result.revision]);
    if (this.expansionKey !== expansionKey) this.activeCategory = null;
    this.expansionKey = expansionKey;
    this.setExpanded(this.expansionChoices.get(expansionKey) ?? (effective.groupHidden && hidden.totals.files > 0 && visible.files === 0 || effective.expandedByDefault), false);
    const activeCategories = allCategories(effective, this.catalog).filter((category) => isCategoryEnabled(effective, category.id));
    const hintLabel = activeCategories.length === 0 ? null : hiddenLabel(hidden, activeCategories);
    this.headerHints.update(targets, hintLabel);
    this.bindHeaders(targets, {
      stats: statsBreakdown(all, hidden, hiddenNounPlural(activeCategories, hidden), activeCategories),
      status: result.provisional === true ? 'provisional' : 'ready',
    });
    this.writeHeaderCounts(targets, visible);
    if (view !== null) this.applyFiles(page, view, hidden, all, files, effective, result.result.revision);
    this.state = {
      repository: page.repository, repo: page.repository.path, repoConfig: config?.tab ?? null, allowed: true, rule: null,
      hasDiff: true, hiddenCount: hidden.totals.files, all, visible,
      categories: hidden.categories.map(({ category, paths }) => ({
        id: category.id, title: category.title, shortNoun: category.shortNoun, shortNounPlural: category.shortNounPlural,
        count: paths.length, paths,
      })),
      expanded: this.expanded, diffPageUrl: page.diffPageUrl, onDiffPage: page.kind === 'diff' || page.kind === 'commit' || page.kind === 'compare',
    };
    this.settledHeader = immutableProviderPage(page) && result.result.complete && result.provisional !== true ? {
      key, settings: this.settings, effective, catalog: this.catalog, choices: this.choices,
      config: this.state.repoConfig, visible, filtered: view === null ? null : JSON.stringify([...view.filteredPaths].sort()),
      headers: this.snapshotHeaders(targets),
      hintLabel,
    } : null;
    this.applyLists();
    this.publish(this.state);
  }

  /** Reassert only settled, immutable totals in the mutation microtask, before native remounts paint. */
  private reassertHeader(): void {
    const settled = this.settledHeader;
    if (settled === null || this.stopped || document.hidden || !this.settings.enabled || !this.state.allowed
      || !this.state.hasDiff || this.settings !== settled.settings || this.effectiveSettings !== settled.effective
      || this.catalog !== settled.catalog || this.choices !== settled.choices || this.state.repoConfig !== settled.config
      || this.state.visible !== settled.visible || this.pageKey !== settled.key) return;
    try {
      const targets = this.adapter.headerTargets(document);
      const headers = this.snapshotHeaders(targets);
      if (!this.headerHints.needsRepair() && headers.length === settled.headers.length && headers.every((header, index) => {
        const previous = settled.headers[index];
        return previous !== undefined && previous.values === header.values && previous.nodes.length === header.nodes.length
          && header.nodes.every((node, position) => node === previous.nodes[position]);
      })) return;
      const page = this.adapter.describe(new URL(window.location.href), document);
      if (page === null || !immutableProviderPage(page) || providerDiffKey(page) !== settled.key
        || !decideRepo(compileRepoRules(this.settings.repoRules), providerRepositoryScope(page.repository)).allowed) return;
      const view = this.adapter.readDiff(document);
      const filtered = view === null ? null : JSON.stringify([...view.filteredPaths].sort());
      if (filtered !== settled.filtered) return;
      this.headerHints.update(targets, settled.hintLabel);
      this.writeHeaderCounts(targets, settled.visible);
      this.settledHeader = { ...settled, headers: this.snapshotHeaders(targets) };
    } catch { /* Native SPA markup may be between subjects; wait for the normal validated pass. */ }
  }

  private snapshotHeaders(targets: readonly ProviderHeaderTarget[]): readonly HeaderSnapshot[] {
    return targets.map((target) => ({
      nodes: [target.additions, target.deletions, target.files, target.accessibleSummaryHost, ...(target.labels ?? []).map((label) => label.host)],
      values: JSON.stringify([
        target.additions?.textContent, target.deletions?.textContent, target.files?.textContent,
        target.accessibleSummaryHost?.querySelector('.geld-provider-accessible-counts')?.textContent,
        (target.labels ?? []).map((label) => [label.attribute, label.count, label.host.getAttribute(label.attribute)
          ?? (label.attribute === 'title' ? label.host.getAttribute('data-geld-hover-title') : null)]),
      ]),
    }));
  }

  private writeHeaderCounts(targets: readonly ProviderHeaderTarget[], visible: ChangeTotals): void {
    for (const target of targets) {
      this.counts.write(target.additions, visible.additions);
      this.counts.write(target.deletions, visible.deletions);
      this.counts.write(target.files, visible.files);
      if (target.accessibleSummaryHost !== undefined) this.counts.writeSummary(target.accessibleSummaryHost, visible);
      for (const label of target.labels ?? []) {
        if (label.count === 'lines') this.counts.writeLineAttribute(label.host, label.attribute, visible);
        else this.counts.writeAttribute(label.host, label.attribute, visible[label.count]);
      }
    }
  }

  private applyFiles(page: ProviderPage, view: ProviderDiffView, hidden: HiddenBreakdown, all: ChangeTotals, files: readonly FileStats[], effective: GeldSettings, revision: string): void {
    if (this.activeCategory !== null && !hidden.categories.some((group) => group.category.id === this.activeCategory)) {
      this.activeCategory = null;
      this.setExpanded(false, false);
    }
    const hiddenPaths = new Set(hidden.categories.flatMap((group) => group.paths));
    const categories = new Map(hidden.categories.flatMap((group) => group.paths.map((path) => [path, group.category] as const)));
    const sourcePaths = new Set(files.map((file) => file.path));
    for (const node of this.touched) {
      if (!node.isConnected) this.touched.delete(node);
    }
    if (this.layout !== view.container) {
      this.layout?.classList.remove('geld-provider-diffs');
      this.layout = view.container;
    }
    const grouped = effective.groupHidden && this.canGroup(view, files);
    this.grouped = grouped;
    this.syncFlowWrappers(grouped ? view.groupingWrappers ?? [] : []);
    if (view.container.classList.contains('geld-provider-diffs') !== grouped) view.container.classList.toggle('geld-provider-diffs', grouped);
    for (const entry of view.entries) {
      this.touched.add(entry.root);
      const hiddenFile = hiddenPaths.has(entry.path);
      const shown = this.expanded && (this.activeCategory === null || this.activeCategory === categories.get(entry.path)?.id);
      attribute(entry.root, HIDDEN, hiddenFile && grouped ? (shown ? 'open' : 'closed') : null);
      attribute(entry.root, INLINE, hiddenFile && !grouped ? '' : null);
      const ownedInline = !grouped && this.expansionKey !== null && this.inlineTouched.get(this.expansionKey)?.has(entry.path) === true;
      if (hiddenFile && !ownedInline && shown && this.shownInline.get(entry.root) !== entry.path) {
        if (entry.expand()) { this.shownInline.set(entry.root, entry.path); this.collapsed.delete(entry.path); }
      } else if (hiddenFile && !ownedInline && !grouped) {
        if (!shown && this.collapsed.get(entry.path)?.root !== entry.root && entry.isExpanded?.() === true) {
          if (entry.collapse()) this.collapsed.set(entry.path, entry);
        }
      }
      if (!hiddenFile && this.collapsed.has(entry.path)) {
        entry.expand();
        this.collapsed.delete(entry.path);
      }
      const category = categories.get(entry.path);
      const viewedKey = JSON.stringify([repositoryKey(page.repository), this.pageKey, revision, entry.path]);
      const attempt = this.viewed.get(viewedKey);
      if (category !== undefined && isAutoViewed(effective, category.id)) {
        const checked = entry.isViewed?.();
        if (checked === true && attempt?.confirmed !== true) this.viewed.set(viewedKey, { attempts: attempt?.attempts ?? 0, at: Date.now(), confirmed: true });
        else if (checked === false && attempt?.confirmed !== true
          && (attempt === undefined || (attempt.attempts < 8 && Date.now() - attempt.at >= Math.min(45_000, 1000 * 2 ** attempt.attempts)))
          && entry.markViewed?.() === true) this.viewed.set(viewedKey, { attempts: (attempt?.attempts ?? 0) + 1, at: Date.now(), confirmed: false });
      }
      if (!hiddenFile && !view.filteredPaths.has(entry.path) && sourcePaths.has(entry.path) && effective.expandLargeDiffs
        && entry.root.isConnected && entry.root.getAttribute('aria-disabled') !== 'true'
        && entry.root.closest('[hidden], [aria-hidden="true"], [inert]') === null
        && this.expandedLarge.get(entry.root)?.has(entry.path) !== true && entry.expandLargeDiff?.() === true) {
        const requested = this.expandedLarge.get(entry.root) ?? new Set<string>();
        requested.add(entry.path);
        this.expandedLarge.set(entry.root, requested);
      }
    }
    for (const row of view.tree) {
      this.touched.add(row.root);
      attribute(row.root, INLINE, !grouped && hiddenPaths.has(row.path) ? '' : null);
    }
    if (effective.groupHidden && (grouped || view.virtualized)) {
      this.inlineTree.clear();
      this.categoryTree.update(view, hidden, all, files, {
      subjectKey: JSON.stringify([this.pageKey, revision]),
      revealPath: (path) => this.revealPath(path),
      selectCategory: (id) => { this.activeCategory = id === 'essential' ? null : id; },
      setExpanded: (expanded) => { this.setExpanded(expanded); this.apply(); },
      });
    } else {
      this.categoryTree.clear();
      this.inlineTree.update(view, hidden, files, { subjectKey: JSON.stringify([this.pageKey, revision]) });
    }
    const signature = JSON.stringify([this.pageKey, revision, hidden.categories.map((group) => [group.category.id, group.category.title, group.category.shortNoun, group.category.shortNounPlural, group.paths, group.totals]), hidden.lines, all, this.expanded, grouped]);
    if (signature === this.signature && this.section?.isConnected === true) return;
    this.section?.remove();
    this.signature = signature;
    this.section = null;
    if (hidden.totals.files === 0 || !grouped) return;
    const section = element('section', '', 'geld-provider-hidden');
    const toggle = element('button', `${this.expanded ? 'Hide' : 'Show'} ${hiddenLabel(hidden, allCategories(effective, this.catalog).filter((category) => isCategoryEnabled(effective, category.id)))}`, 'geld-provider-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(this.expanded));
    toggle.addEventListener('click', () => { this.activeCategory = null; this.setExpanded(!this.expanded); this.apply(); });
    section.append(toggle, this.breakdown(hidden, all));
    view.container.append(section);
    this.section = section;
  }

  private canGroup(view: ProviderDiffView, files: readonly FileStats[]): boolean {
    if (view.virtualized) return false;
    const wrappers = view.groupingWrappers ?? [];
    if (wrappers.length === 0) return true;
    if (view.groupingReady !== true) return false;
    const paths = new Set(files.map((file) => file.path));
    if (view.entries.length !== paths.size || paths.size !== files.length
      || new Set(view.entries.map((entry) => entry.path)).size !== paths.size
      || view.entries.some((entry) => !paths.has(entry.path) || !entry.root.isConnected || !view.container.contains(entry.root))) return false;
    return wrappers.every((wrapper) => {
      if (!wrapper.isConnected || !view.container.contains(wrapper) || wrapper.closest('[hidden], [aria-hidden="true"], [inert]') !== null) return false;
      const style = getComputedStyle(wrapper);
      return (style.position === '' || style.position === 'static') && (style.transform === '' || style.transform === 'none')
        && (style.display === '' || ['block', 'inline', 'contents'].includes(style.display)) && style.visibility !== 'hidden' && style.visibility !== 'collapse';
    });
  }

  private syncFlowWrappers(wrappers: readonly HTMLElement[]): void {
    const current = new Set(wrappers);
    for (const [node, original] of this.flowWrappers) if (!current.has(node)) {
      if (node.getAttribute(FLOW_WRAPPER) === '') attribute(node, FLOW_WRAPPER, original);
      this.flowWrappers.delete(node);
    }
    for (const node of wrappers) {
      if (!this.flowWrappers.has(node)) this.flowWrappers.set(node, node.getAttribute(FLOW_WRAPPER));
      attribute(node, FLOW_WRAPPER, '');
    }
  }

  private breakdown(hidden: HiddenBreakdown, all: ChangeTotals | null): HTMLElement {
    const details = element('details', '', 'geld-provider-breakdown');
    details.append(element('summary', 'Line counts'));
    if (all !== null) details.append(element('div', `Total ${pluralize(all.files, 'file', 'files')} +${formatCount(all.additions)} −${formatCount(all.deletions)}`));
    for (const group of hidden.categories) details.append(element('div', `${group.category.title}: ${pluralize(group.totals.files, 'file', 'files')} +${formatCount(group.totals.additions)} −${formatCount(group.totals.deletions)}`));
    return details;
  }

  private applyLists(): void {
    for (const chip of this.chips) {
      if (chip.isConnected) continue;
      this.forgetHover(chip);
      this.chips.delete(chip);
    }
    const repoRules = compileRepoRules(this.settings.repoRules);
    const rows = this.adapter.listRows(document).flatMap((row) => {
      try {
        const page = this.adapter.describe(new URL(row.url, window.location.origin), document);
        return page === null ? [] : [{ row, page, allowed: decideRepo(repoRules, providerRepositoryScope(page.repository)).allowed }];
      } catch { return []; }
    });
    const authorHidden = this.hiddenAuthors.update(rows.filter((entry) => entry.allowed).map((entry) => entry.row), this.settings, this.pageKey);
    for (const { row, page, allowed } of rows) {
      const scope = providerRepositoryScope(page.repository);
      if (!allowed) {
        this.removeChip(row);
        continue;
      }
      const shouldHide = authorHidden.has(row.root);
      if (!this.settings.showListStats || shouldHide) { this.removeChip(row); continue; }
      if (this.rowObserver !== null) {
        if (!this.observedRows.has(row.root)) {
          this.observedRows.add(row.root);
          this.rowObserver.observe(row.root);
        }
        if (!this.visibleRows.has(row.root)) continue;
      }
      const demandKey = providerDiffKey(page);
      const demanded = this.adapter.eagerListDiffs?.(document) !== false || this.listDemand.get(row.root) === demandKey;
      const config = this.configs?.get(page, this.settings, this.choices, demanded);
      const matcher = createMatcher(config?.settings ?? this.settings, scope, this.catalog);
      const state = this.source.get(page, false, demanded);
      const chip = this.chip(row);
      const onIntent = (): void => {
        if (this.stopped || !this.settings.enabled || !this.settings.showListStats || !row.root.isConnected || !chip.isConnected
          || !decideRepo(compileRepoRules(this.settings.repoRules), scope).allowed
          || !this.adapter.listRows(document).some((current) => current.root === row.root && current.host === row.host && current.url === row.url)) return;
        this.listDemand.set(row.root, demandKey);
        this.source.get(page, true);
        this.configs?.get(page, this.settings, this.choices);
        this.requestRefresh();
      };
      if (state.status !== 'ready' || config?.status === 'loading') {
        const deferred = state.status === 'deferred' || (!demanded && config?.status === 'loading');
        this.bindHover(chip, {
          stats: null,
          status: deferred || state.status === 'loading' || config?.status === 'loading' ? 'loading' : 'unavailable',
          ...(state.status === 'failed' ? { reason: state.reason } : {}),
          onIntent,
        });
        const text = deferred ? 'Hover to count changes' : state.status === 'loading' || config?.status === 'loading' ? 'Counting changes…' : 'Changes unavailable';
        if (chip.textContent !== text) chip.textContent = text;
        this.hover.setTitle(chip, state.status === 'failed' ? state.reason : deferred ? 'Focus or hover to count changes.' : text);
        continue;
      }
      const { all, hidden } = breakdownFromFiles(state.result.files, matcher, (config?.settings ?? this.settings).hideCommentLines);
      const effective = config?.settings ?? this.settings;
      const activeCategories = allCategories(effective, this.catalog).filter((category) => isCategoryEnabled(effective, category.id));
      const cachedMessage = state.refreshError === undefined
        ? state.refreshing === true ? 'Cached counts. Updating…' : 'Cached counts. Hover or focus to refresh.'
        : `Cached counts. Refresh unavailable: ${state.refreshError.slice(0, 300)}`;
      this.bindHover(chip, {
        stats: statsBreakdown(all, hidden, hiddenNounPlural(activeCategories, hidden), activeCategories),
        status: state.provisional === true ? 'provisional' : state.refreshError === undefined ? 'ready' : 'unavailable',
        ...(state.provisional === true || state.refreshError !== undefined ? { reason: cachedMessage } : {}),
        onIntent,
      });
      const visible = subtractTotals(all, hidden.totals);
      const label = activeCategories.length === 0 ? null : hiddenLabel(hidden, activeCategories);
      const text = `${label === null ? '' : `${label} · `}+${formatCount(visible.additions)} −${formatCount(visible.deletions)}`;
      if (chip.textContent !== text) chip.replaceChildren(
        ...(label === null ? [] : [element('span', label, 'geld-provider-list-counts__hidden'), ' · ']),
        element('span', `+${formatCount(visible.additions)}`, 'geld-provider-list-counts__add'), ' ',
        element('span', `−${formatCount(visible.deletions)}`, 'geld-provider-list-counts__del'),
      );
      this.hover.setTitle(chip, `${state.provisional === true || state.refreshError !== undefined ? `${cachedMessage}\n` : ''}Essential: ${pluralize(visible.files, 'file', 'files')} +${visible.additions} −${visible.deletions}\nTotal: ${pluralize(all.files, 'file', 'files')} +${all.additions} −${all.deletions}`);
    }
  }

  private chip(row: ProviderListRow): HTMLElement {
    const existing = row.host.querySelector<HTMLElement>(':scope > .geld-provider-list-counts');
    if (existing !== null) return existing;
    const chip = element('span', '', 'geld-provider-list-counts');
    chip.setAttribute('role', 'status');
    row.host.append(chip);
    this.chips.add(chip);
    return chip;
  }

  private removeChip(row: ProviderListRow): void {
    const chip = row.host.querySelector<HTMLElement>(':scope > .geld-provider-list-counts');
    if (chip !== null) { this.forgetHover(chip); this.chips.delete(chip); chip.remove(); }
  }

  private bindHover(host: HTMLElement, counts: HoverCounts, keyboard?: boolean): void {
    const bound = this.hoverCounts.has(host);
    this.hoverCounts.set(host, counts);
    if (bound) return;
    this.hover.bindBreakdown(host, () => this.hoverCounts.get(host)?.stats ?? null, {
      onIntent: () => this.hoverCounts.get(host)?.onIntent?.(),
      anchor: () => this.hoverCounts.get(host)?.anchor?.() ?? null,
      ...(keyboard === undefined ? {} : { keyboard }),
      status: () => {
        const current = this.hoverCounts.get(host);
        return current === undefined ? { status: 'unavailable' } : { status: current.status, ...(current.reason === undefined ? {} : { reason: current.reason }) };
      },
    });
  }

  private bindHeaders(targets: readonly ProviderHeaderTarget[], counts: HoverCounts): void {
    const keyboard = new Set(targets.flatMap((target) => target.keyboardHoverHosts ?? []));
    const anchors = new Map<HTMLElement, HTMLElement>();
    for (const target of targets) {
      const hint = this.headerHints.forTarget(target);
      if (hint === null) continue;
      anchors.set(hint, hint);
      if (!(target.keyboardHoverHosts ?? []).some((host) => host.contains(hint))) keyboard.add(hint);
      for (const host of [target.additions, target.deletions, target.files, ...(target.hoverHosts ?? []), ...(target.keyboardHoverHosts ?? [])]) if (host !== null) anchors.set(host, hint);
    }
    const current = new Set(targets.flatMap((target) => [target.additions, target.deletions, target.files, ...(target.hoverHosts ?? []), ...(target.keyboardHoverHosts ?? [])]).filter((host): host is HTMLElement => host !== null && host.closest('[aria-hidden="true"], [inert]') === null));
    for (const host of anchors.values()) current.add(host);
    for (const host of this.headerHosts) {
      if (current.has(host)) continue;
      this.forgetHover(host);
      this.headerHosts.delete(host);
    }
    for (const host of current) {
      this.headerHosts.add(host);
      const anchor = anchors.get(host);
      this.bindHover(host, anchor === undefined ? counts : { ...counts, anchor: () => anchor }, keyboard.has(host) ? true : undefined);
    }
  }

  private forgetHover(host: HTMLElement): void {
    this.hover.unbindBreakdown(host);
    this.hoverCounts.delete(host);
  }

  private setExpanded(expanded: boolean, remember = true): void {
    if (remember && this.expansionKey !== null) {
      this.inlineTouched.delete(this.expansionKey);
      this.expansionChoices.delete(this.expansionKey);
      this.expansionChoices.set(this.expansionKey, expanded);
      if (this.expansionChoices.size > 100) {
        const oldest = this.expansionChoices.keys().next().value;
        if (oldest !== undefined) this.expansionChoices.delete(oldest);
      }
    }
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    this.collapsed.clear();
    this.shownInline = new WeakMap();
  }
}
