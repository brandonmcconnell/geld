import type { ProviderDiffEntry, ProviderDiffLine, ProviderDiffView, ProviderHeaderTarget, ProviderListRow, ProviderTreeEntry } from '../providers/types';
import { describeGitLabPage, jsonAttribute } from './page';

function number(text: string | null | undefined): number | null {
  const value = (text ?? '').replace(/[+,−\-\s]/g, '');
  return /^\d+$/.test(value) ? Number(value) : null;
}

function nativeToggle(root: HTMLElement, expanded: boolean): boolean {
  const details = root.querySelector<HTMLDetailsElement>('details[data-file-body]');
  if (details !== null && details.open === expanded) return true;
  const label = expanded ? 'Show file contents' : 'Hide file contents';
  const control = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (control !== null && !control.disabled) { control.click(); return true; }
  return details === null && root.querySelector(`button[aria-label="${expanded ? 'Hide' : 'Show'} file contents"]`) !== null;
}

function expanded(root: HTMLElement): boolean {
  const details = root.querySelector<HTMLDetailsElement>('details[data-file-body]');
  return details !== null ? details.open : root.querySelector('button[aria-label="Hide file contents"]') !== null;
}

function markViewed(root: HTMLElement): boolean {
  const checkbox = root.querySelector<HTMLInputElement>('input[data-viewed-checkbox], [data-testid="fileReviewCheckbox"] input[type="checkbox"]');
  if (checkbox === null) return false;
  if (checkbox.checked) return true;
  if (checkbox.disabled) return false;
  checkbox.click();
  return true;
}

function rapidLines(root: HTMLElement): readonly ProviderDiffLine[] {
  const lines: ProviderDiffLine[] = [];
  for (const row of root.querySelectorAll<HTMLElement>('tr.rd-hunk-lines-inline, tr.rd-hunk-lines-parallel')) {
    const parallel = row.classList.contains('rd-hunk-lines-parallel');
    const code = row.querySelector<HTMLElement>('td.rd-line-content');
    if (code === null) continue;
    const oldLine = number(row.querySelector('.rd-line-number[data-position="old"] a[data-line-number]')?.getAttribute('data-line-number'));
    const newLine = number(row.querySelector('.rd-line-number[data-position="new"] a[data-line-number]')?.getAttribute('data-line-number'));
    const oldCode = parallel ? row.querySelector<HTMLElement>('.rd-line-content[data-position="old"]') : code;
    const newCode = parallel ? row.querySelector<HTMLElement>('.rd-line-content[data-position="new"]') : code;
    const oldText = oldLine === null ? null : oldCode?.querySelector('.rd-line-text')?.textContent?.replace(/\n$/, '') ?? null;
    const newText = newLine === null ? null : newCode?.querySelector('.rd-line-text')?.textContent?.replace(/\n$/, '') ?? null;
    if (oldText === null && newText === null) continue;
    const kind = oldLine === null ? 'added' : newLine === null ? 'removed' : 'context';
    lines.push({ root: row, oldLine, newLine, oldText, newText, kind });
  }
  return lines;
}

function entry(root: HTMLElement, rapid: boolean): ProviderDiffEntry | null {
  const data = rapid ? jsonAttribute(root, 'data-file-data') : null;
  const path = rapid ? data?.new_path : root.getAttribute('data-path');
  if (typeof path !== 'string' || path === '') return null;
  return {
    path,
    root,
    anchor: root.id || null,
    additions: number(root.querySelector(rapid ? '.rd-stats-added' : '[data-testid="js-file-addition-line"]')?.textContent),
    deletions: number(root.querySelector(rapid ? '.rd-stats-removed' : '[data-testid="js-file-deletion-line"]')?.textContent),
    isExpanded: () => expanded(root),
    isViewed: () => {
      const checkbox = root.querySelector<HTMLInputElement>('input[data-viewed-checkbox], [data-testid="fileReviewCheckbox"] input[type="checkbox"]');
      return checkbox === null || checkbox.disabled ? null : checkbox.checked;
    },
    ...(rapid ? { readLines: () => rapidLines(root) } : {}),
    expand: () => nativeToggle(root, true),
    collapse: () => nativeToggle(root, false),
    markViewed: () => markViewed(root),
  };
}

export function readGitLabDiff(doc: Document): ProviderDiffView | null {
  const rapid = doc.querySelector<HTMLElement>('[data-rapid-diffs]');
  let container = rapid?.querySelector<HTMLElement>('[data-diffs-list]') ?? doc.querySelector<HTMLElement>('#diffs');
  if (container === null) return null;
  const roots = container.querySelectorAll<HTMLElement>(rapid !== null ? 'diff-file[data-file-data]' : '.diff-file.file-holder[data-path]');
  const entries: ProviderDiffEntry[] = [];
  const filteredPaths = new Set<string>();
  for (const root of roots) {
    if (root.closest('[data-geld-ui]') !== null) continue;
    const file = entry(root, rapid !== null);
    if (file === null) continue;
    entries.push(file);
    if (root.hidden || root.closest('[hidden]:not([data-geld-ui])') !== null) filteredPaths.add(file.path);
  }
  if (entries.length === 0) return null;
  const parent = entries[0]?.root.parentElement;
  if (parent !== null && parent !== undefined && parent !== container && container.contains(parent) && entries.every((file) => file.root.parentElement === parent)) container = parent;
  const treeHost = doc.querySelector<HTMLElement>('[data-testid="file-tree-container"]');
  const tree: ProviderTreeEntry[] = [];
  for (const link of treeHost?.querySelectorAll<HTMLAnchorElement>('a[data-testid="file-row"][data-file-row]') ?? []) {
    try {
      const url = new URL(link.getAttribute('href') ?? '', doc.location.href);
      const path = url.searchParams.get('file_path');
      if (url.origin === doc.location.origin && path) tree.push({ path, root: link, link });
    } catch { continue; }
  }
  return {
    kind: rapid !== null ? 'gitlab-rapid' : 'gitlab-classic',
    container,
    entries,
    tree,
    treeHost,
    filteredPaths,
    virtualized: entries.some((file) => file.root.parentElement !== container) || jsonAttribute(rapid, 'data-app-data')?.file_by_file_mode === true || doc.querySelector<HTMLInputElement>('[data-testid="file-by-file"]')?.checked === true || entries.some((file) => file.root.classList.contains('is-virtual-scrolling') || file.root.style.position === 'absolute'),
  };
}

export function gitLabHeaderTargets(doc: Document): readonly ProviderHeaderTarget[] {
  const counts = [...doc.querySelectorAll<HTMLElement>('.diff-stats.inline-parallel-buttons .diff-stats-contents')].map((root) => ({
    additions: root.querySelector<HTMLElement>('[data-testid="js-file-addition-line"]'),
    deletions: root.querySelector<HTMLElement>('[data-testid="js-file-deletion-line"]'),
    files: root.querySelector<HTMLElement>(':scope > .diff-stats-group > span'),
    labels: (['additions', 'deletions'] as const).flatMap((count) => {
      const target = root.querySelector<HTMLElement>(`[data-testid="js-file-${count === 'additions' ? 'addition' : 'deletion'}-line"]`);
      const host = target?.closest<HTMLElement>('[aria-label]');
      return host === null || host === undefined || !root.contains(host)
        || (host !== target && host.querySelectorAll('[data-testid="js-file-addition-line"], [data-testid="js-file-deletion-line"]').length !== 1)
        ? [] : [{ host, attribute: 'aria-label' as const, count }];
    }),
  }));
  return [...counts, ...[...doc.querySelectorAll<HTMLElement>('[data-testid="diffs-tab"] .js-changes-tab-count')].map((files) => {
    const tab = files.closest<HTMLAnchorElement>('a[data-action="diffs"][data-toggle="tabvue"]');
    return { files, additions: null, deletions: null, hoverHosts: tab === null ? [] : [tab] };
  })];
}

export function gitLabListRows(doc: Document): readonly ProviderListRow[] {
  const rows: ProviderListRow[] = [];
  for (const root of doc.querySelectorAll<HTMLElement>('li.merge-request[data-testid="issuable-container"]')) {
    const title = root.querySelector<HTMLAnchorElement>('a[data-testid="issuable-title-link"]');
    const host = root.querySelector<HTMLElement>('.issuable-info');
    if (title === null || host === null) continue;
    let url: URL;
    try { url = new URL(title.getAttribute('href') ?? '', doc.location.href); } catch { continue; }
    if (url.origin !== doc.location.origin || describeGitLabPage(url, doc) === null) continue;
    rows.push({ root, host, url: url.href, author: root.querySelector('[data-testid="issuable-author"]')?.getAttribute('data-username') || null });
  }
  return rows;
}
