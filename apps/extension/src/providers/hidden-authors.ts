import { compileAuthorRules, formatCount, pluralize } from '@geld/core';
import type { GeldSettings } from '@geld/core';
import type { ProviderListRow, ReviewProvider } from './types';

export const PROVIDER_AUTHOR_HIDDEN = 'data-geld-provider-author-hidden';
const NOTE = 'data-geld-provider-author-note';

interface Bucket {
  readonly rows: ProviderListRow[];
  readonly authors: Map<string, string>;
}

interface Notice {
  readonly root: HTMLElement;
  readonly label: HTMLElement;
  readonly button: HTMLButtonElement;
  readonly context: string;
  rows: readonly ProviderListRow[];
  readonly tableCell: HTMLTableCellElement | null;
  tableRow: HTMLElement | null;
  spanKey: string;
  spanCells: readonly HTMLTableCellElement[];
}

export class ProviderHiddenAuthors {
  private context: string | null = null;
  private shown = new WeakSet<HTMLElement>();
  private readonly managed = new Set<HTMLElement>();
  private readonly notices = new Map<HTMLElement, Notice>();
  private listeningForResize = false;

  constructor(
    private readonly provider: ReviewProvider,
    private readonly onReveal: (roots: readonly HTMLElement[]) => void = () => undefined,
    private readonly doc: Document = document,
  ) {}

  update(rows: readonly ProviderListRow[], settings: Pick<GeldSettings, 'enabled' | 'hiddenAuthors'>, visitKey: string): ReadonlySet<HTMLElement> {
    const context = JSON.stringify([visitKey, settings.hiddenAuthors]);
    if (!settings.enabled) { this.clear(); return new Set(); }
    if (this.context !== context) { this.clear(); this.context = context; }
    const rules = compileAuthorRules(settings.hiddenAuthors);
    const buckets = new Map<HTMLElement, Bucket>();
    const seen = new Set<HTMLElement>();
    const hidden = new Set<HTMLElement>();
    for (const row of rows) {
      const list = row.root.parentElement;
      if (seen.has(row.root) || list === null || !row.root.isConnected || row.root.ownerDocument !== this.doc || !row.root.contains(row.host)
        || row.root.closest('[data-geld-ui], [hidden], [aria-hidden="true"], [inert]') !== null || row.author === null
        || row.author.trim() === '' || /\s/.test(row.author) || !rules.hides(row.author) || this.shown.has(list)) continue;
      seen.add(row.root);
      const bucket = buckets.get(list) ?? { rows: [], authors: new Map<string, string>() };
      bucket.rows.push(row);
      const authorName = row.authorName === undefined ? row.author : row.authorName?.trim() || 'Unknown account';
      if (!bucket.authors.has(row.author.toLowerCase())) bucket.authors.set(row.author.toLowerCase(), authorName);
      buckets.set(list, bucket);
      hidden.add(row.root);
    }
    for (const root of this.managed) {
      if (hidden.has(root)) continue;
      root.removeAttribute(PROVIDER_AUTHOR_HIDDEN);
      this.managed.delete(root);
    }
    for (const root of hidden) {
      if (!root.hasAttribute(PROVIDER_AUTHOR_HIDDEN)) root.setAttribute(PROVIDER_AUTHOR_HIDDEN, '');
      this.managed.add(root);
    }
    for (const [list, notice] of this.notices) {
      if (buckets.has(list)) continue;
      notice.root.remove();
      this.notices.delete(list);
    }
    for (const [list, bucket] of buckets) {
      let notice = this.notices.get(list);
      if (notice === undefined) {
        notice = this.notice(list, context, bucket.rows);
        this.notices.set(list, notice);
      }
      notice.rows = bucket.rows;
      this.updateColspan(notice);
      const authors = [...bucket.authors.values()].sort();
      const names = authors.length > 3 ? `${authors.slice(0, 3).join(', ')} and ${formatCount(authors.length - 3)} more` : authors.join(', ');
      const requests = pluralize(bucket.rows.length, this.provider === 'gitlab' ? 'merge request' : 'pull request', this.provider === 'gitlab' ? 'merge requests' : 'pull requests');
      const text = `${requests} by ${names} hidden`;
      if (notice.label.textContent !== text) notice.label.textContent = text;
      const label = `Show ${requests} hidden by author filters`;
      if (notice.button.getAttribute('aria-label') !== label) notice.button.setAttribute('aria-label', label);
      const first = bucket.rows[0]?.root;
      if (first !== undefined && first.parentElement === list && (notice.root.parentElement !== list || notice.root.nextElementSibling !== first)) list.insertBefore(notice.root, first);
    }
    this.syncResizeListener();
    return hidden;
  }

  clear(): void {
    for (const root of this.managed) root.removeAttribute(PROVIDER_AUTHOR_HIDDEN);
    this.managed.clear();
    for (const notice of this.notices.values()) notice.root.remove();
    this.notices.clear();
    this.syncResizeListener();
    this.shown = new WeakSet();
    this.context = null;
  }

  private node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
    const node = this.doc.createElement(tag);
    node.setAttribute('data-geld-ui', '');
    node.className = className;
    node.textContent = text;
    return node;
  }

  private notice(list: HTMLElement, context: string, rows: readonly ProviderListRow[]): Notice {
    const content = this.node('div', 'geld-provider-hidden-authors');
    content.setAttribute('role', 'note');
    const label = this.node('span', 'geld-provider-hidden-authors__text');
    const button = this.node('button', 'geld-provider-hidden-authors__show', 'Show');
    button.type = 'button';
    content.append(label, button);
    let root: HTMLElement = content;
    let tableCell: HTMLTableCellElement | null = null;
    if (list.tagName === 'UL' || list.tagName === 'OL') {
      root = this.node('li', 'geld-provider-hidden-authors__item');
      root.setAttribute('role', 'listitem');
      root.append(content);
    } else if (['TABLE', 'TBODY', 'THEAD', 'TFOOT'].includes(list.tagName) && rows[0]?.root.tagName === 'TR') {
      const wrapper = this.node('tr', 'geld-provider-hidden-authors__item');
      const cell = this.node('td', 'geld-provider-hidden-authors__cell');
      tableCell = cell;
      cell.append(content);
      wrapper.append(cell);
      root = wrapper;
    }
    root.setAttribute(NOTE, '');
    const notice: Notice = { root, label, button, context, rows, tableCell, tableRow: null, spanKey: '', spanCells: [] };
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.notices.get(list) !== notice || this.context !== notice.context || !list.isConnected) return;
      const restore = notice.rows.filter((row) => row.root.parentElement === list && this.managed.has(row.root));
      const focus = this.doc.activeElement === button;
      this.shown.add(list);
      for (const row of restore) {
        row.root.removeAttribute(PROVIDER_AUTHOR_HIDDEN);
        this.managed.delete(row.root);
      }
      notice.root.remove();
      this.notices.delete(list);
      this.syncResizeListener();
      if (focus) this.focusReview(restore);
      this.onReveal(restore.map((row) => row.root));
    });
    return notice;
  }

  private readonly resized = (): void => { for (const notice of this.notices.values()) this.updateColspan(notice); };

  private syncResizeListener(): void {
    const wanted = [...this.notices.values()].some((notice) => notice.tableCell !== null);
    if (wanted === this.listeningForResize) return;
    this.listeningForResize = wanted;
    const view = this.doc.defaultView;
    if (wanted) { view?.addEventListener('resize', this.resized); view?.visualViewport?.addEventListener('resize', this.resized); }
    else { view?.removeEventListener('resize', this.resized); view?.visualViewport?.removeEventListener('resize', this.resized); }
  }

  private updateColspan(notice: Notice): void {
    const row = notice.rows[0]?.root;
    if (notice.tableCell === null || row === undefined) return;
    const cells = [...row.querySelectorAll<HTMLTableCellElement>(':scope > td, :scope > th')];
    const context: string[] = [];
    for (let node: HTMLElement | null = row; node !== null; node = node.parentElement) context.push(node.className, node.getAttribute('style') ?? '');
    const view = this.doc.defaultView;
    const key = JSON.stringify([view?.innerWidth, view?.innerHeight, view?.devicePixelRatio, view?.visualViewport?.width, cells.map((cell) => [cell.colSpan, cell.className, cell.getAttribute('style'), cell.hidden]), context]);
    if (notice.tableRow === row && notice.spanKey === key && notice.spanCells.length === cells.length && cells.every((cell, index) => cell === notice.spanCells[index])) return;
    notice.tableRow = row;notice.spanKey = key;notice.spanCells = cells;
    // Inspect only this notice's representative native row, once per context/viewport change, never row geometry.
    const visible = view === null ? [] : cells.filter((cell) => view.getComputedStyle(cell).display !== 'none');
    const span = Math.max(1, visible.reduce((count, cell) => count + cell.colSpan, 0));
    if (notice.tableCell.colSpan !== span) notice.tableCell.colSpan = span;
  }

  private focusReview(rows: readonly ProviderListRow[]): void {
    for (const row of rows) {
      let expected: URL;
      try { expected = new URL(row.url, this.doc.URL); } catch { continue; }
      for (const link of row.root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
        if (link.closest('[data-geld-ui], [hidden], [aria-hidden="true"], [inert]') !== null || link.textContent?.trim() === '') continue;
        try {
          const url = new URL(link.href, this.doc.URL);
          if (url.origin !== expected.origin || url.pathname !== expected.pathname) continue;
          link.focus();
          if (this.doc.activeElement === link) return;
        } catch { continue; }
      }
    }
  }
}
