import { cleanText, directChildOf, isHTMLElement, mostCommon, parseLineStats, query, queryAll } from '../dom';
import type { DiffEntry, DiffView, DiffViewAdapter, TreeFileNode } from '../model';

/**
 * GitHub's React diff UI, used on commit pages and the newer pull request
 * "Files changed" experience.
 *
 * Structure (abridged, class names are hashed so we avoid them):
 *   <container>                       (flat list; first child is a sticky toolbar)
 *     <div>                           (entry root)
 *       div[role=region][aria-labelledby=heading-*]
 *         h3 a[href="#diff-<digest>"] code  "path"
 *         button[data-file-path]      "Expand all lines"
 *         span.sr-only                "Lines changed: 8 additions & 7 deletions"
 *         [data-diff-anchor="diff-<digest>"]
 *   ul[role=tree][aria-label="File Tree"] li[role=treeitem][id="<path>"]
 */
export const reactAdapter: DiffViewAdapter = {
  kind: 'react',
  read(): DiffView | null {
    const anchors = queryAll('[data-diff-anchor^="diff-"]').filter(
      (element) => !element.closest('[data-geld-ui]'),
    );
    const regions = new Set<HTMLElement>();
    for (const anchor of anchors) {
      const region = anchor.closest<HTMLElement>('[role="region"]');
      if (region !== null) regions.add(region);
    }
    if (regions.size === 0) return null;

    const container = mostCommon(
      Array.from(regions, (region) => region.parentElement?.parentElement ?? null).filter(isHTMLElement),
    );
    if (container === null) return null;

    const entries: DiffEntry[] = [];
    for (const region of regions) {
      const root = directChildOf(container, region);
      if (root === null) continue;
      const path = cleanText(
        region.querySelector('button[data-file-path]')?.getAttribute('data-file-path') ??
          region.querySelector('h3 a code, h3 code, h3 a')?.textContent,
      );
      if (path === '') continue;
      const anchorElement = region.querySelector('[data-diff-anchor^="diff-"]');
      const srOnly = Array.from(region.querySelectorAll('.sr-only')).find((element) =>
        /additions?/.test(element.textContent ?? ''),
      );
      entries.push({
        path,
        root,
        anchor: anchorElement?.getAttribute('data-diff-anchor') ?? null,
        stats: parseLineStats(srOnly?.textContent),
      });
    }
    if (entries.length === 0) return null;

    const treeRoot = query('ul[role="tree"][aria-label="File Tree"], #diff_file_tree ul[role="tree"]');
    const treeFiles: TreeFileNode[] = [];
    const treeDirectories: HTMLElement[] = [];
    if (treeRoot !== null) {
      for (const item of queryAll('li[role="treeitem"]', treeRoot)) {
        if (item.closest('[data-geld-ui]')) continue;
        const isDirectory = item.querySelector(':scope > ul[role="group"]') !== null;
        if (isDirectory) {
          treeDirectories.push(item);
          continue;
        }
        const path = cleanText(item.id);
        if (path === '') continue;
        // This view shows no per-file status icon in the tree.
        treeFiles.push({ path, element: item, statusIcon: null });
      }
    }

    return {
      kind: 'react',
      container,
      entries,
      treeRoot,
      treeFiles,
      treeDirectories,
      tocItems: new Map(),
      expandEntry(entry: DiffEntry): void {
        // The collapse toggle is the only non-menu button with aria-expanded.
        const toggle = entry.root.querySelector<HTMLElement>(
          'button[aria-expanded="false"]:not([aria-haspopup])',
        );
        toggle?.click();
      },
    };
  },
};
