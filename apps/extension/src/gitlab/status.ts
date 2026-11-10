import type { ProviderReviewPage, ProviderStatusAction } from '../providers/types';
import { gitLabReviewIdentity } from './review';
import { describeGitLabPage } from './page';

const EXCLUDED = '[data-geld-ui], .note, .note-body, .note-text, .md, [data-testid="noteable-note-container"], [data-testid="description-content"], [hidden], [inert], [aria-hidden="true"]';

function visible(element: HTMLElement): boolean {
  if (element.closest(EXCLUDED) !== null) return false;
  for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
    const ownedDisplay = node === element && node.hasAttribute('data-geld-status-replaced') && node.style.getPropertyValue('display') === 'none' && node.style.getPropertyPriority('display') === 'important';
    const style = element.ownerDocument.defaultView?.getComputedStyle(node);
    if (!ownedDisplay && style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.contentVisibility === 'hidden') return false;
  }
  return true;
}

export function readGitLabStatus(doc: Document, expected: ProviderReviewPage): ProviderStatusAction | null {
  const actor = gitLabReviewIdentity(doc);
  const page = describeGitLabPage(new URL(doc.URL), doc);
  if (actor === null || page === null || !('number' in page) || page.url !== expected.url) return null;
  const labels = [...doc.querySelectorAll<HTMLElement>('.merge-request-sticky-header .detail-page-description .gl-badge[aria-label]')]
    .filter(label => visible(label) && ['Open', 'Draft', 'Closed'].includes(label.getAttribute('aria-label') ?? ''));
  const controls = [...doc.querySelectorAll<HTMLButtonElement>('[data-testid="merge-request-actions"] button')]
    .filter(button => visible(button) && !button.disabled && !button.hasAttribute('readonly') && button.closest('[aria-disabled="true"], [aria-readonly="true"], fieldset[disabled]') === null && button.tabIndex >= 0
      && (button.id === 'new-actions-header-dropdown' || button.getAttribute('aria-label') === 'Merge request actions'));
  const label = labels.length === 1 ? labels[0] : undefined;
  const control = controls.length === 1 ? controls[0] : undefined;
  if (label === undefined || control === undefined) return null;
  const owner = label.closest('.merge-request[data-url]');
  if (owner !== null) {
    try { if (new URL(owner.getAttribute('data-url') ?? '', doc.URL).href !== `${page.url}.json`) return null; }
    catch { return null; }
  }
  const state = label.getAttribute('aria-label');
  const key = JSON.stringify([page.url, actor, state]);
  return { label, control, key, async activate() {
    const current = readGitLabStatus(doc, expected);
    if (current?.key !== key || current.label !== label || current.control !== control) return false;
    control.click();return true;
  } };
}
