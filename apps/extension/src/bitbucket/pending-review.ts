import type { ProviderReviewInput } from '@geld/review';
import type { ProviderReviewAction, ProviderReviewPage } from '../providers/types';
import { bitbucketAuthenticated, nativeControl, reviewHeader } from './actions';
import { describeBitbucketPage } from './page';

type Subject = ProviderReviewInput['subject'];
interface Candidate {
  readonly header: HTMLElement;
  readonly button: HTMLButtonElement;
  readonly bootstrap: Element;
  readonly serialized: string;
}
interface Scope extends Candidate {
  readonly key: string;
  readonly subject: string;
  readonly visit: string;
  readonly headerParent: Node | null;
  readonly buttonParent: Node | null;
}
const scopes = new WeakMap<Document, Scope>();
let sequence = 0;
const FORBIDDEN = '[data-geld-ui],[data-testid="comment"],[data-testid="comment-content"],[data-qa="pr-activity"],[data-qa="pull-request-description"],form,textarea,[contenteditable],dialog,[role="dialog"],[role="tooltip"],[popover]';

function presented(node: Element): boolean {
  if (node.closest('[hidden],[inert],[aria-hidden="true"]') !== null) return false;
  for (let current: Element | null = node; current !== null; current = current.parentElement) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(current);
    if (style === undefined || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden' || style.opacity === '0') return false;
  }
  return true;
}

/** 7YvK9 renders one literal label and an optional numeric iconAfter Badge, not a known badge testid. */
function label(button: HTMLButtonElement): boolean {
  if (button.querySelector('a,button,input,textarea,select,[contenteditable],[role="button"]') !== null) return false;
  const walker = button.ownerDocument.createTreeWalker(button, 4); // SHOW_TEXT, using the owning document's nodes.
  let labels = 0;let badges = 0;let count = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (++count > 24) return false;
    const text = node.textContent?.trim().replace(/\s+/g, ' ') ?? '';
    if (text === '') continue;
    const parent = node.parentElement;
    if (parent === null || parent.closest('script,style,template,svg') !== null || !presented(parent)) continue;
    if (text === 'Finish Review') labels++;
    else if (/^(?:0|[1-9]\d{0,5})$/.test(text)) badges++;
    else return false;
  }
  const accessible = button.getAttribute('aria-label');
  return labels === 1 && badges <= 1 && (accessible === null || accessible === 'Finish Review');
}

function subjectKey(subject: Subject, page: ProviderReviewPage): string | null {
  return page.provider === 'bitbucket' && page.repository.provider === 'bitbucket' && subject.provider === 'bitbucket' && subject.origin === page.repository.origin && subject.repository === page.repository.path && subject.id === page.number
    && typeof subject.headSha === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(subject.headSha)
    ? JSON.stringify([subject.provider, subject.origin, subject.repository, subject.id, subject.headSha]) : null;
}

function candidate(doc: Document, expected: ProviderReviewPage): Candidate | null {
  const page = describeBitbucketPage(new URL(doc.URL));
  if (page === null || page.url !== expected.url || !bitbucketAuthenticated(doc)) return null;
  const meta = [...doc.head.querySelectorAll('meta#bb-bootstrap[data-current-user]')];
  const bootstrap = meta.length === 1 ? meta[0] : null;
  const serialized = bootstrap?.getAttribute('data-current-user');
  const header = reviewHeader(doc, page);
  if (bootstrap === null || bootstrap === undefined || bootstrap.parentNode !== doc.head || serialized === null || serialized === undefined || header === null || header.closest(FORBIDDEN) !== null || !presented(header)) return null;
  const buttons = [...header.querySelectorAll<HTMLButtonElement>('button')].filter((button) => button.closest('[data-testid="pr-header"]') === header && button.closest(FORBIDDEN) === null);
  // LhpXT replaces normal actions while a review is pending; do not adopt an ambiguous transition.
  if (buttons.some((button) => presented(button) && button.getAttribute('aria-pressed') === 'false'
    && ['Approve this pull request', 'Remove changes requested state from this pull request'].includes(button.getAttribute('aria-label') ?? ''))) return null;
  const matches = buttons.filter((button) => button.tabIndex >= 0 && nativeControl(button) && presented(button) && label(button));
  return matches.length === 1 && matches[0] !== undefined ? { header, button: matches[0], bootstrap, serialized } : null;
}

/** Source-backed native opener only; no pending count, durable actor or live native head is inferred. */
export function readBitbucketPendingReview(doc: Document, page: ProviderReviewPage, subject: Subject): ProviderReviewAction | null {
  const known = subjectKey(subject, page);const value = known === null ? null : candidate(doc, page);
  if (value === null || known === null) { scopes.delete(doc);return null; }
  const visit = doc.URL.split('#')[0] ?? doc.URL;
  let scope = scopes.get(doc);
  if (scope === undefined || scope.subject !== known || scope.visit !== visit || scope.header !== value.header || scope.headerParent !== value.header.parentNode
    || scope.button !== value.button || scope.buttonParent !== value.button.parentNode || scope.bootstrap !== value.bootstrap || scope.serialized !== value.serialized) {
    scope = { ...value, key: `bitbucket-pending-review-${++sequence}`, subject: known, visit, headerParent: value.header.parentNode, buttonParent: value.button.parentNode };
    scopes.set(doc, scope);
  }
  const original = scope;
  const current = (): boolean => {
    if (scopes.get(doc) !== original || doc.hidden || doc.URL.split('#')[0] !== original.visit || subjectKey(subject, page) !== original.subject) return false;
    const latest = candidate(doc, page);
    return latest !== null && latest.header === original.header && latest.header.parentNode === original.headerParent && latest.button === original.button && latest.button.parentNode === original.buttonParent
      && latest.bootstrap === original.bootstrap && latest.serialized === original.serialized;
  };
  return {
    kind: 'open-pending-review', scopeKey: original.key, available: true,
    activate: async (context) => {
      if (context?.current() !== true || !current()) return false;
      original.button.focus({ preventScroll: true });
      if (context.current() !== true || !current() || doc.activeElement !== original.button) return false;
      original.button.click();
      return true; // Native open intent was relayed, never a submission/approval acknowledgment.
    },
  };
}
