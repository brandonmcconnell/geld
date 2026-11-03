import type { FileStats } from '@geld/core';
import type { HiddenBreakdown } from '../github/breakdown';
import { nativeTreeIcon } from './tree-icons';
import type { ProviderDiffView, ReviewProvider } from './types';

const FADED = 'data-geld-provider-inline-tree-row';
const GLYPH = 'data-geld-provider-inline-tree-glyph';
interface Managed { readonly original: string | null; readonly last: string }
interface Icon { readonly replacement: SVGSVGElement; readonly name: string; readonly provider: ReviewProvider }

/** Projects inline category hints without moving native nodes or taking their events. */
export class ProviderInlineTree {
  private subjectKey: string | null = null;
  private readonly attributes = new Map<Element, Map<string, Managed>>();
  private readonly icons = new Map<SVGElement, Icon>();

  /** `files` is the complete validated source inventory, never just mounted diff rows. */
  update(view: ProviderDiffView, hidden: HiddenBreakdown, files: readonly FileStats[], options: { readonly subjectKey: string }): void {
    if (this.subjectKey !== options.subjectKey) this.clear();
    this.subjectKey = options.subjectKey;
    const provider = view.container.ownerDocument.documentElement.getAttribute('data-geld-provider');
    if (provider !== 'gitlab' && provider !== 'bitbucket') { this.clear(); return; }
    const categories = new Map(hidden.categories.flatMap((group) => group.paths.map((path) => [path, group.category] as const)));
    const activeRows = new Set<Element>();
    const activeGlyphs = new Set<SVGElement>();
    for (const row of view.tree) {
      if (!row.root.isConnected || row.root.closest('[data-geld-ui]') !== null) continue;
      const category = categories.get(row.path);
      if (category === undefined || view.filteredPaths.has(row.path)) continue;
      const presentation = row.presentationRoot ?? row.root;
      activeRows.add(presentation); this.mark(presentation, FADED);
      // Restrict to the observed leading file glyph; comment/check visuals stay untouched.
      const selector = provider === 'gitlab' ? '[data-testid="file-row-name-container"] svg' : ':scope > div[role="presentation"] svg';
      const glyph = row.root.querySelector<SVGElement>(selector);
      if (glyph === null || glyph.closest('[data-geld-ui]') !== null) continue;
      activeGlyphs.add(glyph); this.mark(glyph, GLYPH);
      const previous = this.icons.get(glyph);
      if (previous?.name === category.icon && previous.provider === provider && previous.replacement.isConnected && previous.replacement.previousElementSibling === glyph) continue;
      previous?.replacement.remove();
      const replacement = nativeTreeIcon(provider, category.icon);
      replacement.setAttribute('data-geld-ui', '');
      replacement.classList.add('geld-provider-inline-category-icon');
      glyph.after(replacement);
      this.icons.set(glyph, { replacement, name: category.icon, provider });
    }
    for (const row of this.hiddenDirectories(view, files, new Set(categories.keys()), provider)) {
      activeRows.add(row); this.mark(row, FADED);
    }
    for (const [glyph, icon] of this.icons) if (!activeGlyphs.has(glyph)) { icon.replacement.remove(); this.icons.delete(glyph); }
    for (const [node, attributes] of this.attributes) {
      for (const name of [...attributes.keys()]) if ((name === FADED && !activeRows.has(node)) || (name === GLYPH && (!(node instanceof SVGElement) || !activeGlyphs.has(node)))) this.restore(node, name);
    }
  }

  clear(): void {
    for (const icon of this.icons.values()) icon.replacement.remove();
    this.icons.clear();
    for (const [node, attributes] of this.attributes) for (const name of [...attributes.keys()]) this.restore(node, name);
    this.subjectKey = null;
  }

  private hiddenDirectories(view: ProviderDiffView, files: readonly FileStats[], hidden: ReadonlySet<string>, provider: ReviewProvider): readonly HTMLElement[] {
    const host = view.treeContainer ?? view.treeHost;
    // The native GitLab sidebar recycler can omit descendants independently of diff virtualization.
    if (host === null || view.virtualized || host.matches('.vue-recycle-scroller') || host.querySelector('.vue-recycle-scroller') !== null) return [];
    const selector = provider === 'gitlab' ? 'button[data-testid="file-row"][aria-expanded]' : 'button[aria-expanded]:has([aria-label="Directory"])';
    const result: HTMLElement[] = [];
    const mounted = new Set(view.tree.filter((row) => row.root.isConnected && row.root.closest('[data-geld-ui]') === null).map((row) => row.path));
    for (const button of host.querySelectorAll<HTMLElement>(selector)) {
      if (button.closest('[data-geld-ui]') !== null) continue;
      let prefix: string | null = null;
      if (provider === 'gitlab') {
        // Observed full title is authoritative; compacted aria-label is only relative.
        prefix = button.getAttribute('title')?.replace(/\/+$/, '') ?? null;
      } else {
        const item = button.closest('li');
        if (item === null) continue;
        const descendants = view.tree.filter((row) => row.root.isConnected && item.contains(row.root));
        const label = button.textContent?.trim() ?? '';
        if (descendants.length === 0 || label === '') continue;
        const candidates = new Set<string>();
        const first = descendants[0];
        if (first === undefined) continue;
        const segments = first.path.split('/'); segments.pop();
        for (let length = 1; length <= segments.length; length += 1) {
          const candidate = segments.slice(0, length).join('/');
          if ((candidate === label || candidate.endsWith(`/${label}`)) && descendants.every((row) => row.path.startsWith(`${candidate}/`))) candidates.add(candidate);
        }
        if (candidates.size === 1) prefix = [...candidates][0] ?? null;
      }
      if (prefix === null || prefix === '' || prefix.startsWith('/') || prefix.split('/').some((part) => part === '.' || part === '..')) continue;
      const descendants = files.filter((file) => file.path.startsWith(`${prefix}/`) && !view.filteredPaths.has(file.path));
      // Both complete source and all native rows must agree: no partial-descendant inference.
      if (descendants.length > 0 && descendants.every((file) => hidden.has(file.path) && mounted.has(file.path))) result.push(button);
    }
    return result;
  }
  private mark(node: Element, name: string): void {
    const attributes = this.attributes.get(node) ?? new Map<string, Managed>();
    if (!attributes.has(name)) attributes.set(name, { original: node.getAttribute(name), last: '' });
    if (node.getAttribute(name) !== '') node.setAttribute(name, '');
    this.attributes.set(node, attributes);
  }
  private restore(node: Element, name: string): void {
    const attributes = this.attributes.get(node); const managed = attributes?.get(name);
    if (managed !== undefined && node.getAttribute(name) === managed.last) {
      if (managed.original === null) node.removeAttribute(name); else node.setAttribute(name, managed.original);
    }
    attributes?.delete(name); if (attributes?.size === 0) this.attributes.delete(node);
  }
}
