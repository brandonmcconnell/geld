import type { ProviderDiffEntry, ProviderDiffLine, ProviderDiffView, ProviderHeaderTarget, ProviderTreeEntry } from '../providers/types';

function native<T extends Element>(nodes: Iterable<T>): T[] {
  return [...nodes].filter((node) => node.closest('[data-geld-ui]') === null);
}

function count(value: string | null | undefined): number | null {
  const text = (value ?? '').replace(/[+,−\-\s]/g, '');
  const parsed = /^\d+$/.test(text) ? Number(text) : NaN;
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function fileHeader(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>('article[data-qa="branch-diff-file"] [data-qa="bk-file__header"][data-testid="file-header"]');
}

function expanded(root: HTMLElement): boolean {
  const content = root.querySelector<HTMLElement>('[data-testid="file-content"][data-qa="bk-file__content"]');
  return content !== null && content.closest('[aria-hidden="true"]') === null;
}

function toggle(root: HTMLElement, open: boolean): boolean {
  const header = fileHeader(root);
  if (header === null || !root.isConnected) return false;
  if (expanded(root) === open) return true;
  if (header.getAttribute('aria-disabled') === 'true' || header.querySelector('[aria-label="Expand/collapse file"]') === null) return false;
  header.click();
  return true;
}

function viewed(root: HTMLElement): HTMLInputElement | null {
  const header = fileHeader(root);
  return [...header?.querySelectorAll<HTMLLabelElement>('label') ?? []]
    .find((label) => label.textContent?.trim() === 'Viewed')?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null;
}

function lines(root: HTMLElement): readonly ProviderDiffLine[] {
  const result: ProviderDiffLine[] = [];
  for (const row of native(root.querySelectorAll<HTMLElement>('[data-qa="code-line"]'))) {
    const numbers = row.querySelector('[data-key="code-line-number"]');
    const code = row.querySelector<HTMLElement>('[data-line-type]');
    const type = code?.getAttribute('data-line-type');
    if (numbers === null || code === null || ![' ', '+', '-'].includes(type ?? '')) continue;
    const oldLine = count(numbers.getAttribute('data-old-line-number'));
    const newLine = count(numbers.getAttribute('data-new-line-number'));
    if (oldLine === null && newLine === null) continue;
    result.push({ root: row, oldLine, newLine, oldText: oldLine === null ? null : code.textContent ?? '', newText: newLine === null ? null : code.textContent ?? '', kind: type === '+' ? 'added' : type === '-' ? 'removed' : 'context' });
  }
  return result;
}

function signedLeaves(root: HTMLElement): { additions: HTMLElement | null; deletions: HTMLElement | null } {
  const leaves = native(root.querySelectorAll<HTMLElement>('span')).filter((node) => node.children.length === 0);
  return {
    additions: leaves.find((node) => /^\+\s*[\d,]+$/.test(node.textContent?.trim() ?? '')) ?? null,
    deletions: leaves.find((node) => /^[-−]\s*[\d,]+$/.test(node.textContent?.trim() ?? '')) ?? null,
  };
}

function treeEntries(doc: Document): readonly ProviderTreeEntry[] {
  const host = native(doc.querySelectorAll<HTMLElement>('#file-tree'))[0];
  if (host === undefined) return [];
  return native(host.querySelectorAll<HTMLAnchorElement>('ul[role="list"] a[href^="#chg-"]')).flatMap((link) => {
    const fragment = link.getAttribute('href')?.slice(1) ?? '';
    let anchor = doc.getElementById(fragment);
    if (anchor === null) { try { anchor = doc.getElementById(decodeURIComponent(fragment)); } catch { return []; } }
    const path = (anchor?.id ?? fragment).slice('chg-'.length);
    const row = link.parentElement;
    return path && row?.tagName === 'LI' ? [{ path, root: row, link, presentationRoot: link }] : [];
  });
}

export function readBitbucketDiff(doc: Document): ProviderDiffView | null {
  const container = native(doc.querySelectorAll<HTMLElement>('[role="region"][aria-label="Diff"]'))[0];
  if (container === undefined) return null;
  const tree = treeEntries(doc);
  const indexedTree = new Map(tree.map((row) => [row.path, row]));
  const entries: ProviderDiffEntry[] = [];
  const paths = new Set<string>();
  const filteredPaths = new Set<string>();
  for (const anchor of native(container.querySelectorAll<HTMLElement>(':scope > div > div[id^="chg-"]'))) {
    const path = anchor.id.slice('chg-'.length);
    const root = anchor.parentElement;
    if (path === '' || root === null || paths.has(path)
      || root.querySelector('article[data-qa="branch-diff-file"], pre[data-testid="pr-diff-placeholder-wrapper"]') === null) continue;
    const stats = indexedTree.get(path)?.link;
    const counts = stats === null || stats === undefined ? null : signedLeaves(stats);
    entries.push({
      path, root, anchor: anchor.id,
      additions: counts === null ? null : count(counts.additions?.textContent) ?? 0, deletions: counts === null ? null : count(counts.deletions?.textContent) ?? 0,
      isExpanded: () => expanded(root),
      isViewed: () => { const checkbox = viewed(root); return checkbox === null || checkbox.disabled ? null : checkbox.checked; },
      readLines: () => lines(root),
      expand: () => toggle(root, true), collapse: () => toggle(root, false),
      ...(fileHeader(root) === null ? { prepareReveal: () => { if (root.isConnected && fileHeader(root) === null) root.scrollIntoView({ block: 'start', behavior: 'smooth' }); } } : {}),
      markViewed: () => { const checkbox = viewed(root); if (checkbox === null || checkbox.disabled) return false; if (!checkbox.checked) checkbox.click(); return true; },
    });
    paths.add(path);
    if (root.hidden || root.closest('[hidden]:not([data-geld-ui])') !== null) filteredPaths.add(path);
  }
  if (entries.length === 0) return null;
  const treeHost = native(doc.querySelectorAll<HTMLElement>('#file-tree'))[0] ?? null;
  return { kind: 'bitbucket-cloud', container, entries, tree, treeHost, treeContainer: treeHost?.querySelector<HTMLElement>('ul[role="list"]') ?? null, filteredPaths, virtualized: false };
}

export function bitbucketHeaderTargets(doc: Document): readonly ProviderHeaderTarget[] {
  const targets: ProviderHeaderTarget[] = [];
  const tab = native(doc.querySelectorAll<HTMLElement>('a#pull-request-tabs-1[role="tab"]'))[0];
  const files = tab?.querySelector<HTMLElement>(':scope > div > span > span');
  if (files !== null && files !== undefined && count(files.textContent) !== null) targets.push({ files, additions: null, deletions: null, hoverHosts: tab === undefined ? [] : [tab] });
  const heading = native(doc.querySelectorAll<HTMLElement>('#file-tree h5')).find((node) => node.textContent?.trim() === 'Lines updated');
  const stats = heading?.parentElement?.parentElement;
  if (stats !== null && stats !== undefined) {
    const { additions, deletions } = signedLeaves(stats);
    if (additions !== null || deletions !== null) targets.push({ files: null, additions, deletions, keyboardHoverHosts: [stats], accessibleSummaryHost: stats });
  }
  return targets;
}

export function bitbucketReviewHost(doc: Document): HTMLElement | null {
  return native(doc.querySelectorAll<HTMLElement>('[data-qa="pr-activity"]'))[0]?.parentElement ?? null;
}

export function bitbucketActionHost(doc: Document): HTMLElement | null {
  return native(doc.querySelectorAll<HTMLElement>('[data-testid="pr-header"] [data-qa="pr-header-actions-drop-down-menu-styles"]'))[0] ?? null;
}

export function bitbucketDescriptionHost(doc: Document): HTMLElement | null {
  return native(doc.querySelectorAll<HTMLElement>('[data-qa="pull-request-description"] .ak-renderer-document'))[0] ?? null;
}
