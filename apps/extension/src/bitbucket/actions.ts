import type { ProviderReviewAction, ProviderReviewPage } from '../providers/types';
import { describeBitbucketPage } from './page';

const UNTRUSTED = '[data-geld-ui],[data-testid="comment"],[data-testid="comment-content"],[data-qa="pr-activity"],[data-qa="pull-request-description"]';
const BLOCKED = '[hidden],[aria-hidden="true"],[inert],[aria-disabled="true"],[aria-readonly="true"],fieldset[disabled]';

function nativeControl(control: HTMLButtonElement | HTMLInputElement): boolean {
  if (!control.isConnected || control.disabled || control.hasAttribute('readonly') || control.closest(`${UNTRUSTED},${BLOCKED}`) !== null) return false;
  for (let node: HTMLElement | null = control; node !== null; node = node.parentElement) {
    const style = control.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.contentVisibility === 'hidden') return false;
  }
  return true;
}

function composer(doc: Document): HTMLInputElement | null {
  const fields = [...doc.querySelectorAll<HTMLInputElement>('[data-qa="conversations-global-style"] input[data-testid="chrome-collapsed"]')]
    .filter((field) => nativeControl(field) && !field.readOnly);
  return fields.length === 1 ? fields[0] ?? null : null;
}

export function bitbucketAuthenticated(doc: Document): boolean {
  const source = doc.head.querySelector('meta#bb-bootstrap[data-current-user]')?.getAttribute('data-current-user');
  if (source === undefined || source === null) return false;
  try {
    const value: unknown = JSON.parse(source);
    return typeof value === 'object' && value !== null && !Array.isArray(value) && 'isAuthenticated' in value && value.isAuthenticated === true;
  } catch { return false; }
}

function currentPage(doc: Document, expected?: ProviderReviewPage): ProviderReviewPage | null {
  const current = describeBitbucketPage(new URL(doc.URL));
  return current !== null && (expected === undefined || current.url === expected.url) ? current : null;
}

function reviewHeader(doc: Document, page: ProviderReviewPage): HTMLElement | null {
  const headers = [...doc.querySelectorAll<HTMLElement>('[data-testid="pr-header"]')].filter((node) => node.closest(UNTRUSTED) === null);
  if (headers.length !== 1) return null;
  const header = headers[0];
  if (header === undefined) return null;
  // Actual hydrated header facts reject a stale header during native SPA navigation.
  const metadata = header.querySelector('[data-qa="pr-branches-and-state-styles"] + span');
  if (metadata !== null && /^#([1-9]\d*)\s*•/.exec(metadata.textContent?.trim() ?? '')?.[1] !== page.number) return null;
  const repositoryLinks = [...header.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((anchor) => {
    try { return /\/src\/?$/.test(new URL(anchor.getAttribute('href') ?? '', doc.URL).pathname); } catch { return false; }
  });
  if (repositoryLinks.length > 0 && !repositoryLinks.some((anchor) => {
    try {
      const url = new URL(anchor.getAttribute('href') ?? '', doc.URL);
      return url.origin === page.repository.origin && url.username === '' && url.password === '' && url.pathname.replace(/\/$/, '') === `/${page.repository.path}/src`;
    } catch { return false; }
  })) return null;
  return header;
}

function reviewButton(kind: 'approve' | 'request-changes', doc: Document, page: ProviderReviewPage): HTMLButtonElement | null {
  const header = reviewHeader(doc, page);
  if (header === null) return null;
  // Native page.da841cca modules 7DKLt/6iVT3/7xffk and h8u0J/lIn13.
  // lIn13 reverses the make/undo ARIA wording; text + false state establish make.
  const label = kind === 'approve' ? 'Approve this pull request' : 'Remove changes requested state from this pull request';
  const text = kind === 'approve' ? 'Approve' : 'Request changes';
  const buttons = [...header.querySelectorAll<HTMLButtonElement>('button[aria-pressed="false"]')].filter((button) => button.closest('[data-testid="pr-header"]') === header
    && button.closest(UNTRUSTED) === null && button.tabIndex >= 0
    && button.getAttribute('aria-label') === label && button.textContent?.trim().replace(/\s+/g, ' ') === text);
  const button = buttons.length === 1 ? buttons[0] ?? null : null;
  return button !== null && nativeControl(button) ? button : null;
}

export function readBitbucketActions(doc: Document, expected?: ProviderReviewPage): readonly ProviderReviewAction[] {
  const kinds: readonly ProviderReviewAction['kind'][] = ['approve', 'request-changes', 'comment'];
  const page = currentPage(doc, expected);
  const visit = doc.URL.split('#')[0];
  return kinds.map((kind) => {
    const control = page === null || !bitbucketAuthenticated(doc) ? null : kind === 'comment' ? composer(doc) : reviewButton(kind, doc, page);
    const available = control !== null;
    return {
      kind, available,
      ...(!available ? { reason: !bitbucketAuthenticated(doc) ? 'Sign in to Bitbucket to review.' : 'The native Bitbucket review control is unavailable on this page.' } : {}),
      activate: async () => {
        if (control === null || page === null || doc.URL.split('#')[0] !== visit || !bitbucketAuthenticated(doc) || currentPage(doc, page) === null) return false;
        const current = kind === 'comment' ? composer(doc) : reviewButton(kind, doc, page);
        if (current !== control || !nativeControl(control)) return false;
        if (kind === 'comment') {
          control.focus();
          // Focus can run native handlers: recheck before opening the composer.
          if (doc.URL.split('#')[0] !== visit || !bitbucketAuthenticated(doc) || composer(doc) !== control || !nativeControl(control) || doc.activeElement !== control) return false;
        }
        control.click();
        return true;
      },
    };
  });
}
