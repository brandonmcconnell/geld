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
/** Resolve a control's label from aria-label, aria-labelledby or its text. */
function accessibleName(element: HTMLElement): string {
  const label = element.getAttribute('aria-label');
  if (label !== null && label.trim() !== '') return label;
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy !== null) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (text !== '') return text;
  }
  return (element.textContent ?? '').trim();
}

export const reactAdapter: DiffViewAdapter = {
  kind: 'react',
  read(): DiffView | null {
    // Match on the file header rather than the diff body: collapsed files drop
    // their `[data-diff-anchor]` table but keep the heading link.
    const regions = new Set<HTMLElement>();
    for (const marker of queryAll('[role="region"] h3 a[href^="#diff-"], [data-diff-anchor^="diff-"]')) {
      if (marker.closest('[data-geld-ui]') !== null) continue;
      const region = marker.closest<HTMLElement>('[role="region"]');
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
      const anchor =
        region.querySelector('[data-diff-anchor^="diff-"]')?.getAttribute('data-diff-anchor') ??
        region.querySelector('h3 a[href^="#diff-"]')?.getAttribute('href')?.slice(1) ??
        null;
      const srOnly = Array.from(region.querySelectorAll('.sr-only')).find((element) =>
        /additions?/.test(element.textContent ?? ''),
      );
      entries.push({ path, root, anchor, stats: parseLineStats(srOnly?.textContent) });
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
        // The header has several icon buttons (file comment, options menu,
        // "expand all lines", ...). The collapse control is the one whose
        // accessible name is "Expand file" while collapsed / "Collapse file"
        // while open, so we press it only when it currently says "Expand".
        for (const button of entry.root.querySelectorAll<HTMLButtonElement>('button')) {
          if (button.closest('[data-geld-ui]') !== null || button.hasAttribute('aria-haspopup')) continue;
          if (button.hasAttribute('data-file-path')) continue;
          const name = accessibleName(button);
          if (/^collapse\b/i.test(name)) return;
          if (/^expand\b/i.test(name) && !/\b(lines?|comment|review|all)\b/i.test(name)) {
            button.click();
            return;
          }
        }
      },
    };
  },
};
