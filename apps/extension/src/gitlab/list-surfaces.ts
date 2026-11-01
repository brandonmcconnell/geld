import { isProviderReviewPage } from '../providers/types';
import type { ProviderListRow } from '../providers/types';
import { describeGitLabPage } from './page';

const MERGE_REQUEST_ROWS = 'li.merge-request[data-testid="issuable-container"], li.merge-request[data-testid="issuable-item-wrapper"]';
const POPOVERS = '.gl-popover[role="tooltip"]';

function nativeCards(doc: Document): readonly ProviderListRow[] {
  const rows: ProviderListRow[] = [];
  const cards = doc.querySelectorAll<HTMLElement>(POPOVERS);
  if (cards.length === 0) return rows;
  const references = [...doc.querySelectorAll<HTMLAnchorElement>('a[data-reference-type="merge_request"][data-iid][aria-describedby]')];
  for (const card of cards) {
    if (card.id === '' || card.closest('[data-geld-ui], [hidden], [aria-hidden="true"], [inert]') !== null) continue;
    const mergeRequest = card.querySelector<HTMLElement>('.mr-popover');
    if (mergeRequest !== null) {
      const footer = mergeRequest.querySelector<HTMLElement>(':scope > .gl-text-subtle');
      const reference = footer?.querySelector<HTMLElement>(':scope > span:not([data-geld-ui])');
      if (footer === null || footer === undefined || reference === null || reference === undefined) continue;
      const targets = references.filter((link) => (link.getAttribute('aria-describedby') ?? '').split(/\s+/).includes(card.id));
      for (const target of targets) {
        if (target.closest('[data-geld-ui]') !== null) continue;
        let url: URL;
        try { url = new URL(target.href, doc.location.href); } catch { continue; }
        if (url.origin !== doc.location.origin || url.hash.startsWith('#note_')) continue;
        const page = describeGitLabPage(url, doc);
        if (page === null || !isProviderReviewPage(page)) continue;
        const namespace = target.getAttribute('data-namespace-path') ?? target.getAttribute('data-project-path');
        let path: string;
        try { path = decodeURIComponent(page.repository.path); } catch { continue; }
        if (namespace !== path || target.getAttribute('data-iid') !== page.number || reference.textContent?.trim() !== `${namespace}!${page.number}`) continue;
        rows.push({ root: card, host: footer, url: page.url, author: null });
        break;
      }
      continue;
    }
    const title = card.querySelector<HTMLAnchorElement>('a[data-testid="commit-title-link"][href]');
    const sha = card.querySelector<HTMLAnchorElement>('a[data-testid="commit-sha-link"][href]');
    const host = title?.parentElement;
    if (title === null || sha === null || host === null || host === undefined || title.closest(POPOVERS) !== card || sha.closest(POPOVERS) !== card || !host.contains(sha)) continue;
    let url: URL;
    let shaUrl: URL;
    try { url = new URL(title.href, doc.location.href); shaUrl = new URL(sha.href, doc.location.href); } catch { continue; }
    if (url.origin !== doc.location.origin || shaUrl.origin !== url.origin || shaUrl.pathname !== url.pathname) continue;
    const page = describeGitLabPage(url, doc);
    if (page?.kind !== 'commit') continue;
    rows.push({ root: card, host, url: page.url, author: null });
  }
  return rows;
}

export function gitLabListRows(doc: Document): readonly ProviderListRow[] {
  const rows: ProviderListRow[] = [];
  for (const root of doc.querySelectorAll<HTMLElement>(MERGE_REQUEST_ROWS)) {
    if (root.closest('[data-geld-ui]') !== null) continue;
    const title = root.querySelector<HTMLAnchorElement>('a[data-testid="issuable-title-link"][href]');
    const host = root.querySelector<HTMLElement>('.issuable-info');
    if (title === null || host === null || title.closest(MERGE_REQUEST_ROWS) !== root) continue;
    let url: URL;
    try { url = new URL(title.getAttribute('href') ?? '', doc.location.href); } catch { continue; }
    if (url.origin !== doc.location.origin) continue;
    const page = describeGitLabPage(url, doc);
    if (page === null || !isProviderReviewPage(page)) continue;
    rows.push({ root, host, url: page.url, author: root.querySelector('[data-testid="issuable-author"]')?.getAttribute('data-username') || null });
  }
  return [...rows, ...nativeCards(doc)];
}
