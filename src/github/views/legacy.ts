import { cleanText, isHTMLElement, parseLineStats, query, queryAll } from '../dom';
import type { DiffEntry, DiffView, DiffViewAdapter, TreeFileNode } from '../model';

/**
 * The long-standing server-rendered diff UI (web components + Turbo). Used on
 * the pull request "Files changed" tab for most users and on compare pages.
 *
 * Structure (abridged):
 *   #files
 *     .js-diff-progressive-container   (one or more, sometimes nested)
 *       copilot-diff-entry[data-file-path]
 *         .file[id="diff-<digest>"][data-tagsearch-path]
 *           .file-header .file-info .sr-only  "15 changes: 8 additions & 7 deletions"
 *   file-tree ul[role=tree] li[data-tree-entry-type=file|directory]
 */
export const legacyAdapter: DiffViewAdapter = {
  kind: 'legacy',
  read(): DiffView | null {
    const container = query('#files.diff-view, #files');
    if (container === null) return null;
    const files = queryAll('.file[data-tagsearch-path], .file .file-header[data-path]', container).map(
      (element) => (element.classList.contains('file') ? element : element.closest<HTMLElement>('.file')),
    );
    const fileElements = files.filter(isHTMLElement);
    if (fileElements.length === 0) return null;

    const entries: DiffEntry[] = [];
    for (const file of new Set(fileElements)) {
      // Progressive-loading containers are flattened with `display: contents`
      // by our stylesheet, so the entry itself is what gets ordered/hidden.
      const entryRoot = file.closest<HTMLElement>('copilot-diff-entry') ?? file;
      const path = cleanText(
        file.getAttribute('data-tagsearch-path') ??
          file.querySelector('.file-header')?.getAttribute('data-path') ??
          entryRoot.getAttribute('data-file-path'),
      );
      if (path === '') continue;
      entries.push({
        path,
        root: entryRoot,
        anchor: file.id || null,
        stats: parseLineStats(file.querySelector('.file-info .sr-only')?.textContent),
      });
    }

    const treeRoot = query('file-tree ul[role="tree"]');
    const treeFiles: TreeFileNode[] = [];
    const treeDirectories: HTMLElement[] = [];
    if (treeRoot !== null) {
      for (const item of queryAll('li[data-tree-entry-type="file"]', treeRoot)) {
        const path = cleanText(
          item.querySelector('[data-filterable-item-text]')?.textContent ??
            item.querySelector('.ActionList-item-label')?.textContent,
        );
        if (path === '') continue;
        const statusIcon = item.querySelector('.ActionList-item-visual--trailing svg');
        treeFiles.push({ path, element: item, statusIcon: statusIcon instanceof SVGElement ? statusIcon : null });
      }
      treeDirectories.push(...queryAll('li[data-tree-entry-type="directory"]', treeRoot));
    }

    const tocItems = new Map<string, HTMLElement>();
    for (const link of queryAll<HTMLAnchorElement>('#toc ol li a[href^="#diff-"]')) {
      const item = link.closest<HTMLElement>('li');
      const anchor = link.getAttribute('href')?.slice(1);
      if (item !== null && anchor) tocItems.set(anchor, item);
    }

    return {
      kind: 'legacy',
      container,
      entries,
      treeRoot,
      treeFiles,
      treeDirectories,
      tocItems,
      expandEntry(entry: DiffEntry): void {
        const file = entry.root.matches('.file') ? entry.root : entry.root.querySelector<HTMLElement>('.file');
        if (file === null) return;
        const content = file.querySelector<HTMLElement>('.js-file-content');
        if (content !== null && getComputedStyle(content).display === 'none') {
          file.querySelector<HTMLElement>('.file-header .js-details-target')?.click();
        }
      },
    };
  },
};
