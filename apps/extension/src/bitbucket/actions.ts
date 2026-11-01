import type { ProviderReviewAction } from '../providers/types';

function composer(doc: Document): HTMLInputElement | null {
  return [...doc.querySelectorAll<HTMLInputElement>('[data-qa="conversations-global-style"] input[data-testid="chrome-collapsed"]')]
    .find((field) => !field.disabled && !field.readOnly && field.closest('[hidden], [aria-hidden="true"], [data-geld-ui]') === null) ?? null;
}

function authenticated(doc: Document): boolean {
  const source = doc.head.querySelector('meta#bb-bootstrap[data-current-user]')?.getAttribute('data-current-user');
  if (source === undefined || source === null) return false;
  try {
    const value: unknown = JSON.parse(source);
    return typeof value === 'object' && value !== null && !Array.isArray(value) && 'isAuthenticated' in value && value.isAuthenticated === true;
  } catch { return false; }
}

export function readBitbucketActions(doc: Document): readonly ProviderReviewAction[] {
  const kinds: readonly ProviderReviewAction['kind'][] = ['approve', 'request-changes', 'comment'];
  return kinds.map((kind) => {
    const available = kind === 'comment' && authenticated(doc) && composer(doc) !== null;
    const visit = doc.URL.split('#')[0];
    return {
      kind, available,
      ...(!available ? { reason: !authenticated(doc) ? 'Sign in to Bitbucket to review.' : 'The native Bitbucket review control is unavailable on this page.' } : {}),
      activate: async () => {
        if (kind !== 'comment' || doc.URL.split('#')[0] !== visit || !authenticated(doc)) return false;
        const field = composer(doc);
        if (field === null || !field.isConnected) return false;
        field.focus();
        field.click();
        return true;
      },
    };
  });
}
