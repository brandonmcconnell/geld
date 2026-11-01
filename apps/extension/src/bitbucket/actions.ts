import type { ProviderReviewAction } from '../providers/types';

function composer(doc: Document): HTMLInputElement | null {
  return [...doc.querySelectorAll<HTMLInputElement>('[data-qa="conversations-global-style"] input[data-testid="chrome-collapsed"]')]
    .find((field) => !field.disabled && !field.readOnly && field.closest('[hidden], [aria-hidden="true"], [data-geld-ui]') === null) ?? null;
}

function signedOut(doc: Document): boolean {
  return [...doc.querySelectorAll<HTMLAnchorElement>('a[href]')].some((link) => {
    if (link.closest('[data-geld-ui]') !== null) return false;
    try { const url = new URL(link.getAttribute('href') ?? '', doc.URL); return url.origin === 'https://bitbucket.org' && url.pathname === '/account/signin/'; } catch { return false; }
  });
}

export function readBitbucketActions(doc: Document): readonly ProviderReviewAction[] {
  const kinds: readonly ProviderReviewAction['kind'][] = ['approve', 'request-changes', 'comment'];
  return kinds.map((kind) => {
    const available = kind === 'comment' && !signedOut(doc) && composer(doc) !== null;
    const visit = doc.URL.split('#')[0];
    return {
      kind, available,
      ...(!available ? { reason: signedOut(doc) ? 'Sign in to Bitbucket to review.' : 'The native Bitbucket review control is unavailable on this page.' } : {}),
      activate: async () => {
        if (kind !== 'comment' || doc.URL.split('#')[0] !== visit || signedOut(doc)) return false;
        const field = composer(doc);
        if (field === null || !field.isConnected) return false;
        field.focus();
        field.click();
        return true;
      },
    };
  });
}
