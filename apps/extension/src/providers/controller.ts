import type { Catalog, ChangeTotals, FileStats, GeldSettings } from '@geld/core';
import { allCategories, BUNDLED_CATALOG, compileAuthorRules, compileRepoRules, createMatcher, decideRepo, formatCount, isAutoViewed, isCategoryEnabled, LARGE_CHANGE_LINES, providerRepositoryScope, repositoryKey, subtractTotals } from '@geld/core';
import { breakdownFromFiles, hiddenLabel, hiddenNounPlural, statsBreakdown } from '../github/breakdown';
import type { HiddenBreakdown, StatsBreakdown } from '../github/breakdown';
import type { TabState } from '../lib/messages';
import { ProviderDiffSource, providerDiffKey } from './diff-source';
import { element, ProviderCounts } from './dom';
import { ProviderConversation } from './conversation';
import type { ProviderConversationServices } from './conversation';
import { ProviderHover } from './hover';
import { ProviderReveal } from './reveal';
import { applyProviderLineFolds, clearProviderLineFolds, PROVIDER_LINE_FOLDS_CHANGED } from './line-folds';
import { isProviderReviewPage } from './types';
import type { ProviderAdapter, ProviderDiffEntry, ProviderDiffView, ProviderHeaderTarget, ProviderListRow, ProviderPage } from './types';
import type { ProviderRepoConfigSource } from './repo-config';
import type { RepoConfigChoices } from '../lib/local-state';

const HIDDEN = 'data-geld-provider-hidden';
const INLINE = 'data-geld-provider-inline';

interface HoverCounts {
  readonly stats: StatsBreakdown | null;
  readonly status: 'loading' | 'unavailable' | 'provisional' | 'ready';
  readonly reason?: string;
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
  private state: TabState = PROVIDER_IDLE_STATE;
  private section: HTMLElement | null = null;
  private nav: HTMLElement | null = null;
  private layout: HTMLElement | null = null;
  private signature = '';
  private readonly touched = new Set<HTMLElement>();
  private readonly chips = new Set<HTMLElement>();
  private readonly collapsed = new Map<string, ProviderDiffEntry>();
  private readonly viewed = new Map<string, { readonly attempts: number; readonly at: number }>();
  private shownInline = new WeakMap<HTMLElement, string>();
  private readonly expandedLarge = new WeakMap<HTMLElement, string>();
  private readonly authors = new Map<HTMLElement, boolean>();
  private rowObserver: IntersectionObserver | null = null;
  private readonly observedRows = new WeakSet<HTMLElement>();
  private readonly visibleRows = new WeakSet<HTMLElement>();

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
    this.source = new ProviderDiffSource(adapter, () => this.requestRefresh());
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
      if (records.every((record) => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (target?.closest('[data-geld-ui]')) return true;
        if (record.type === 'attributes' && record.attributeName?.startsWith('data-geld') === true) return true;
        if (record.type !== 'childList') return false;
        const nodes = [...record.addedNodes, ...record.removedNodes];
        return nodes.length > 0 && nodes.every((node) => node instanceof Element && node.hasAttribute('data-geld-ui'));
      })) return;
      this.requestRefresh();
    });
    this.observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
    document.addEventListener('visibilitychange', this.visibility);
    document.addEventListener('DiffFileMounted', this.refreshEvent);
    document.addEventListener(PROVIDER_LINE_FOLDS_CHANGED, this.refreshEvent);
    this.pulse = setInterval(() => this.requestRefresh(), 15_000);
    this.visibility();
  }

  private readonly refreshEvent = (): void => this.requestRefresh();
  private readonly visibility = (): void => {
    this.source.setActive(!document.hidden);
    this.configs?.setActive(!document.hidden);
    if (document.hidden) {
      this.reveal.clear();
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
    } else this.apply();
  };

  requestRefresh(): void {
    if (this.stopped || document.hidden || this.timer !== null) return;
    this.timer = setTimeout(() => { this.timer = null; this.apply(); }, 60);
  }

  updateSettings(settings: GeldSettings): void {
    const layoutChanged = settings.groupHidden !== this.settings.groupHidden;
    const defaultChanged = settings.expandedByDefault !== this.settings.expandedByDefault;
    this.settings = settings;
    if (defaultChanged) this.setExpanded(settings.expandedByDefault);
    if (layoutChanged) this.restorePage();
    this.requestRefresh();
  }

  updateCatalog(catalog: Catalog): void { this.catalog = catalog; this.configs?.setCatalog(catalog); this.requestRefresh(); }
  updateRepoChoices(choices: RepoConfigChoices): void { this.choices = choices; this.requestRefresh(); }
  getTabState(): TabState { return this.state; }

  toggleHidden(): void {
    if (!this.settings.shortcutEnabled) return;
    this.setExpanded(!this.expanded);
    this.apply();
  }

  revealPath(path: string): void {
    this.setExpanded(true);
    this.apply();
    if (!this.expanded) { this.setExpanded(true); this.apply(); }
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
    document.removeEventListener('DiffFileMounted', this.refreshEvent);
    document.removeEventListener(PROVIDER_LINE_FOLDS_CHANGED, this.refreshEvent);
    this.hover.stop();
    this.reveal.stop();
    this.source.stop();
    this.configs?.stop();
    this.conversation.clear();
    this.restorePage();
    if (document.documentElement.getAttribute('data-geld-provider') === this.adapter.id) document.documentElement.removeAttribute('data-geld-provider');
    this.state = PROVIDER_IDLE_STATE;
  }

  private restorePage(preserveHeaderHover = false): void {
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
    const livePaths = new Map(this.adapter.readDiff(document)?.entries.map((entry) => [entry.root, entry.path]) ?? []);
    for (const entry of this.collapsed.values()) if (entry.root.isConnected && livePaths.get(entry.root) === entry.path) entry.expand();
    this.collapsed.clear();
    this.shownInline = new WeakMap();
    this.section?.remove();
    this.nav?.remove();
    this.section = null;
    this.nav = null;
    this.signature = '';
    for (const chip of this.chips) chip.remove();
    this.chips.clear();
    for (const [row, hidden] of this.authors) row.hidden = hidden;
    this.authors.clear();
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
      this.reveal.clear();
      this.source.beginVisit(key);
      this.restorePage();
      this.pageKey = key;
      this.expanded = this.settings.expandedByDefault;
      this.viewed.clear();
    }
    const decision = page === null ? { allowed: true, rule: null } : decideRepo(compileRepoRules(this.settings.repoRules), providerRepositoryScope(page.repository));
    if (!this.settings.enabled || !decision.allowed) {
      this.reveal.clear();
      this.source.setActive(false);
      this.configs?.setActive(false);
      this.conversation.clear();
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
    const result = this.source.get(page, true);
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
    const activeCategories = allCategories(effective, this.catalog).filter((category) => isCategoryEnabled(effective, category.id));
    this.bindHeaders(targets, {
      stats: statsBreakdown(all, hidden, hiddenNounPlural(activeCategories, hidden), activeCategories),
      status: result.provisional === true ? 'provisional' : 'ready',
    });
    for (const target of targets) {
      this.counts.write(target.additions, visible.additions);
      this.counts.write(target.deletions, visible.deletions);
      this.counts.write(target.files, visible.files);
      for (const label of target.labels ?? []) this.counts.writeAttribute(label.host, label.attribute, visible[label.count]);
    }
    if (view !== null) this.applyFiles(page, view, hidden, all, files);
    this.state = {
      repository: page.repository, repo: page.repository.path, repoConfig: config?.tab ?? null, allowed: true, rule: null,
      hasDiff: true, hiddenCount: hidden.totals.files, all, visible,
      categories: hidden.categories.map(({ category, paths }) => ({
        id: category.id, title: category.title, shortNoun: category.shortNoun, shortNounPlural: category.shortNounPlural,
        count: paths.length, paths,
      })),
      expanded: this.expanded, diffPageUrl: page.diffPageUrl, onDiffPage: page.kind === 'diff' || page.kind === 'commit' || page.kind === 'compare',
    };
    this.applyLists();
    this.publish(this.state);
  }

  private applyFiles(page: ProviderPage, view: ProviderDiffView, hidden: HiddenBreakdown, all: ChangeTotals, files: readonly FileStats[]): void {
    const hiddenPaths = new Set(hidden.categories.flatMap((group) => group.paths));
    const categories = new Map(hidden.categories.flatMap((group) => group.paths.map((path) => [path, group.category] as const)));
    const stats = new Map(files.map((file) => [file.path, file]));
    for (const node of this.touched) {
      if (!node.isConnected) this.touched.delete(node);
    }
    if (this.layout !== view.container) {
      this.layout?.classList.remove('geld-provider-diffs');
      this.layout = view.container;
    }
    if (this.settings.groupHidden && !view.virtualized && !view.container.classList.contains('geld-provider-diffs')) view.container.classList.add('geld-provider-diffs');
    for (const entry of view.entries) {
      this.touched.add(entry.root);
      const hiddenFile = hiddenPaths.has(entry.path);
      attribute(entry.root, HIDDEN, hiddenFile && this.settings.groupHidden && !view.virtualized ? (this.expanded ? 'open' : 'closed') : null);
      attribute(entry.root, INLINE, hiddenFile && (!this.settings.groupHidden || view.virtualized) ? '' : null);
      if (hiddenFile && this.expanded && this.shownInline.get(entry.root) !== entry.path) {
        if (entry.expand()) { this.shownInline.set(entry.root, entry.path); this.collapsed.delete(entry.path); }
      } else if (hiddenFile && (!this.settings.groupHidden || view.virtualized)) {
        if (!this.expanded && this.collapsed.get(entry.path)?.root !== entry.root && entry.isExpanded?.() === true) {
          if (entry.collapse()) this.collapsed.set(entry.path, entry);
        }
      }
      if (!hiddenFile && this.collapsed.has(entry.path)) {
        entry.expand();
        this.collapsed.delete(entry.path);
      }
      const category = categories.get(entry.path);
      const viewedKey = JSON.stringify([repositoryKey(page.repository), resultRevision(page), entry.path]);
      const attempt = this.viewed.get(viewedKey);
      if (category !== undefined && isAutoViewed(this.settings, category.id) && entry.isViewed?.() === false
        && (attempt === undefined || (attempt.attempts < 8 && Date.now() - attempt.at >= Math.min(45_000, 1000 * 2 ** attempt.attempts)))
        && entry.markViewed?.() === true) this.viewed.set(viewedKey, { attempts: (attempt?.attempts ?? 0) + 1, at: Date.now() });
      const file = stats.get(entry.path);
      if (!hiddenFile && this.settings.expandLargeDiffs && file !== undefined && file.additions + file.deletions >= LARGE_CHANGE_LINES
        && this.expandedLarge.get(entry.root) !== entry.path) {
        if (entry.isExpanded?.() === true || (entry.isExpanded?.() === false && entry.expand())) this.expandedLarge.set(entry.root, entry.path);
      }
    }
    for (const row of view.tree) {
      this.touched.add(row.root);
      attribute(row.root, INLINE, hiddenPaths.has(row.path) ? '' : null);
    }
    const signature = JSON.stringify([this.pageKey, hidden.categories.map((group) => [group.category.id, group.paths]), this.expanded, this.settings.groupHidden]);
    if (signature === this.signature && this.section?.isConnected === true && (view.treeHost === null || this.nav?.isConnected === true)) return;
    this.section?.remove();
    this.nav?.remove();
    this.signature = signature;
    this.section = null;
    this.nav = null;
    if (hidden.totals.files === 0) return;
    const section = element('section', '', 'geld-provider-hidden');
    const toggle = element('button', `${formatCount(hidden.totals.files)} files hidden`, 'geld-provider-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(this.expanded));
    toggle.addEventListener('click', () => { this.setExpanded(!this.expanded); this.apply(); });
    section.append(toggle, this.breakdown(hidden, all));
    view.container.append(section);
    this.section = section;
    if (view.treeHost !== null) {
      this.nav = element('nav', '', 'geld-provider-categories');
      this.nav.setAttribute('aria-label', 'Hidden files by category');
      for (const group of hidden.categories) {
        const details = element('details');
        details.append(element('summary', `${group.category.title} (${group.paths.length})`));
        for (const path of group.paths) {
          const button = element('button', path, 'geld-provider-file');
          button.type = 'button';
          button.addEventListener('click', () => this.revealPath(path));
          details.append(button);
        }
        this.nav.append(details);
      }
      view.treeHost.append(this.nav);
    }
  }

  private breakdown(hidden: HiddenBreakdown, all: ChangeTotals | null): HTMLElement {
    const details = element('details', '', 'geld-provider-breakdown');
    details.append(element('summary', 'Line counts'));
    if (all !== null) details.append(element('div', `Total ${all.files} files +${formatCount(all.additions)} −${formatCount(all.deletions)}`));
    for (const group of hidden.categories) details.append(element('div', `${group.category.title}: ${group.totals.files} files +${formatCount(group.totals.additions)} −${formatCount(group.totals.deletions)}`));
    return details;
  }

  private applyLists(): void {
    for (const chip of this.chips) {
      if (chip.isConnected) continue;
      this.forgetHover(chip);
      this.chips.delete(chip);
    }
    const rules = compileAuthorRules(this.settings.hiddenAuthors);
    const repoRules = compileRepoRules(this.settings.repoRules);
    for (const row of this.adapter.listRows(document)) {
      const page = this.adapter.describe(new URL(row.url, window.location.origin), document);
      if (page === null) continue;
      const scope = providerRepositoryScope(page.repository);
      if (!decideRepo(repoRules, scope).allowed) {
        this.removeChip(row);
        const original = this.authors.get(row.root);
        if (original !== undefined) row.root.hidden = original;
        continue;
      }
      const shouldHide = row.author !== null && rules.hides(row.author);
      if (!this.authors.has(row.root)) this.authors.set(row.root, row.root.hidden);
      const original = this.authors.get(row.root) ?? false;
      if (row.root.hidden !== (original || shouldHide)) row.root.hidden = original || shouldHide;
      if (!this.settings.showListStats || shouldHide) { this.removeChip(row); continue; }
      if (this.rowObserver !== null) {
        if (!this.observedRows.has(row.root)) {
          this.observedRows.add(row.root);
          this.rowObserver.observe(row.root);
        }
        if (!this.visibleRows.has(row.root)) continue;
      }
      const config = this.configs?.get(page, this.settings, this.choices);
      const matcher = createMatcher(config?.settings ?? this.settings, scope, this.catalog);
      const state = this.source.get(page);
      const chip = this.chip(row);
      if (state.status !== 'ready' || config?.status === 'loading') {
        this.bindHover(chip, {
          stats: null,
          status: state.status === 'loading' || config?.status === 'loading' ? 'loading' : 'unavailable',
          ...(state.status === 'failed' ? { reason: state.reason } : {}),
        });
        const text = state.status === 'loading' || config?.status === 'loading' ? 'Counting changes…' : 'Changes unavailable';
        if (chip.textContent !== text) chip.textContent = text;
        if (state.status === 'failed') chip.title = state.reason;
        continue;
      }
      const { all, hidden } = breakdownFromFiles(state.result.files, matcher, (config?.settings ?? this.settings).hideCommentLines);
      const effective = config?.settings ?? this.settings;
      const activeCategories = allCategories(effective, this.catalog).filter((category) => isCategoryEnabled(effective, category.id));
      this.bindHover(chip, {
        stats: statsBreakdown(all, hidden, hiddenNounPlural(activeCategories, hidden), activeCategories),
        status: state.provisional === true ? 'provisional' : 'ready',
      });
      const visible = subtractTotals(all, hidden.totals);
      const label = hiddenLabel(hidden, allCategories(this.settings, this.catalog).filter((category) => isCategoryEnabled(this.settings, category.id)));
      const text = `${hidden.totals.files > 0 ? `${label} · ` : ''}+${formatCount(visible.additions)} −${formatCount(visible.deletions)}`;
      if (chip.textContent !== text) chip.textContent = text;
      chip.title = `${state.provisional === true ? 'Cached counts. Updating…\n' : ''}Essential: ${visible.files} files +${visible.additions} −${visible.deletions}\nTotal: ${all.files} files +${all.additions} −${all.deletions}`;
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

  private bindHover(host: HTMLElement, counts: HoverCounts): void {
    const bound = this.hoverCounts.has(host);
    this.hoverCounts.set(host, counts);
    if (bound) return;
    this.hover.bindBreakdown(host, () => this.hoverCounts.get(host)?.stats ?? null, {
      status: () => {
        const current = this.hoverCounts.get(host);
        return current === undefined ? { status: 'unavailable' } : { status: current.status, ...(current.reason === undefined ? {} : { reason: current.reason }) };
      },
    });
  }

  private bindHeaders(targets: readonly ProviderHeaderTarget[], counts: HoverCounts): void {
    const current = new Set(targets.flatMap((target) => [target.additions, target.deletions, target.files, ...(target.hoverHosts ?? [])]).filter((host): host is HTMLElement => host !== null));
    for (const host of this.headerHosts) {
      if (current.has(host)) continue;
      this.forgetHover(host);
      this.headerHosts.delete(host);
    }
    for (const host of current) {
      this.headerHosts.add(host);
      this.bindHover(host, counts);
    }
  }

  private forgetHover(host: HTMLElement): void {
    this.hover.unbindBreakdown(host);
    this.hoverCounts.delete(host);
  }

  private setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    this.collapsed.clear();
    this.shownInline = new WeakMap();
  }
}

function resultRevision(page: ProviderPage): string { return `${page.headSha ?? ''}:${page.version}`; }
