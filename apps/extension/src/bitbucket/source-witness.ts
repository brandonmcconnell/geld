import { describeBitbucketProviderPage } from './page';
import { providerFullSha, providerSourceSubject, providerSourceSubjectKey, providerNativeSourceElement } from '../providers/source-facts';
import type { ProviderNativeSourceFrame } from '../providers/source-facts';

function native<T extends Element>(nodes: Iterable<T>): T[] { return [...nodes].filter(providerNativeSourceElement); }

export function readBitbucketSourceFrame(doc: Document, container: HTMLElement): ProviderNativeSourceFrame | null {
  const url = doc.URL;
  const page = describeBitbucketProviderPage(new URL(url));
  if (page?.kind !== 'commit' || !providerFullSha(page.ref)) return null;
  const main = container.closest('[role="main"]');
  if (main === null || !providerNativeSourceElement(container) || !providerNativeSourceElement(main) || native(main.querySelectorAll('[role="region"][aria-label="Diff"]')).length !== 1) return null;
  const headings = native(main.querySelectorAll('h1[data-qa="page-header"]'));
  const heading = headings[0];
  const text = heading?.firstChild?.nodeType === 3 ? heading.firstChild.textContent?.trim() ?? '' : '';
  if (headings.length !== 1 || heading === undefined || !/^[a-f0-9]{7,64}$/i.test(text) || !page.ref.startsWith(text.toLowerCase())) return null;
  const links = native(main.querySelectorAll<HTMLAnchorElement>('div[role="group"] > a[href]'))
    .filter((link) => link.textContent?.trim() === 'View source' && link.closest('[role="region"][aria-label="Diff"], [hidden], [aria-hidden="true"], [inert]') === null);
  const link = links[0];
  if (links.length !== 1 || link === undefined) return null;
  const href = link.getAttribute('href');
  try {
    const source = new URL(href ?? '', url);
    const path = `/${page.repository.path.split('/').map(encodeURIComponent).join('/')}/src/${page.ref}/`;
    if (source.origin !== page.repository.origin || source.pathname !== path || source.username !== '' || source.password !== '' || source.search !== '' || source.hash !== '') return null;
  } catch { return null; }
  const subject = providerSourceSubject(page);
  const parent = container.parentNode;
  const group = link.parentNode;
  return {
    key: JSON.stringify([providerSourceSubjectKey(subject), page.ref]),
    current: () => doc.URL === url && container.isConnected && container.getAttribute('role') === 'region' && container.getAttribute('aria-label') === 'Diff' && main.getAttribute('role') === 'main' && providerNativeSourceElement(container) && providerNativeSourceElement(main) && providerNativeSourceElement(link) && providerNativeSourceElement(heading) && container.parentNode === parent && main.contains(container) && link.isConnected && link.parentNode === group
      && main.contains(link) && link.getAttribute('href') === href && heading.isConnected && heading.firstChild?.textContent?.trim() === text,
    read: (entry) => {
      const root = entry.root;
      if (!root.isConnected || root.ownerDocument !== doc || !container.contains(root) || !providerNativeSourceElement(root)) return null;
      const anchors = root.querySelectorAll<HTMLElement>(':scope > div[id^="chg-"]');
      const anchor = anchors[0];
      if (anchors.length !== 1 || anchor === undefined || root.querySelector('article[data-qa="branch-diff-file"], pre[data-testid="pr-diff-placeholder-wrapper"]') === null) return null;
      return { subject, repository: page.repository, path: anchor.id.slice('chg-'.length), headSha: page.ref, comparison: { kind: 'bitbucket-commit' } };
    },
  };
}
