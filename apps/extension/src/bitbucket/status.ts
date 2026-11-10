import type { ProviderReviewPage, ProviderStatusAction } from '../providers/types';
import { bitbucketAuthenticated, nativeControl, reviewHeader } from './actions';
import { describeBitbucketPage } from './page';

function visibleLabel(label: HTMLElement): boolean {
  if (label.closest('[data-geld-ui], [hidden], [inert], [aria-hidden="true"]') !== null) return false;
  for (let node: HTMLElement | null = label; node !== null; node = node.parentElement) {
    const ownedDisplay = node === label && node.hasAttribute('data-geld-status-replaced') && node.style.getPropertyValue('display') === 'none' && node.style.getPropertyPriority('display') === 'important';
    const style = label.ownerDocument.defaultView?.getComputedStyle(node);
    if (!ownedDisplay && style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.contentVisibility === 'hidden') return false;
  }
  return true;
}

export function readBitbucketStatus(doc: Document, expected: ProviderReviewPage): ProviderStatusAction | null {
  const page = describeBitbucketPage(new URL(doc.URL));
  if (!bitbucketAuthenticated(doc) || page === null || page.url !== expected.url) return null;
  const header = reviewHeader(doc, page);
  const branch = header?.querySelector('[data-qa="pr-branches-and-state-styles"]');
  if (header == null || branch == null) return null;
  const states = ['Open', 'Draft'];
  const labels = [...branch.querySelectorAll<HTMLElement>('span')].filter(label => visibleLabel(label)
    && states.includes(label.textContent?.trim() ?? '') && !states.includes(label.parentElement?.textContent?.trim() ?? ''));
  const controls = [...header.querySelectorAll<HTMLButtonElement>('[data-qa="pr-header-actions-drop-down-menu-styles"] button[aria-label="More actions"]')]
    .filter(button => button.tabIndex >= 0 && nativeControl(button));
  const label = labels.length === 1 ? labels[0] : undefined;
  const control = controls.length === 1 ? controls[0] : undefined;
  if (label === undefined || control === undefined) return null;
  const key = JSON.stringify([page.url, label.textContent?.trim(), doc.head.querySelector('meta#bb-bootstrap')?.getAttribute('data-current-user')]);
  return { label, control, key, async activate() {
    const current = readBitbucketStatus(doc, expected);
    if (current?.key !== key || current.label !== label || current.control !== control) return false;
    control.click();return true;
  } };
}
