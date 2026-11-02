import { repositoryKey } from '@geld/core';
import type { BitbucketReferenceTarget, ProviderReviewReference } from '../providers/references';
import type { ProviderReviewPage } from '../providers/types';
import { bitbucketDescriptionHost } from './diff';
import { describeBitbucketPage } from './page';

interface ReferenceAnchor { readonly reference: ProviderReviewReference; readonly anchor: HTMLAnchorElement; readonly href: string }
interface ReferenceBinding { readonly page: string; readonly root: HTMLElement; readonly entries: readonly ReferenceAnchor[] }
const bindings = new WeakMap<Document, ReferenceBinding>();
const EXCLUDED = '[data-geld-ui],form,button,[role="button"],textarea,[contenteditable],dialog,[role="dialog"],[role="tooltip"],[popover]';
const MAX_ANCHORS = 200;

function description(page: ProviderReviewPage, doc: Document): HTMLElement | null {
  const current = describeBitbucketPage(new URL(doc.URL));
  if (page.provider !== 'bitbucket' || page.kind !== 'overview' || current?.kind !== 'overview' || current.url !== page.url || current.number !== page.number
    || current.version !== page.version || repositoryKey(current.repository) !== repositoryKey(page.repository)) return null;
  const headers = [...doc.querySelectorAll<HTMLElement>('[data-testid="pr-header"]')].filter((node) => node.closest(EXCLUDED) === null);
  if (headers.length !== 1) return null;
  const header = headers[0];
  if (header === undefined || /^#([1-9]\d*)\s*•/.exec(header.querySelector('[data-qa="pr-branches-and-state-styles"] + span')?.textContent?.trim() ?? '')?.[1] !== page.number) return null;
  const matchingRepository = [...header.querySelectorAll<HTMLAnchorElement>('a[href]')].some((anchor) => {
    if (anchor.closest(EXCLUDED) !== null) return false;
    try {
      const url = new URL(anchor.getAttribute('href') ?? '', doc.URL);
      return url.origin === page.repository.origin && url.username === '' && url.password === '' && url.search === '' && url.hash === ''
        && url.pathname.replace(/\/$/, '') === `/${page.repository.path.split('/').map(encodeURIComponent).join('/')}/src`;
    } catch { return false; }
  });
  if (!matchingRepository) return null;
  const roots = [...doc.querySelectorAll<HTMLElement>('[data-qa="pull-request-description"] .ak-renderer-document')].filter((root) => root.closest(EXCLUDED) === null);
  const root = roots.length === 1 ? bitbucketDescriptionHost(doc) : null;
  return root !== null && root === roots[0] ? root : null;
}

function targetOf(anchor: HTMLAnchorElement, doc: Document): BitbucketReferenceTarget | null {
  const href = anchor.getAttribute('href');
  if (href === null || anchor.closest(EXCLUDED) !== null || /[\\\x00-\x20\x7f]|%2e/i.test(href) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(href)) return null;
  try {
    const url = new URL(href, doc.URL);
    if (url.origin !== 'https://bitbucket.org' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || /%(?:2f|5c)/i.test(url.pathname)) return null;
    const target = describeBitbucketPage(url);
    if (target === null || target.kind !== 'overview') return null;
    return { provider: 'bitbucket', identityBasis: 'canonical-url', origin: target.repository.origin, repository: target.repository.path,
      number: target.number, kind: 'pull-request', url: new URL(target.url).href };
  } catch { return null; }
}

function scan(page: ProviderReviewPage, doc: Document): { readonly root: HTMLElement; readonly entries: readonly ReferenceAnchor[] } | null {
  const root = description(page, doc);
  if (root === null) return null;
  const anchors = [...root.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((anchor) => anchor.closest(EXCLUDED) === null);
  if (anchors.length > MAX_ANCHORS) return null;
  const entries: ReferenceAnchor[] = [];
  const seen = new Set<string>();
  for (const anchor of anchors) {
    const target = targetOf(anchor, doc);
    const label = anchor.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (target === null || label === '' || seen.has(target.url)) continue;
    seen.add(target.url);
    entries.push({ anchor, href: anchor.getAttribute('href') ?? '', reference: { id: JSON.stringify(['outgoing', page.url, target.url]), direction: 'outgoing', label, title: null, target, source: { reviewUrl: page.url, anchor: null } } });
  }
  return { root, entries };
}

export function readBitbucketReferences(page: ProviderReviewPage, doc: Document): readonly ProviderReviewReference[] {
  const result = scan(page, doc);
  if (result === null) { bindings.delete(doc);return []; }
  bindings.set(doc, { page: page.url, ...result });
  return result.entries.map((entry) => entry.reference);
}

export function bitbucketReferenceAnchor(reference: ProviderReviewReference, page: ProviderReviewPage, doc: Document): HTMLAnchorElement | null {
  const binding = bindings.get(doc);
  const current = scan(page, doc);
  if (binding === undefined || current === null || binding.page !== page.url || current.root !== binding.root) return null;
  const expected = JSON.stringify(reference);
  const original = binding.entries.find((entry) => JSON.stringify(entry.reference) === expected);
  return original !== undefined && current.entries.some((entry) => entry.anchor === original.anchor && entry.href === original.href && JSON.stringify(entry.reference) === expected) ? original.anchor : null;
}
