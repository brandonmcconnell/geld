import type { ProviderListRow } from '../providers/types';
import { describeBitbucketPage } from './page';

export function bitbucketListRows(doc: Document): readonly ProviderListRow[] {
  const rows: ProviderListRow[] = [];
  for (const root of doc.querySelectorAll<HTMLElement>('tr[data-qa="pull-request-row"]')) {
    if (root.closest('[data-geld-ui]') !== null) continue;
    for (const title of root.querySelectorAll<HTMLAnchorElement>('a[data-qa="pull-request-row-link"][href]')) {
      const host = title.parentElement;
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
