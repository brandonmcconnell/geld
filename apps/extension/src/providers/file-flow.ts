import type { FileStats, PathMatcher } from '@geld/core';
import { repositoryKey } from '@geld/core';
import { canReadImports, flowLinks, importSpecifiers, layoutFlow } from '@geld/core/file-flow';
import type { FlowComponent, FlowEdge } from '@geld/core/file-flow';
import { element } from './dom';
import { digestIcon } from './digest-icons';
import { providerFlowRevision } from './file-flow-source';
import type { ProviderAdapter, ProviderDiffResult, ProviderDiffView, ProviderReviewPage } from './types';
import { isProviderReviewPage } from './types';
import './file-flow.css';

interface FlowFile { readonly stats: FileStats; readonly hidden: string | null }
const MAX_READS = 32;
const WIDTH = 224;
const HEIGHT = 96;
const ROW = 152;
let nextId = 0;

export class ProviderFileFlow {
  private page: ProviderReviewPage | null = null;
  private result: ProviderDiffResult | null = null;
  private files: readonly FlowFile[] = [];
  private view: ProviderDiffView | null = null;
  private host: HTMLElement | null = null;
  private button: HTMLButtonElement | null = null;
  private dialog: HTMLDialogElement | null = null;
  private content: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private abort: AbortController | null = null;
  private readonly imports = new Map<string, readonly string[]>();
  private readonly failures = new Set<string>();
  private readonly attempted = new Set<string>();
  private includeHidden = false;
  private edges: readonly FlowEdge[] = [];
  private revision = '';
  private reading = false;
  private unavailable = 'Loading changed files…';
  constructor(private readonly adapter: ProviderAdapter) {}

  update(page: ProviderReviewPage, host: HTMLElement | null, result: ProviderDiffResult | null, matcher: PathMatcher, view: ProviderDiffView | null, unavailable = 'Loading changed files…'): void {
    const revision = JSON.stringify([repositoryKey(page.repository), page.number, page.version, result?.revision ?? null]);
    if (this.page !== null && (this.page.number !== page.number || repositoryKey(this.page.repository) !== repositoryKey(page.repository))) this.clear();
    if (this.revision !== revision) {
      this.abort?.abort();this.abort = null;this.reading = false;this.imports.clear();this.failures.clear();this.attempted.clear();this.revision = revision;
    }
    this.page = page;this.result = result;this.view = view;this.unavailable = unavailable;
    this.files = (result?.files ?? []).map((stats) => ({ stats, hidden: matcher.categorizeFile(stats)?.title ?? null }));
    if (host !== this.host || this.button?.parentElement !== host) {
      this.button?.remove();this.host = host;this.button = null;
      if (host !== null) {
        const button = element('button', '', 'geld-provider-review__tool geld-provider-flow-button');button.type = 'button';button.title = 'Flow: how the changed files connect';button.setAttribute('aria-label', button.title);
        button.append(digestIcon('flow'), element('span', 'Flow', 'geld-provider-review__tool-label'));
        button.addEventListener('click', () => this.open());host.append(button);this.button = button;
      }
    }
    if (this.dialog !== null) { this.render();void this.read(); }
  }

  clear(): void {
    this.close();this.button?.remove();this.button = null;this.host = null;this.page = null;this.result = null;this.files = [];this.view = null;
    this.imports.clear();this.failures.clear();this.attempted.clear();this.revision = '';this.includeHidden = false;
  }

  private current(revision: string): boolean {
    if (this.page === null || this.revision !== revision || this.dialog === null) return false;
    const active = this.adapter.describe(new URL(window.location.href), document);
    return active !== null && isProviderReviewPage(active) && active.number === this.page.number && active.version === this.page.version
      && repositoryKey(active.repository) === repositoryKey(this.page.repository);
  }

  private open(): void {
    if (this.page === null || this.dialog !== null) return;
    const dialog = element('dialog', '', 'geld-provider-flow');dialog.setAttribute('aria-label', 'Changed file dependencies');
    const close = element('button', 'Close', 'geld-provider-toggle');close.type = 'button';close.setAttribute('aria-label', 'Close file flow');close.addEventListener('click', () => this.close());
    const heading = element('h2', 'Changed file dependencies');
    const header = element('header');header.append(heading, close);dialog.append(header);
    const tools = element('div', '', 'geld-provider-flow__tools');
    const hidden = element('button', '', 'geld-provider-toggle');hidden.type = 'button';
    const label = (): void => { hidden.textContent = this.includeHidden ? 'Hide categorised files' : 'Show categorised files';hidden.setAttribute('aria-pressed', String(this.includeHidden)); };
    hidden.addEventListener('click', () => { this.includeHidden = !this.includeHidden;label();this.render();void this.read(); });label();
    const retry = element('button', 'Retry unavailable imports', 'geld-provider-toggle');retry.type = 'button';retry.addEventListener('click', () => {
      if (this.reading) return;
      for (const path of this.failures) this.attempted.delete(path);this.failures.clear();void this.read();
    });
    tools.append(hidden, retry);dialog.append(tools);
    dialog.append(element('p', 'Arrows point to imported files. Dashed arrows mark removed imports.', 'geld-provider-flow__legend'));
    this.status = element('p', '', 'geld-provider-flow__status');this.status.setAttribute('role', 'status');dialog.append(this.status);
    this.content = element('div', '', 'geld-provider-flow__content');dialog.append(this.content);
    dialog.addEventListener('cancel', (event) => { event.preventDefault();this.close(); });
    // Provider-wide shortcuts can cancel the browser's default dialog dismissal.
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || this.dialog !== dialog) return;
      event.preventDefault();event.stopPropagation();this.close();
    }, { capture: true });
    dialog.addEventListener('click', (event) => { if (event.target === dialog) this.close(); });
    dialog.addEventListener('close', () => { if (this.dialog === dialog) this.close(); });
    this.dialog = dialog;document.body.append(dialog);dialog.showModal();close.focus();this.render();void this.read();
  }

  private close(): void {
    const dialog = this.dialog;this.dialog = null;this.content = null;this.status = null;
    this.abort?.abort();this.abort = null;this.reading = false;
    for (const path of this.attempted) if (!this.imports.has(path) && !this.failures.has(path)) this.attempted.delete(path);
    if (dialog?.open) dialog.close();dialog?.remove();
    if (this.button?.isConnected) this.button.focus({ preventScroll: true });
  }

  private async read(): Promise<void> {
    const page = this.page, result = this.result, read = this.adapter.wholeTests?.readSource;
    if (this.reading || this.dialog === null || page === null || result === null || read === undefined) return;
    const selected = this.files.filter((file) => file.stats.status !== 'deleted' && canReadImports(file.stats.path))
      .sort((a, b) => Number(a.hidden !== null) - Number(b.hidden !== null)).slice(0, MAX_READS);
    const needed = selected.filter((file) => !this.attempted.has(file.stats.path));if (needed.length === 0) return;
    const abort = new AbortController(), revision = this.revision;
    this.abort = abort;this.reading = true;this.render();
    try {
      for (const file of needed) {
        if (abort.signal.aborted || !this.current(revision)) return;
        const path = file.stats.path;this.attempted.add(path);
        const source = providerFlowRevision(page, result, path);
        if (source === null) { this.failures.add(path);continue; }
        const timer = setTimeout(() => abort.abort(new Error('Source read timed out')), 15_000);
        let stop: (() => void) | undefined;
        const cancelled = new Promise<never>((_, reject) => { stop = () => reject(abort.signal.reason ?? new DOMException('Aborted', 'AbortError'));abort.signal.addEventListener('abort', stop, { once: true }); });
        try {
          const body = await Promise.race([read(source, abort.signal, () => this.current(revision) && !abort.signal.aborted), cancelled]);
          if (abort.signal.aborted || !this.current(revision)) return;
          if (body.bytes > 400_000) throw new Error('Source is too large for Flow');
          this.imports.set(path, importSpecifiers(path, body.lines.join('\n')));
        } catch {
          if (!this.current(revision)) return;
          this.failures.add(path);
          if (abort.signal.aborted || this.adapter.wholeTests?.paused?.(page.repository.origin)) break;
        } finally { clearTimeout(timer);if (stop !== undefined) abort.signal.removeEventListener('abort', stop); }
      }
    } finally {
      if (this.abort === abort) { this.abort = null;this.reading = false;if (this.current(revision)) this.render(); }
    }
  }

  private render(): void {
    const content = this.content, status = this.status;
    if (content === null || status === null || this.page === null) return;
    const visible = this.files.filter((file) => this.includeHidden || file.hidden === null);
    const count = this.files.filter((file) => file.stats.status !== 'deleted' && canReadImports(file.stats.path)).length;
    const messages = [this.result === null ? this.unavailable : `${visible.length} of ${this.files.length} changed files`];
    if (this.result?.files.some((file) => file.summaryOnly)) messages.push('Removed imports are unavailable from file summaries.');
    if (this.result?.complete === false) messages.push('The changed-file inventory is partial.');
    if (this.reading) messages.push('Reading imports at the verified commit…');
    else if (count > 0) messages.push(`${this.imports.size} of ${count} import sources read${this.failures.size > 0 ? `, ${this.failures.size} unavailable` : ''}.`);
    if (count > MAX_READS) messages.push(`Source reads are limited to ${MAX_READS} files per review.`);
    status.textContent = messages.join(' ');
    if (this.reading) { content.replaceChildren();return; }
    const before = new Map(this.files.map(({ stats }) => [stats.path, stats.removedImports ?? []]));
    const paths = visible.map((file) => file.stats.path);
    const edges = flowLinks(paths, this.imports, before, new Set(this.files.filter((file) => file.stats.status === 'deleted').map((file) => file.stats.path)));
    this.edges = edges;
    const layout = layoutFlow(paths, edges), byPath = new Map(visible.map((file) => [file.stats.path, file]));
    content.replaceChildren();
    for (const component of layout.components) content.append(this.component(component, byPath));
    if (layout.loose.length > 0) {
      const loose = element('section', '', 'geld-provider-flow__loose');
      loose.setAttribute('aria-label', 'Files without verified dependencies');
      for (const path of layout.loose) { const file = byPath.get(path);if (file !== undefined) loose.append(this.card(file)); }
      content.append(loose);
    }
  }

  private card(file: FlowFile): HTMLElement {
    const stats = file.stats, card = element('a', '', 'geld-provider-flow__file');card.dataset.geldFlowPath = stats.path;
    const target = new URL(this.view?.tree.find((entry) => entry.path === stats.path)?.link?.href ?? this.page!.diffPageUrl, window.location.href);
    const anchor = this.view?.entries.find((entry) => entry.path === stats.path)?.anchor;
    if (anchor) target.hash = anchor;
    card.href = target.href;card.title = stats.path;
    const imports = this.edges.filter(edge => edge.from === stats.path).map(edge => `${edge.removed ? 'Removed import' : 'Imports'} ${edge.to}`);
    card.setAttribute('aria-label', [stats.path, ...imports].join('. '));
    card.append(element('strong', stats.path), element('span', `${stats.status ?? 'modified'} · +${stats.additions} −${stats.deletions}`));
    if (file.hidden !== null) card.append(element('span', file.hidden, 'geld-provider-flow__category'));
    card.addEventListener('click', (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (this.view?.navigateToPath?.(stats.path)) event.preventDefault();
      this.close();
    });
    return card;
  }

  private component(component: FlowComponent, files: ReadonlyMap<string, FlowFile>): HTMLElement {
    const group = element('section', '', 'geld-provider-flow__component');group.setAttribute('aria-label', 'Connected files');
    const width = (component.width + 1) * WIDTH, height = component.rows.length * ROW;
    group.style.width = `${width}px`;group.style.height = `${height}px`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');svg.setAttribute('width', String(width));svg.setAttribute('height', String(height));svg.setAttribute('aria-hidden', 'true');
    const markerId = `geld-provider-flow-arrow-${nextId++}`;
    const defs = document.createElementNS(svg.namespaceURI, 'defs'), marker = document.createElementNS(svg.namespaceURI, 'marker');
    marker.setAttribute('id', markerId);marker.setAttribute('viewBox', '0 0 8 8');marker.setAttribute('refX', '7');marker.setAttribute('refY', '4');marker.setAttribute('markerWidth', '6');marker.setAttribute('markerHeight', '6');marker.setAttribute('orient', 'auto-start-reverse');
    const arrow = document.createElementNS(svg.namespaceURI, 'path');arrow.setAttribute('d', 'M0 0 L8 4 L0 8z');marker.append(arrow);defs.append(marker);svg.append(defs);
    for (const route of component.routes) {
      const points = route.points.map((point, index) => {
        const first = index === 0, last = index === route.points.length - 1;
        const adjacent = route.points[first ? 1 : index - 1];
        const direction = adjacent !== undefined && adjacent.row < point.row ? -1 : 1;
        return `${(point.x + 0.5) * WIDTH},${point.row * ROW + HEIGHT / 2 + (first ? direction * HEIGHT / 2 : last ? direction * HEIGHT / 2 : 0)}`;
      });
      const path = document.createElementNS(svg.namespaceURI, 'polyline');path.setAttribute('points', points.join(' '));path.setAttribute('marker-end', `url(#${markerId})`);this.edgeAttributes(path, route.edge);svg.append(path);
    }
    group.append(svg);
    component.rows.forEach((row, index) => { for (const slot of row) {
      if (slot.kind !== 'file') continue;
      const file = files.get(slot.path);if (file === undefined) continue;
      const card = this.card(file);card.style.left = `${slot.x * WIDTH}px`;card.style.top = `${index * ROW}px`;group.append(card);
    } });
    return group;
  }

  private edgeAttributes(path: Element, edge: FlowEdge): void {
    path.setAttribute('data-geld-flow-from', edge.from);path.setAttribute('data-geld-flow-to', edge.to);
    if (edge.removed) path.setAttribute('data-removed', '');
  }
}
