import type { ProviderDiffEntry, ProviderDiffLine, ProviderDiffView, ProviderHeaderTarget, ProviderTreeEntry } from '../providers/types';
import { describeGitLabPage, jsonAttribute } from './page';
import { gitLabPathNavigator } from './navigation';
import { isProviderReviewPage } from '../providers/types';

export { gitLabListRows } from './list-surfaces';

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

function streamWrappers(container: HTMLElement, entries: readonly ProviderDiffEntry[]): readonly HTMLElement[] | null {
  const holders = [...container.querySelectorAll<HTMLElement>(':scope > div[data-stream-remaining-diffs]')];
  const wrappers: HTMLElement[] = [];
  for (const holder of holders) {
    const stream = holder.querySelector<HTMLElement>(':scope > streaming-element');
    if (stream === null || holder.children.length !== 1) return null;
    if ([holder, stream].some((wrapper) => [...wrapper.childNodes].some((node) => node.nodeType === 3 && (node.textContent?.trim() ?? '') !== ''))) return null;
    if ([...stream.children].some((child) => !child.matches('diff-file[data-file-data], server-timings'))) return null;
    wrappers.push(holder, stream);
  }
  for (const file of entries) {
    if (file.root.parentElement === container) continue;
    const stream = file.root.parentElement;
    if (stream === null || !wrappers.includes(stream) || stream.tagName !== 'STREAMING-ELEMENT') return null;
  }
  if (wrappers.some((wrapper) => wrapper.closest('[hidden], [aria-hidden="true"], [inert]') !== null
    || wrapper.style.position !== '' && wrapper.style.position !== 'static'
    || wrapper.style.transform !== '' && wrapper.style.transform !== 'none')) return null;
  return wrappers;
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
  if (rapid === null && parent !== null && parent !== undefined && parent !== container && container.contains(parent) && entries.every((file) => file.root.parentElement === parent)) container = parent;
  const treeHost = doc.querySelector<HTMLElement>('[data-testid="file-tree-container"]');
  const tree: ProviderTreeEntry[] = [];
  for (const link of treeHost?.querySelectorAll<HTMLAnchorElement>('a[data-testid="file-row"][data-file-row]') ?? []) {
    if (link.closest('[data-geld-ui]') !== null) continue;
    try {
      const url = new URL(link.getAttribute('href') ?? '', doc.location.href);
      const path = url.searchParams.get('file_path');
      if (url.origin === doc.location.origin && path) tree.push({ path, root: link, link, presentationRoot: link.closest<HTMLElement>('[data-testid="file-row-container"]') ?? link });
    } catch { continue; }
  }
  const navigateToPath = gitLabPathNavigator(doc, treeHost);
  const wrappers = rapid === null ? null : streamWrappers(container, entries);
  return {
    kind: rapid !== null ? 'gitlab-rapid' : 'gitlab-classic',
    container,
    ...(wrappers === null || wrappers.length === 0 ? {} : {
      groupingWrappers: wrappers,
      groupingReady: entries.every((file) => file.root.lastElementChild?.tagName === 'DIFF-FILE-MOUNTED')
        && wrappers.every((wrapper) => wrapper.tagName !== 'STREAMING-ELEMENT' || wrapper.querySelector(':scope > diff-file[data-file-data]') !== null),
    }),
    entries,
    tree,
    treeHost,
    treeContainer: treeHost?.querySelector<HTMLElement>('nav.mr-tree-list[aria-label="File tree"]') ?? null,
    ...(navigateToPath === null ? {} : { navigateToPath }),
    filteredPaths,
    virtualized: (rapid === null ? entries.some((file) => file.root.parentElement !== container) : wrappers === null)
      || jsonAttribute(rapid, 'data-app-data')?.file_by_file_mode === true || doc.querySelector<HTMLInputElement>('[data-testid="file-by-file"]')?.checked === true
      || entries.some((file) => file.root.classList.contains('is-virtual-scrolling') || file.root.style.position !== '' && file.root.style.position !== 'static'),
  };
}

function countLabels(root: HTMLElement): NonNullable<ProviderHeaderTarget['labels']> {
  const labels: NonNullable<ProviderHeaderTarget['labels']>[number][] = [];
  const seen = new Set<HTMLElement>();
  for (const count of ['additions', 'deletions'] as const) {
    const target = root.querySelector<HTMLElement>(`[data-testid="js-file-${count === 'additions' ? 'addition' : 'deletion'}-line"]`);
    const host = target?.closest<HTMLElement>('[aria-label]');
    if (host === null || host === undefined || !root.contains(host) || seen.has(host)) continue;
    const spans = host.querySelectorAll('[data-testid="js-file-addition-line"], [data-testid="js-file-deletion-line"]');
    const text = host.getAttribute('aria-label') ?? '';
    if (host === target || spans.length === 1) labels.push({ host, attribute: 'aria-label', count });
    else if (spans.length === 2 && (text.match(/\d[\d,\u00a0\u202f]*/g)?.length ?? 0) === 2
      && /\bAdded\s+\d[\d,\u00a0\u202f]*\s+lines?\b/i.test(text) && /\bRemoved\s+\d[\d,\u00a0\u202f]*\s+lines?\b/i.test(text)) {
      labels.push({ host, attribute: 'aria-label', count: 'lines' });
    }
    seen.add(host);
  }
  return labels;
}

export function gitLabHeaderTargets(doc: Document): readonly ProviderHeaderTarget[] {
  const current = new URL(doc.URL);
  if (current.username !== '' || current.password !== '') return [];
  const page = describeGitLabPage(current, doc);
  if (page === null) return [];
  const neutral = (node: HTMLElement): boolean => node.closest('[data-geld-ui], [hidden], [aria-hidden="true"], a, button, [role="tab"], [role="tablist"]') === null;
  const counts = [...doc.querySelectorAll<HTMLElement>('.diff-stats.inline-parallel-buttons .diff-stats-contents')].filter((root) => root.closest('[data-geld-ui]') === null).map((root) => {
    const additions = root.querySelector<HTMLElement>('[data-testid="js-file-addition-line"]');
    const deletions = root.querySelector<HTMLElement>('[data-testid="js-file-deletion-line"]');
    const files = root.querySelector<HTMLElement>(':scope > .diff-stats-group > span');
    let before = (additions ?? deletions)?.parentElement ?? null;
    while (before !== null && before.parentElement !== root) before = before.parentElement;
    if (before === null) before = root.querySelector<HTMLElement>(':scope > .diff-stats-group');
    return { additions, deletions, files, labels: countLabels(root),
      ...(neutral(root) && (additions !== null || deletions !== null || files !== null) ? { hintHost: root, hintBefore: before } : {}),
    };
  });
  if (!isProviderReviewPage(page)) return counts;
  const actions = [...doc.querySelectorAll<HTMLElement>('.merge-request-tabs-container > .merge-request-tabs-actions')].find((root) => neutral(root)
    && root.querySelector(':scope > #discussionCounter [data-testid="discussions-counter-text"]') !== null);
  let fallback = page.kind === 'overview' && !counts.some((target) => target.hintHost !== undefined) && actions !== undefined;
  const tabs = [...doc.querySelectorAll<HTMLElement>('[data-testid="diffs-tab"] .js-changes-tab-count')].flatMap((files) => {
    if (files.closest('[data-geld-ui]') !== null) return [];
    const tab = files.closest<HTMLAnchorElement>('a[data-action="diffs"][data-toggle="tabvue"]');
    if (tab === null) return [];
    let target: URL;
    try { target = new URL(tab.getAttribute('href') ?? '', doc.URL); } catch { return []; }
    if (target.origin !== current.origin || target.username !== '' || target.password !== '') return [];
    const linked = describeGitLabPage(target, doc);
    if (linked === null || !isProviderReviewPage(linked) || linked.url !== page.url || linked.kind !== 'diff') return [];
    const hint = fallback && actions !== undefined ? { hintHost: actions, hintBefore: actions.querySelector<HTMLElement>(':scope > #discussionCounter') } : {};
    fallback = false;
    return [{ files, additions: null, deletions: null, hoverHosts: [tab], ...hint }];
  });
  return [...counts, ...tabs];
}
