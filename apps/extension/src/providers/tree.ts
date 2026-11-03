import type { CategoryIconName, ChangeTotals, FileStats } from '@geld/core';
import { formatCount } from '@geld/core';
import type { HiddenBreakdown } from '../github/breakdown';
import { element } from './dom';
import { nativeTreeIcon } from './tree-icons';
import type { ProviderDiffView, ProviderTreeEntry, ReviewProvider } from './types';

export const PROVIDER_CATEGORY_ROW = 'data-geld-provider-category-row';
const HOST = 'data-geld-provider-category-host';
const BODY = 'data-geld-provider-category-body';
let sequence = 0;

export interface ProviderCategoryActions {
  readonly revealPath: (path: string) => void;
  readonly setExpanded: (expanded: boolean) => void;
  readonly selectCategory?: (id: string) => void;
  /** Exact provider subject/version/head key; prevents presentation reuse across selected revisions. */
  readonly subjectKey?: string;
}
interface Presentation { readonly template: HTMLElement; readonly markup: string }
interface LiveRow { readonly root: HTMLElement; readonly link: HTMLAnchorElement | null; readonly href: string | null; readonly markup: string }
interface Managed { readonly original: string | null; last: string }
interface Panel { readonly section: HTMLElement; readonly button: HTMLButtonElement; readonly content: HTMLElement; signature: string }
interface Directory { name: string; readonly path: string; readonly dirs: Map<string, Directory>; readonly files: string[] }

function directory(paths: readonly string[]): Directory {
  const root: Directory = { name: '', path: '', dirs: new Map(), files: [] };
  for (const path of paths) {
    const pieces = path.split('/');
    pieces.pop();
    let parent = root;
    for (const piece of pieces) {
      let child = parent.dirs.get(piece);
      if (child === undefined) { child = { name: piece, path: parent.path === '' ? piece : `${parent.path}/${piece}`, dirs: new Map(), files: [] }; parent.dirs.set(piece, child); }
      parent = child;
    }
    parent.files.push(path);
  }
  return root;
}

/** Native nodes stay in their framework. Owned copies retain native file visuals and source controls. */
export class ProviderCategoryTree {
  private readonly id = `geld-provider-tree-${++sequence}`;
  private host: HTMLElement | null = null;
  private provider: ReviewProvider | null = null;
  private folderClass: string | null = null;
  private essential: HTMLButtonElement | null = null;
  private nav: HTMLElement | null = null;
  private essentialContent: HTMLElement | null = null;
  private essentialSignature = '';
  private heightOriginal = '';
  private heightOriginalPriority = '';
  private geometryObserver: ResizeObserver | null = null;
  private geometryFrame: number | null = null;
  private geometryWidth: number | null = null;
  private geometryReady = false;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private heightLast = '';
  private active = 'essential';
  private selected: string | null = null;
  private subjectKey: string | null = null;
  private readonly presentations = new Map<string, Presentation>();
  private readonly liveRows = new Map<string, LiveRow>();
  private readonly panels = new Map<string, Panel>();
  private readonly collapsed = new Set<string>();
  private readonly managed = new Map<HTMLElement, Map<string, Managed>>();
  private readonly bodies = new Set<HTMLElement>();
  private actions: ProviderCategoryActions = { revealPath: () => undefined, setExpanded: () => undefined };

  update(view: ProviderDiffView, hidden: HiddenBreakdown, all: ChangeTotals, files: readonly FileStats[], actions: ProviderCategoryActions): void {
    const host = view.treeHost;
    const subjectKey = actions.subjectKey ?? null;
    const provider = host?.ownerDocument.documentElement.getAttribute('data-geld-provider');
    const nativeProvider = provider === 'gitlab' || provider === 'bitbucket' ? provider : null;
    if (this.provider !== nativeProvider) this.clear();
    if (this.host !== null && this.subjectKey !== subjectKey) this.clear();
    if (host?.querySelector<HTMLInputElement>('input[type="search"]')?.value.trim()) { this.clear(); return; }
    if (host === null || hidden.categories.length === 0 || (view.virtualized && view.treeContainer == null)) { this.clear(); return; }
    if (this.host !== host || this.essential?.isConnected !== true || this.nav?.isConnected !== true) {
      this.clear();
      this.host = host;
      this.essential = element('button', '', 'geld-provider-category-header');
      this.essential.type = 'button';
      this.essential.id = `${this.id}-essential`;
      this.essential.addEventListener('click', () => this.open('essential'));
      this.essentialContent = element('div', '', 'geld-provider-essential-content');
      this.essentialContent.id = `${this.id}-essential-content`;
      this.essentialContent.setAttribute('role', 'region');
      this.essentialContent.setAttribute('aria-labelledby', this.essential.id);
      this.essential.setAttribute('aria-controls', this.essentialContent.id);
      this.nav = element('nav', '', 'geld-provider-categories');
      this.nav.setAttribute('aria-label', 'Files by category');
      host.append(this.essential, this.essentialContent, this.nav);
      this.heightOriginal = host.style.getPropertyValue('--geld-provider-tree-max-height');
      this.heightOriginalPriority = host.style.getPropertyPriority('--geld-provider-tree-max-height');
      this.startGeometry();
      this.mark(host, HOST, '');
    }
    this.actions = actions;
    this.subjectKey = subjectKey;
    this.provider = nativeProvider;
    const folderSelector = nativeProvider === 'gitlab' ? 'button[data-testid="file-row"][aria-expanded]' : nativeProvider === 'bitbucket' ? 'button[aria-expanded]:has([aria-label="Directory"])' : null;
    const nativeFolder = folderSelector === null ? undefined : [...host.querySelectorAll<HTMLButtonElement>(folderSelector)].find((button) => button.closest('[data-geld-ui]') === null);
    if (nativeFolder !== undefined) this.folderClass = nativeFolder.className;
    const rows = view.tree.filter((row) => row.root.closest('[data-geld-ui]') === null);
    const hiddenPaths = new Set(hidden.categories.flatMap((group) => group.paths));
    const currentNodes = new Set<HTMLElement>([host]);
    this.bodies.clear();
    if (view.treeContainer != null && host.contains(view.treeContainer)) {
      this.bodies.add(view.treeContainer); currentNodes.add(view.treeContainer);
    } else {
      for (const row of rows) {
        let body = row.presentationRoot ?? row.root;
        if (!host.contains(body)) continue;
        while (body.parentElement !== null && body.parentElement !== host) body = body.parentElement;
        if (body.parentElement === host) { this.bodies.add(body); currentNodes.add(body); }
      }
    }
    for (const node of [...this.managed.keys()]) if (!currentNodes.has(node)) this.restoreNode(node);
    const essentialCount = Math.max(0, all.files - hidden.totals.files - hidden.filtered.files);
    if (this.essential !== null) {
      const text = `Essential (${formatCount(essentialCount)} ${essentialCount === 1 ? 'file' : 'files'})`;
      this.headerLabel(this.essential, text, 'essential');
    }
    const ids = new Set<string>(hidden.categories.map((group) => group.category.id));
    for (const [id, panel] of this.panels) if (!ids.has(id)) { panel.section.remove(); this.panels.delete(id); }
    if (this.active !== 'essential' && !ids.has(this.active)) { this.active = 'essential'; this.actions.selectCategory?.('essential'); }
    this.captureRows(rows, files);
    const stats = new Map(files.map((file) => [file.path, file]));
    const essentialPaths = files.filter((file) => !hiddenPaths.has(file.path) && !view.filteredPaths.has(file.path)).map((file) => file.path);
    const essentialSignature = JSON.stringify([this.folderClass, essentialPaths.map((path) => [path, this.presentations.get(path)?.markup ?? null, stats.get(path)])]);
    if (this.essentialContent !== null && essentialSignature !== this.essentialSignature) {
      this.essentialContent.replaceChildren(this.render(directory(essentialPaths), 'essential', stats));
      this.essentialSignature = essentialSignature;
    }
    for (const group of hidden.categories) {
      let panel = this.panels.get(group.category.id);
      if (panel === undefined) {
        const section = element('section', '', 'geld-provider-category');
        const button = element('button', '', 'geld-provider-category-header');
        button.type = 'button';
        button.id = `${this.id}-${group.category.id}`;
        const content = element('div', '', 'geld-provider-category-content');
        content.id = `${button.id}-content`;
        content.setAttribute('role', 'region');
        content.setAttribute('aria-labelledby', button.id);
        button.setAttribute('aria-controls', content.id);
        button.addEventListener('click', () => this.open(group.category.id));
        section.append(button, content);
        this.nav?.append(section);
        panel = { section, button, content, signature: '' };
        this.panels.set(group.category.id, panel);
      }
      const count = group.paths.length;
      const text = `${group.category.title} (${formatCount(count)} ${count === 1 ? group.category.shortNoun : group.category.shortNounPlural})`;
      this.headerLabel(panel.button, text, group.category.icon);
      // Source markup changes carry native comment/status/selection updates, even without path changes.
      const signature = JSON.stringify([this.folderClass, group.paths.map((path) => [path, this.presentations.get(path)?.markup ?? null, stats.get(path)])]);
      if (signature !== panel.signature) {
        const focusedPath = panel.content.contains(document.activeElement) ? document.activeElement?.closest<HTMLElement>('[data-geld-category-path]')?.dataset.geldCategoryPath : undefined;
        panel.content.replaceChildren(this.render(directory(group.paths), group.category.id, stats));
        panel.signature = signature;
        if (focusedPath !== undefined) [...panel.content.querySelectorAll<HTMLElement>('[data-geld-category-path]')].find((row) => row.dataset.geldCategoryPath === focusedPath)?.querySelector<HTMLElement>('a,button')?.focus();
      }
    }
    this.applyActive();
    this.essential?.addEventListener('keydown', this.keys);
    this.nav?.addEventListener('keydown', this.keys);
  }

  selectCategory(id: string): void {
    if (this.host === null || (id !== 'essential' && !this.panels.has(id))) return;
    this.open(id);
  }

  clear(): void {
    this.geometryObserver?.disconnect(); this.geometryObserver = null;
    window.removeEventListener('resize', this.resize);
    if (this.geometryFrame !== null) cancelAnimationFrame(this.geometryFrame);
    this.geometryFrame = null; this.geometryWidth = null; this.geometryReady = false;
    this.essential?.remove(); this.essentialContent?.remove(); this.nav?.remove();
    if (this.host !== null && this.heightLast !== '' && this.host.style.getPropertyValue('--geld-provider-tree-max-height') === this.heightLast && this.host.style.getPropertyPriority('--geld-provider-tree-max-height') === '') {
      if (this.heightOriginal === '') this.host.style.removeProperty('--geld-provider-tree-max-height');
      else this.host.style.setProperty('--geld-provider-tree-max-height', this.heightOriginal, this.heightOriginalPriority);
    }
    this.essential = null; this.essentialContent = null; this.essentialSignature = ''; this.heightLast = ''; this.heightOriginal = ''; this.heightOriginalPriority = ''; this.nav = null;
    for (const node of [...this.managed.keys()]) this.restoreNode(node);
    this.host = null; this.bodies.clear(); this.panels.clear(); this.collapsed.clear();
    this.active = 'essential'; this.selected = null; this.subjectKey = null; this.provider = null; this.folderClass = null;
    this.presentations.clear(); this.liveRows.clear();
  }

  private startGeometry(): void {
    this.viewportWidth = window.innerWidth; this.viewportHeight = window.innerHeight;
    window.addEventListener('resize', this.resize);
    if (typeof ResizeObserver !== 'undefined') {
      this.geometryObserver = new ResizeObserver((entries) => {
        const entry = entries.find((item) => item.target === this.host);
        if (entry === undefined) return;
        const changed = this.geometryWidth !== null && this.geometryWidth !== entry.contentRect.width;
        this.geometryWidth = entry.contentRect.width;
        // Our height write also emits ResizeObserver; only width/show changes need new geometry.
        if (changed || (!this.geometryReady && entry.contentRect.width > 0)) this.measureSoon();
      });
      if (this.host !== null) this.geometryObserver.observe(this.host);
    }
    this.measureSoon();
  }
  private readonly resize = (): void => {
    if (this.viewportWidth === window.innerWidth && this.viewportHeight === window.innerHeight) return;
    this.viewportWidth = window.innerWidth; this.viewportHeight = window.innerHeight;
    this.measureSoon();
  };
  private measureSoon(): void {
    if (this.host === null || this.geometryFrame !== null) return;
    const host = this.host;
    this.geometryFrame = requestAnimationFrame(() => {
      this.geometryFrame = null;
      if (this.host !== host || !host.isConnected) return;
      // Read the batch first, then write. Never run these layout reads on the mutation/apply path.
      const rect = host.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      if (rect.width === 0 || rect.height === 0 || viewportHeight <= Math.max(0, rect.top)) return;
      const size = `${Math.max(160, viewportHeight - Math.max(0, rect.top) - 16)}px`;
      this.geometryReady = true;
      if (host.style.getPropertyValue('--geld-provider-tree-max-height') !== size) host.style.setProperty('--geld-provider-tree-max-height', size);
      this.heightLast = size;
      this.mark(host, 'data-geld-provider-tree-sized', '');
    });
  }

  private open(id: string): void {
    this.active = id;
    this.applyActive();
    this.actions.selectCategory?.(id);
    this.actions.setExpanded(id !== 'essential');
  }
  private applyActive(): void {
    this.essential?.setAttribute('aria-expanded', String(this.active === 'essential'));
    for (const body of this.bodies) this.mark(body, BODY, 'native');
    if (this.essentialContent !== null) this.essentialContent.hidden = this.active !== 'essential';
    for (const [id, panel] of this.panels) {
      const active = id === this.active;
      panel.button.setAttribute('aria-expanded', String(active));
      panel.content.hidden = !active;
      panel.section.dataset.active = String(active);
    }
  }
  private readonly keys = (event: KeyboardEvent): void => {
    const headers = [this.essential, ...[...this.panels.values()].map((panel) => panel.button)].filter((button): button is HTMLButtonElement => button !== null);
    const index = headers.findIndex((button) => button === event.target);
    if (index < 0) return;
    let target: HTMLButtonElement | undefined;
    if (event.key === 'ArrowDown') target = headers[(index + 1) % headers.length];
    if (event.key === 'ArrowUp') target = headers[(index + headers.length - 1) % headers.length];
    if (event.key === 'Home') target = headers[0];
    if (event.key === 'End') target = headers[headers.length - 1];
    if (target !== undefined) { event.preventDefault(); target.focus(); }
  };

  private headerLabel(button: HTMLButtonElement, text: string, icon: CategoryIconName | 'essential'): void {
    const signature = `${this.provider ?? ''}:${icon}`;
    const label = button.querySelector('.geld-provider-category-label');
    if (button.dataset.geldCategoryIconSignature === signature && label !== null) {
      if (label.textContent !== text) label.textContent = text;
      return;
    }
    button.dataset.geldCategoryIconSignature = signature;
    const nextLabel = element('span', text, 'geld-provider-category-label');
    button.replaceChildren(...(this.provider === null ? [] : [nativeTreeIcon(this.provider, icon)]), nextLabel);
  }

  private render(dir: Directory, category: string, stats: ReadonlyMap<string, FileStats>, depth = 0): HTMLElement {
    const list = element('ul', '', 'geld-provider-category-list');
    const sorted = [...dir.dirs.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    for (let folder of sorted) {
      let name = folder.name;
      while (folder.files.length === 0 && folder.dirs.size === 1) { const child = folder.dirs.values().next().value; if (child === undefined) break; name += `/${child.name}`; folder = child; }
      const item = element('li');
      const button = element('button', '', this.folderClass ?? '');
      button.classList.add('geld-provider-category-folder');
      button.type = 'button';
      button.style.setProperty('--geld-category-depth', String(depth));
      button.style.setProperty('--level', String(depth));
      if (this.folderClass !== null && this.provider !== null) button.dataset.geldNativeFolder = this.provider;
      const label = element('span', name, 'geld-provider-category-folder-label');
      if (this.provider === 'gitlab' && this.folderClass !== null) label.classList.add('file-row-name', 'file-row-indentation');
      const visual = element('span', '', 'geld-provider-category-folder-visual');
      if (this.provider === 'gitlab') visual.classList.add('gl-mr-2', 'gl-text-subtle');
      if (this.provider !== null) { button.dataset.geldFolderGlyph = ''; visual.append(nativeTreeIcon(this.provider, 'folder-open')); }
      if (this.provider === 'gitlab' && this.folderClass !== null) { label.prepend(visual); button.append(label); }
      else button.append(visual, label);
      const key = `${category}:${folder.path}`;
      const children = this.render(folder, category, stats, depth + 1);
      const setOpen = (open: boolean): void => {
        button.setAttribute('aria-expanded', String(open));
        if (this.provider === 'gitlab') button.classList.toggle('is-open', open);
        const icon = visual.querySelector('svg');
        if (this.provider !== null && icon?.getAttribute('data-geld-category-icon') !== (open ? 'folder-open' : 'folder-closed')) visual.replaceChildren(nativeTreeIcon(this.provider, open ? 'folder-open' : 'folder-closed'));
        children.hidden = !open;
      };
      const toggle = (): void => { const open = this.collapsed.has(key); if (open) this.collapsed.delete(key); else this.collapsed.add(key); setOpen(open); };
      setOpen(!this.collapsed.has(key));
      button.addEventListener('click', toggle);
      button.addEventListener('keydown', (event) => { if ((event.key === 'ArrowLeft' && !children.hidden) || (event.key === 'ArrowRight' && children.hidden)) { event.preventDefault(); toggle(); } });
      item.append(button, children); list.append(item);
    }
    for (const path of [...dir.files].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))) {
      const item = element('li');
      item.dataset.geldCategoryPath = path;
      const presentation = this.presentations.get(path);
      const row = presentation === undefined ? this.fallback(path, stats.get(path)) : this.clone(presentation.template);
      row.classList.add('geld-provider-category-native-row');
      row.style.setProperty('--level', String(depth));
      row.style.setProperty('--geld-category-depth', String(depth));
      const control = row.matches('a,button') ? row : row.querySelector<HTMLElement>('a,button');
      if (control !== null) {
        if (this.selected === path) control.setAttribute('aria-current', 'true');
        const annotation = control.getAttribute('aria-label');
        const label = [path, annotation === null || path.includes(annotation) ? '' : annotation, stats.get(path)?.status ?? ''].filter((part) => part !== '').join(', ');
        control.setAttribute('aria-label', label);
      }
      row.addEventListener('click', (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
        const target = event.target instanceof Element ? event.target.closest('button') : null;
        if (target !== null) {
          const index = [...row.querySelectorAll('button')].indexOf(target);
          const original = this.liveControl(path, index);
          if (original !== undefined && original.isConnected && !original.disabled) { event.preventDefault(); original.click(); return; }
        }
        event.preventDefault(); this.selected = path;
        for (const selected of this.nav?.querySelectorAll('[aria-current]') ?? []) selected.removeAttribute('aria-current');
        control?.setAttribute('aria-current', 'true');
        this.actions.setExpanded(category !== 'essential'); this.actions.revealPath(path);
      });
      item.append(row); list.append(item);
    }
    return list;
  }
  private fallback(path: string, stats: FileStats | undefined): HTMLElement {
    const button = element('button', path.split('/').pop() ?? path, 'geld-provider-file');
    button.type = 'button';
    if (stats?.status !== undefined) button.append(element('span', ` ${stats.status}`, 'geld-provider-category-status'));
    return button;
  }
  private captureRows(rows: readonly ProviderTreeEntry[], files: readonly FileStats[]): void {
    const paths = new Set(files.map((file) => file.path));
    this.liveRows.clear();
    for (const path of this.presentations.keys()) if (!paths.has(path)) this.presentations.delete(path);
    for (const row of rows) {
      const root = row.presentationRoot ?? row.root;
      if (!paths.has(row.path) || !root.isConnected || !row.root.isConnected || this.host?.contains(root) !== true) continue;
      const presentation = this.presentation(root);
      if (presentation === null) continue;
      if (this.presentations.get(row.path)?.markup !== presentation.markup) this.presentations.set(row.path, presentation);
      this.liveRows.set(row.path, { root, link: row.link, href: row.link?.href ?? null, markup: presentation.markup });
    }
  }
  private presentation(root: HTMLElement): Presentation | null {
    const template = root.cloneNode(true);
    if (!(template instanceof HTMLElement)) return null;
    this.clean(template, false);
    return { template, markup: template.outerHTML };
  }
  private liveControl(path: string, index: number): HTMLButtonElement | undefined {
    const live = this.liveRows.get(path);
    if (index < 0 || live === undefined || !live.root.isConnected || this.host?.contains(live.root) !== true
      || (live.link !== null && (!live.link.isConnected || live.link.href !== live.href))
      // A recycler may retarget the same physical node before the controller's next pass.
      || this.presentation(live.root)?.markup !== live.markup) return undefined;
    return [...live.root.querySelectorAll<HTMLButtonElement>('button')][index];
  }
  private clone(source: HTMLElement): HTMLElement {
    const clone = source.cloneNode(true);
    if (!(clone instanceof HTMLElement)) return element('span');
    this.clean(clone, true);
    clone.setAttribute('data-geld-ui', '');
    if (!clone.matches('a,button')) clone.removeAttribute('tabindex');
    return clone;
  }
  private clean(root: HTMLElement, renameIds: boolean): void {
    const nodes = [root, ...root.querySelectorAll<Element>('*')];
    const ids = new Map<string, string>();
    for (const node of nodes) {
      for (const attr of [...node.attributes]) if (attr.name.startsWith('data-geld') || attr.name.startsWith('on')) node.removeAttribute(attr.name);
      if (renameIds && node.id !== '') { const replacement = `${this.id}-copy-${++sequence}`; ids.set(node.id, replacement); node.id = replacement; }
    }
    for (const node of nodes) for (const name of ['href', 'xlink:href']) {
      const value = node.getAttribute(name);
      const replacement = value?.startsWith('#') === true ? ids.get(value.slice(1)) : undefined;
      if (replacement !== undefined) node.setAttribute(name, `#${replacement}`);
    }
    for (const node of nodes) for (const name of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
      const value = node.getAttribute(name);
      if (renameIds && value !== null) {
        const references = value.split(/\s+/).flatMap((id) => { const local = ids.get(id); return local === undefined ? [] : [local]; });
        if (references.length === 0) node.removeAttribute(name);
        else node.setAttribute(name, references.join(' '));
      }
    }
  }
  private mark(node: HTMLElement, name: string, value: string): void {
    const attrs = this.managed.get(node) ?? new Map<string, Managed>();
    const current = attrs.get(name) ?? { original: node.getAttribute(name), last: value };
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
    current.last = value; attrs.set(name, current); this.managed.set(node, attrs);
  }
  private restore(node: HTMLElement, name: string): void {
    const attrs = this.managed.get(node); const state = attrs?.get(name);
    if (state === undefined) return;
    if (node.getAttribute(name) === state.last) { if (state.original === null) node.removeAttribute(name); else node.setAttribute(name, state.original); }
    attrs?.delete(name); if (attrs?.size === 0) this.managed.delete(node);
  }
  private restoreNode(node: HTMLElement): void { for (const name of [...(this.managed.get(node)?.keys() ?? [])]) this.restore(node, name); }
}
