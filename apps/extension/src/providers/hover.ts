import type { Catalog, ChangeTotals, GeldSettings } from '@geld/core';
import { allCategories, compileRepoRules, createMatcher, decideRepo, formatCount, isCategoryEnabled, pluralize, providerRepositoryScope } from '@geld/core';
import type { StatsBreakdown } from '../github/breakdown';
import { breakdownFromFiles, hiddenNounPlural, statsBreakdown } from '../github/breakdown';
import { lineIndex, mergeLineRects } from '../github/ui/tooltip';
import type { ProviderDiffSource, ProviderDiffState } from './diff-source';
import type { ProviderAdapter, ProviderPage } from './types';

export interface ProviderHoverOptions {
  readonly document?: Document;
  readonly settingsForPage?: (page: ProviderPage) => GeldSettings | null;
}

export interface ProviderHoverBindingOptions {
  readonly keyboard?: boolean;
  readonly onIntent?: () => void;
  readonly status?: () => { readonly status: 'loading' | 'unavailable' | 'provisional' | 'ready'; readonly reason?: string };
}

interface BoundBreakdown {
  readonly get: () => StatsBreakdown | null;
  readonly options: ProviderHoverBindingOptions;
  readonly addedTabIndex: boolean;
}

interface ActiveHover {
  readonly host: HTMLElement;
  readonly page: ProviderPage | null;
  readonly visit: string;
  ready: boolean;
  pointerY: number | null;
}

interface HeldTitle { readonly element: HTMLElement; original: string }
interface Rect { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }

export interface ProviderHoverPlacement {
  readonly left: number;
  readonly top: number;
  readonly maxHeight: number;
  readonly placement: 'above' | 'below';
  readonly caret: number;
}

const TOOLTIP_ID = 'geld-provider-count-tooltip';
const BOUND = 'data-geld-hover-bound';
const HELD_TITLE = 'data-geld-hover-title';
const ADDED_TABINDEX = 'data-geld-hover-tabindex';
const INTENT_MS = 150;
const MARGIN = 8;
const GAP = 8;
const MAX_WIDTH = 420;
const owners = new WeakMap<Document, ProviderHover>();

export function providerHoverPlacement(anchor: Rect, size: { readonly width: number; readonly height: number }, viewport: { readonly width: number; readonly height: number }, column: { readonly left: number; readonly right: number }): ProviderHoverPlacement {
  const minLeft = Math.max(MARGIN, column.left + MARGIN);
  const maxRight = Math.min(viewport.width - MARGIN, column.right - MARGIN);
  const width = Math.min(size.width, Math.max(0, maxRight - minLeft));
  const left = Math.max(minLeft, Math.min((anchor.left + anchor.right - width) / 2, maxRight - width));
  const below = Math.max(0, viewport.height - MARGIN - anchor.bottom - GAP);
  const above = Math.max(0, anchor.top - GAP - MARGIN);
  const placement = size.height <= below || below >= above ? 'below' : 'above';
  const maxHeight = placement === 'below' ? below : above;
  const height = Math.min(size.height, maxHeight);
  const top = placement === 'below' ? anchor.bottom + GAP : anchor.top - GAP - height;
  return {
    left, top: Math.max(MARGIN, Math.min(top, viewport.height - MARGIN - height)), maxHeight, placement,
    caret: Math.max(12, Math.min((anchor.left + anchor.right) / 2 - left, Math.max(12, width - 12))),
  };
}

function elementOf(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
}

function tokens(element: Element, attribute: string): readonly string[] {
  return (element.getAttribute(attribute) ?? '').split(/\s+/).filter((value) => value !== '');
}

export class ProviderHover {
  private readonly doc: Document;
  private readonly bindings = new Map<HTMLElement, BoundBreakdown>();
  private readonly titles = new Map<HTMLElement, HeldTitle>();
  private active: ActiveHover | null = null;
  private tooltip: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private observer: MutationObserver | null = null;
  private started = false;
  private pointerHost: HTMLElement | null = null;
  private focusHost: HTMLElement | null = null;
  private pointerOnTooltip = false;
  private dismissed: HTMLElement | null = null;
  private signature = '';

  constructor(
    private readonly adapter: ProviderAdapter,
    private readonly source: Pick<ProviderDiffSource, 'get'>,
    private readonly settings: () => GeldSettings,
    private readonly catalog: () => Catalog,
    private readonly options: ProviderHoverOptions = {},
  ) { this.doc = options.document ?? document; }

  start(): void {
    if (this.started) return;
    owners.get(this.doc)?.stop();
    owners.set(this.doc, this);
    this.removeOrphans();
    this.started = true;
    for (const [host, binding] of this.bindings) {
      host.setAttribute(BOUND, '');
      host.classList.add('geld-provider-hover-anchor');
      if (binding.addedTabIndex && !host.hasAttribute('tabindex')) {
        host.setAttribute('tabindex', '0');
        host.setAttribute(ADDED_TABINDEX, '');
      }
    }
    this.doc.addEventListener('mouseover', this.onMouseOver, true);
    this.doc.addEventListener('mouseout', this.onMouseOut, true);
    this.doc.addEventListener('focusin', this.onFocusIn, true);
    this.doc.addEventListener('focusout', this.onFocusOut, true);
    this.doc.addEventListener('keydown', this.onKeyDown, true);
    this.doc.addEventListener('visibilitychange', this.onVisibility);
    this.doc.addEventListener('scroll', this.onPosition, { capture: true, passive: true });
    this.doc.defaultView?.addEventListener('resize', this.onPosition, { passive: true });
    for (const event of ['popstate', 'hashchange', 'wxt:locationchange']) this.doc.defaultView?.addEventListener(event, this.onNavigation);
    for (const event of ['turbo:load', 'soft-nav:end']) this.doc.addEventListener(event, this.onNavigation);
  }

  stop(): void {
    this.close();
    this.started = false;
    this.doc.removeEventListener('mouseover', this.onMouseOver, true);
    this.doc.removeEventListener('mouseout', this.onMouseOut, true);
    this.doc.removeEventListener('focusin', this.onFocusIn, true);
    this.doc.removeEventListener('focusout', this.onFocusOut, true);
    this.doc.removeEventListener('keydown', this.onKeyDown, true);
    this.doc.removeEventListener('visibilitychange', this.onVisibility);
    this.doc.removeEventListener('scroll', this.onPosition, true);
    this.doc.defaultView?.removeEventListener('resize', this.onPosition);
    for (const event of ['popstate', 'hashchange', 'wxt:locationchange']) this.doc.defaultView?.removeEventListener(event, this.onNavigation);
    for (const event of ['turbo:load', 'soft-nav:end']) this.doc.removeEventListener(event, this.onNavigation);
    for (const host of [...this.bindings.keys()]) this.unbindBreakdown(host);
    this.tooltip?.remove();
    this.tooltip = null;
    this.pointerHost = null;
    this.focusHost = null;
    this.dismissed = null;
    if (owners.get(this.doc) === this) owners.delete(this.doc);
  }

  bindBreakdown(host: HTMLElement, get: () => StatsBreakdown | null, options: ProviderHoverBindingOptions = {}): () => void {
    const previous = this.bindings.get(host);
    const keyboard = options.keyboard ?? host.hasAttribute('data-geld-ui');
    if (previous?.addedTabIndex && !keyboard) {
      if (host.getAttribute('tabindex') === '0') host.removeAttribute('tabindex');
      host.removeAttribute(ADDED_TABINDEX);
    }
    const addedTabIndex = keyboard && (previous?.addedTabIndex === true || !host.hasAttribute('tabindex'));
    const binding: BoundBreakdown = { get, options, addedTabIndex };
    this.bindings.set(host, binding);
    host.setAttribute(BOUND, '');
    host.classList.add('geld-provider-hover-anchor');
    if (addedTabIndex && !host.hasAttribute('tabindex')) {
      host.setAttribute('tabindex', '0');
      host.setAttribute(ADDED_TABINDEX, '');
    }
    if (this.active?.host === host) this.refresh();
    return () => { if (this.bindings.get(host) === binding) this.unbindBreakdown(host); };
  }

  unbindBreakdown(host: HTMLElement): void {
    const binding = this.bindings.get(host);
    if (binding === undefined) return;
    if (this.active?.host === host) this.close();
    this.bindings.delete(host);
    host.removeAttribute(BOUND);
    host.classList.remove('geld-provider-hover-anchor');
    if (binding.addedTabIndex && host.getAttribute('tabindex') === '0') host.removeAttribute('tabindex');
    host.removeAttribute(ADDED_TABINDEX);
  }

  update(): void { this.refresh(); }

  setTitle(host: HTMLElement, title: string): void {
    const held = this.titles.get(host);
    if (held !== undefined) {
      held.original = title;
      if (host.getAttribute(HELD_TITLE) !== title) host.setAttribute(HELD_TITLE, title);
      host.removeAttribute('title');
    } else if (host.getAttribute('title') !== title) host.setAttribute('title', title);
  }

  refresh(): void {
    for (const host of this.bindings.keys()) if (!host.isConnected) this.unbindBreakdown(host);
    const active = this.active;
    if (active === null) return;
    if (!this.valid(active) || this.nativeOverlay(active.host)) { this.close(); return; }
    this.holdTitles(active.host);
    if (active.ready) this.render();
  }

  private visit(): string {
    try {
      const url = new URL(this.doc.URL);
      const page = this.adapter.describe(url, this.doc);
      return JSON.stringify([url.href, page?.headSha ?? '', page?.version ?? '']);
    } catch { return this.doc.URL; }
  }

  private valid(active: ActiveHover): boolean {
    return this.started && !this.doc.hidden && this.settings().enabled && active.host.isConnected && active.visit === this.visit()
      && active.host.closest('[hidden], [aria-hidden="true"], [inert]') === null
      && (!active.ready || active.host.getClientRects().length > 0 || active.host.getBoundingClientRect().width > 0);
  }

  private nativeOverlay(host: HTMLElement): boolean {
    let element: HTMLElement | null = host;
    for (let depth = 0; element !== null && element !== this.doc.body && depth < 4; depth += 1, element = element.parentElement) {
      if (tokens(element, 'aria-describedby').some((id) => {
        if (id === TOOLTIP_ID) return false;
        const node = this.doc.getElementById(id);
        return node === null || node.matches('[role="tooltip"], [role="dialog"], [popover]') || node.querySelector('[role="tooltip"], [role="dialog"], [popover]') !== null;
      })) return true;
    }
    return false;
  }

  private candidate(target: EventTarget | null): { readonly host: HTMLElement; readonly page: ProviderPage | null } | null {
    const element = elementOf(target);
    if (element === null || element.closest('.geld-provider-hover') !== null) return null;
    const bound = element.closest<HTMLElement>(`[${BOUND}]`);
    if (bound !== null && this.bindings.has(bound)) return { host: bound, page: null };
    const anchor = element.closest<HTMLAnchorElement>('a[href]');
    if (anchor === null || anchor.closest('[data-geld-ui]') !== null) return null;
    try {
      const url = new URL(anchor.href, this.doc.URL);
      const current = new URL(this.doc.URL);
      if (url.origin !== current.origin || url.pathname === current.pathname || url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
      const page = this.adapter.describe(url, this.doc);
      if (page === null || page.provider !== this.adapter.id || page.kind === 'other') return null;
      const settings = this.settings();
      if (!settings.enabled || !settings.showListStats || !decideRepo(compileRepoRules(settings.repoRules), providerRepositoryScope(page.repository)).allowed) return null;
      return { host: anchor, page };
    } catch { return null; }
  }

  private begin(host: HTMLElement, page: ProviderPage | null, pointerY: number | null): void {
    if (!this.started || this.doc.hidden || !this.settings().enabled || host === this.dismissed || this.nativeOverlay(host)) return;
    if (this.active?.host === host) {
      this.active.pointerY = pointerY;
      if (this.active.ready) this.position();
      return;
    }
    this.close();
    const active: ActiveHover = { host, page, visit: this.visit(), ready: false, pointerY };
    this.active = active;
    this.holdTitles(host);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.active !== active || !this.valid(active) || this.nativeOverlay(host)) { this.close(); return; }
      active.ready = true;
      if (active.page === null) this.bindings.get(host)?.options.onIntent?.();
      this.watch();
      this.render();
    }, INTENT_MS);
  }

  private holdTitles(host: HTMLElement): void {
    let node: HTMLElement | null = host;
    for (let depth = 0; node !== null && node !== this.doc.body && depth < 4; depth += 1, node = node.parentElement) {
      const title = node.getAttribute('title');
      if (title === null) continue;
      const held = this.titles.get(node);
      if (held === undefined) this.titles.set(node, { element: node, original: title });
      else held.original = title;
      node.setAttribute(HELD_TITLE, title);
      node.removeAttribute('title');
    }
  }

  private describe(host: HTMLElement, show: boolean): void {
    const ids = tokens(host, 'aria-describedby').filter((id) => id !== TOOLTIP_ID);
    if (show) ids.push(TOOLTIP_ID);
    const next = ids.join(' ');
    if (next === '') host.removeAttribute('aria-describedby');
    else if (host.getAttribute('aria-describedby') !== next) host.setAttribute('aria-describedby', next);
  }

  private close(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.observer?.disconnect();
    this.observer = null;
    if (this.active !== null) this.describe(this.active.host, false);
    this.active = null;
    if (this.tooltip !== null) this.tooltip.hidden = true;
    this.signature = '';
    this.pointerOnTooltip = false;
    for (const held of this.titles.values()) {
      if (!held.element.hasAttribute('title')) held.element.setAttribute('title', held.original);
      held.element.removeAttribute(HELD_TITLE);
    }
    this.titles.clear();
  }

  private removeOrphans(): void {
    const previous = this.doc.getElementById(TOOLTIP_ID);
    if (previous?.hasAttribute('data-geld-ui')) previous.remove();
    for (const host of this.doc.querySelectorAll<HTMLElement>(`[aria-describedby~="${TOOLTIP_ID}"]`)) this.describe(host, false);
    for (const element of this.doc.querySelectorAll<HTMLElement>(`[${HELD_TITLE}]`)) {
      const title = element.getAttribute(HELD_TITLE);
      if (!element.hasAttribute('title') && title !== null) element.setAttribute('title', title);
      element.removeAttribute(HELD_TITLE);
    }
    for (const element of this.doc.querySelectorAll<HTMLElement>(`[${BOUND}]`)) {
      if (this.bindings.has(element)) continue;
      element.removeAttribute(BOUND);
      element.classList.remove('geld-provider-hover-anchor');
      if (element.hasAttribute(ADDED_TABINDEX)) {
        if (element.getAttribute('tabindex') === '0') element.removeAttribute('tabindex');
        element.removeAttribute(ADDED_TABINDEX);
      }
    }
  }

  private node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
    const node = this.doc.createElement(tag);
    node.setAttribute('data-geld-ui', '');
    node.className = className;
    node.textContent = text;
    return node;
  }

  private box(): HTMLElement {
    if (this.tooltip !== null && this.tooltip.isConnected) return this.tooltip;
    const node = this.node('div', '', 'geld-provider-hover');
    node.id = TOOLTIP_ID;
    node.setAttribute('role', 'tooltip');
    node.setAttribute('aria-live', 'polite');
    this.doc.body.append(node);
    this.tooltip = node;
    return node;
  }

  private show(stats: StatsBreakdown | null, message: string | null): void {
    const box = this.box();
    const signature = JSON.stringify([stats, message]);
    if (signature !== this.signature) {
      const contents: Node[] = [];
      if (message !== null) contents.push(this.node('p', message, 'geld-provider-hover__message'));
      if (stats !== null) {
        const rows = this.node('div', '', 'geld-provider-hover__rows');
        const addRow = (label: string, totals: ChangeTotals): void => {
          const row = this.node('div', '', 'geld-provider-hover__row');
          row.append(
            this.node('span', label, 'geld-provider-hover__label'), ' ',
            this.node('span', totals.files === 0 && totals.additions + totals.deletions > 0 ? '' : pluralize(totals.files, 'file', 'files'), 'geld-provider-hover__files'), ' ',
            this.node('span', `+${formatCount(totals.additions)}`, 'geld-provider-hover__add'), ' ',
            this.node('span', `−${formatCount(totals.deletions)}`, 'geld-provider-hover__del'), ' ',
          );
          rows.append(row);
        };
        addRow('Essential', stats.visible);
        for (const category of stats.categories) addRow(category.category.title, category.totals);
        if (stats.lines.additions + stats.lines.deletions > 0) addRow('Comments', { files: 0, ...stats.lines });
        if (stats.filtered.files > 0) addRow('Filtered files', stats.filtered);
        if (stats.categories.length === 0 && stats.lines.additions + stats.lines.deletions === 0) addRow(stats.emptyTitle, stats.hidden);
        const rule = this.node('span', '', 'geld-provider-hover__rule');
        rule.setAttribute('role', 'separator');
        rows.append(rule);
        addRow('Total', stats.all);
        contents.push(rows);
      }
      box.replaceChildren(...contents);
      this.signature = signature;
    }
    box.hidden = false;
    if (this.active !== null) this.describe(this.active.host, true);
    this.position();
  }

  private render(): void {
    const active = this.active;
    if (active === null || !active.ready) return;
    if (!this.valid(active) || this.nativeOverlay(active.host)) { this.close(); return; }
    if (active.page === null) {
      const binding = this.bindings.get(active.host);
      if (binding === undefined) { this.close(); return; }
      const status = binding.options.status?.();
      const stats = binding.get();
      const message = status?.status === 'loading' ? 'Counting changes…' : status?.status === 'provisional' ? status.reason ?? 'Cached counts. Updating…' : status?.status === 'unavailable' ? status.reason ?? 'Counts unavailable' : stats === null ? 'Counts unavailable' : null;
      this.show(stats, message);
      return;
    }
    const settings = this.options.settingsForPage === undefined ? this.settings() : this.options.settingsForPage(active.page);
    if (settings === null) { this.show(null, 'Reading repository settings…'); return; }
    if (!settings.enabled || !settings.showListStats || !decideRepo(compileRepoRules(settings.repoRules), providerRepositoryScope(active.page.repository)).allowed) { this.close(); return; }
    const state: ProviderDiffState = this.source.get(active.page, true);
    if (state.status === 'loading' || state.status === 'deferred') { this.show(null, 'Counting changes…'); return; }
    if (state.status === 'failed') { this.show(null, `Counts unavailable: ${state.reason.slice(0, 300)}`); return; }
    if (!state.result.complete) { this.show(null, 'Counts unavailable: the diff is incomplete'); return; }
    const matcher = createMatcher(settings, providerRepositoryScope(active.page.repository), this.catalog());
    const { all, hidden } = breakdownFromFiles(state.result.files, matcher, settings.hideCommentLines);
    const categories = allCategories(settings, this.catalog()).filter((category) => isCategoryEnabled(settings, category.id));
    const breakdown = statsBreakdown(all, hidden, hiddenNounPlural(categories, hidden), categories);
    this.show(breakdown, state.refreshError !== undefined ? `Counts may be out of date: ${state.refreshError.slice(0, 300)}` : state.provisional ? state.refreshing === true ? 'Cached counts. Updating…' : 'Cached counts. Refresh pending.' : null);
  }

  private watch(): void {
    const view = this.doc.defaultView;
    if (view === null || this.observer !== null) return;
    this.observer = new view.MutationObserver((records) => {
      if (records.every((record) => elementOf(record.target)?.closest('.geld-provider-hover') !== null)) return;
      const active = this.active;
      if (active !== null && (!this.valid(active) || this.nativeOverlay(active.host))) this.close();
    });
    this.observer.observe(this.doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-describedby', 'hidden', 'aria-hidden', 'inert'] });
  }

  private column(host: HTMLElement, width: number): { readonly left: number; readonly right: number } {
    let parent = host.parentElement;
    while (parent !== null && parent !== this.doc.body) {
      const rect = parent.getBoundingClientRect();
      if (rect.width >= Math.min(320, width - MARGIN * 2) || (parent.matches('main, [role="main"], article, section') && rect.width > MARGIN * 4)) return { left: rect.left, right: rect.right };
      parent = parent.parentElement;
    }
    return { left: 0, right: width };
  }

  private position(): void {
    const active = this.active;
    const box = this.tooltip;
    const view = this.doc.defaultView;
    if (active === null || box === null || box.hidden || view === null) return;
    const width = this.doc.documentElement.clientWidth || view.innerWidth;
    const height = this.doc.documentElement.clientHeight || view.innerHeight;
    const rects = mergeLineRects([...active.host.getClientRects()]);
    const rect = rects[lineIndex(rects, active.pointerY)] ?? active.host.getBoundingClientRect();
    const column = this.column(active.host, width);
    const available = Math.max(0, Math.min(width - MARGIN, column.right - MARGIN) - Math.max(MARGIN, column.left + MARGIN));
    if (available < 48 || rect.bottom < 0 || rect.top > height) { this.close(); return; }
    const measuredWidth = Math.min(MAX_WIDTH, available);
    box.style.width = `${measuredWidth}px`;
    box.style.maxHeight = `${Math.max(0, height - MARGIN * 2)}px`;
    const size = box.getBoundingClientRect();
    const placement = providerHoverPlacement(rect, { width: size.width || measuredWidth, height: size.height }, { width, height }, column);
    box.style.left = `${placement.left}px`;
    box.style.top = `${placement.top}px`;
    box.style.maxHeight = `${placement.maxHeight}px`;
    box.style.setProperty('--geld-provider-hover-caret', `${placement.caret}px`);
    box.dataset.placement = placement.placement;
  }

  private readonly onMouseOver = (event: MouseEvent): void => {
    const target = elementOf(event.target);
    if (target !== null && this.tooltip?.contains(target)) { this.pointerOnTooltip = true; return; }
    this.pointerOnTooltip = false;
    const candidate = this.candidate(event.target);
    this.pointerHost = candidate?.host ?? null;
    if (candidate !== null) this.begin(candidate.host, candidate.page, event.clientY);
  };

  private readonly onMouseOut = (event: MouseEvent): void => {
    const target = elementOf(event.target);
    const next = elementOf(event.relatedTarget);
    const active = this.active;
    if (this.dismissed !== null && target !== null && this.dismissed.contains(target) && (next === null || !this.dismissed.contains(next))) this.dismissed = null;
    if (active === null) return;
    if (next !== null && active.host.contains(next)) return;
    if (next !== null && this.tooltip?.contains(next)) { this.pointerOnTooltip = true; this.pointerHost = null; return; }
    if (target !== null && (active.host.contains(target) || this.tooltip?.contains(target))) {
      this.pointerHost = null;
      this.pointerOnTooltip = false;
      if (this.focusHost !== active.host) this.close();
    }
  };

  private readonly onFocusIn = (event: FocusEvent): void => {
    const candidate = this.candidate(event.target);
    this.focusHost = candidate?.host ?? null;
    if (candidate !== null) this.begin(candidate.host, candidate.page, null);
  };

  private readonly onFocusOut = (event: FocusEvent): void => {
    const next = elementOf(event.relatedTarget);
    const host = this.focusHost;
    if (host !== null && next !== null && host.contains(next)) return;
    this.focusHost = null;
    if (host === this.dismissed) this.dismissed = null;
    if (this.active !== null && this.pointerHost !== this.active.host && !this.pointerOnTooltip) this.close();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.active === null) return;
    this.dismissed = this.active.host;
    this.close();
  };

  private readonly onVisibility = (): void => { if (this.doc.hidden) this.close(); };
  private readonly onPosition = (): void => { if (this.active !== null) this.valid(this.active) ? this.position() : this.close(); };
  private readonly onNavigation = (): void => { this.dismissed = null; this.close(); };
}
