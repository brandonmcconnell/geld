import type { ProviderReviewRequirement } from '../providers/review-panel';
import type { ProviderReviewPage } from '../providers/types';
import { describeBitbucketPage } from './page';

const UNTRUSTED = '[data-geld-ui],[data-testid="comment"],[data-testid="comment-content"],[data-qa="pr-activity"],[data-qa="pull-request-description"]';

/** Read the actual native sidebar list; it never establishes approval or merge permission. */
export function readBitbucketRequirements(page: ProviderReviewPage, doc: Document): readonly ProviderReviewRequirement[] | null {
  const current = describeBitbucketPage(new URL(doc.URL));
  if (current === null || current.url !== page.url || current.provider !== page.provider || current.repository.origin !== page.repository.origin || current.repository.path !== page.repository.path) return null;
  const headers = [...doc.querySelectorAll<HTMLElement>('[data-testid="pr-header"]')].filter((node) => node.closest(UNTRUSTED) === null);
  if (headers.length !== 1) return null;
  const header = headers[0];
  if (header === undefined) return null;
  const number = /^#([1-9]\d*)\s*•/.exec(header.querySelector('[data-qa="pr-branches-and-state-styles"] + span')?.textContent?.trim() ?? '')?.[1];
  if (number !== page.number) return null;
  const repository = [...header.querySelectorAll<HTMLAnchorElement>('a[href]')].some((anchor) => {
    try {
      const url = new URL(anchor.getAttribute('href') ?? '', doc.URL);
      return url.origin === page.repository.origin && url.username === '' && url.password === '' && url.pathname === `/${page.repository.path}/src`;
    } catch { return false; }
  });
  if (!repository) return null;
  const lists = [...doc.querySelectorAll<HTMLElement>('section[aria-label="Merge checks status"] [data-testid="mergeCheckList"]')].filter((node) => node.closest(UNTRUSTED) === null);
  if (lists.length !== 1) return null;
  const list = lists[0];
  if (list === undefined) return null;
  const rows = [...list.querySelectorAll<HTMLElement>('[data-testid^="classicMergeCheckItem-"]')].filter((row) => row.closest('[data-testid="mergeCheckList"]') === list && row.closest(UNTRUSTED) === null);
  if (rows.length === 0 || rows.length > 100) return null;
  const seen = new Set<string>();
  const requirements: ProviderReviewRequirement[] = [];
  for (const row of rows) {
    const id = row.getAttribute('data-testid');
    if (id === null || !/^classicMergeCheckItem-[a-z0-9_][a-z0-9_.-]{0,99}$/.test(id) || seen.has(id)) return null;
    seen.add(id);
    const focus = row.querySelector<HTMLElement>('[data-testid="mergeCheckItemFocusElement"]');
    if (focus === null || focus.closest('[data-testid^="classicMergeCheckItem-"]') !== row || focus.closest(UNTRUSTED) !== null) continue;
    const label = focus.textContent?.trim().replace(/\s+/g, ' ') ?? '';
    if (label === '' || label.length > 1000) continue;
    const icons = [...focus.querySelectorAll<HTMLElement>('[data-testid^="mergeCheckItemIcon--"]')].filter((icon) => icon.closest('[data-testid^="classicMergeCheckItem-"]') === row);
    const icon = icons[0];
    const state = icons.length === 1 && icon?.getAttribute('data-testid') === 'mergeCheckItemIcon--success' && icon.getAttribute('role') === 'img' && icon.getAttribute('aria-label') === 'Merge check passed' ? 'passed' : 'unknown';
    requirements.push({ id, label, state });
  }
  return requirements.length === 0 ? null : requirements;
}
