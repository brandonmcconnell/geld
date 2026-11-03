import type { ProviderListRow } from '../providers/types';
import { describeBitbucketPage } from './page';

function countHost(title: HTMLAnchorElement, row: HTMLElement): HTMLElement | null {
  const label = title.parentElement;
  const tooltip = label?.parentElement;
  const line = tooltip?.parentElement;
  if (label?.tagName !== 'SPAN' || label.children.length !== 1 || label.firstElementChild !== title
    || tooltip?.tagName !== 'DIV' || tooltip.getAttribute('role') !== 'presentation'
    || tooltip.children.length !== 1 || tooltip.firstElementChild !== label
    || line?.tagName !== 'DIV' || line.closest('tr[data-qa="pull-request-row"]') !== row
    || line.closest('[data-geld-ui], a, button, [role="button"], [role="link"], [role="tooltip"], [role="dialog"]') !== null) return null;
  for (const child of line.children) {
    if (child !== tooltip && !child.matches('.geld-provider-list-counts[data-geld-ui]')) return null;
  }
  return line;
}

export function bitbucketListRows(doc: Document): readonly ProviderListRow[] {
  const rows: ProviderListRow[] = [];
  for (const root of doc.querySelectorAll<HTMLElement>('tr[data-qa="pull-request-row"]')) {
    if (root.closest('[data-geld-ui]') !== null) continue;
    for (const title of root.querySelectorAll<HTMLAnchorElement>('a[data-qa="pull-request-row-link"][href]')) {
      const host = countHost(title, root);
      if (host === null || title.closest('tr[data-qa="pull-request-row"]') !== root || title.closest('[data-geld-ui]') !== null) continue;
      let url: URL;
      try { url = new URL(title.getAttribute('href') ?? '', doc.URL); } catch { continue; }
      if (url.origin !== doc.location.origin) continue;
      const page = describeBitbucketPage(url);
      if (page === null || page.kind !== 'overview') continue;
      rows.push({ root, host, url: page.url, author: null });
    }
  }
  return rows;
}
