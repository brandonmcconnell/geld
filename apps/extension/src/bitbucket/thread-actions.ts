import type { ProviderReviewComment } from '@geld/review';
import type { ProviderReviewSourceAction } from '../providers/review-panel';
import { bitbucketAuthenticated } from './actions';
import { nativeBitbucketComment } from './conversation';

function control(comment: ProviderReviewComment, label: string, doc: Document): HTMLButtonElement | null {
  const root = nativeBitbucketComment(comment, doc);
  return [...root?.querySelectorAll<HTMLButtonElement>('[data-testid="comment-footer"] button') ?? []]
    .find((button) => button.textContent?.trim() === label && button.closest('[data-testid="comment"]') === root
      && !button.disabled && button.getAttribute('aria-disabled') !== 'true' && button.closest('[hidden],[aria-hidden="true"],[inert]') === null) ?? null;
}

export function bitbucketThreadActions(comment: ProviderReviewComment, doc: Document): readonly ProviderReviewSourceAction[] {
  const visit = doc.URL.split('#')[0];
  const original = nativeBitbucketComment(comment, doc);
  const actions: ProviderReviewSourceAction[] = [{ kind: 'show', label: 'Show conversation', available: original !== null && original.closest('[hidden],[aria-hidden="true"],[inert]') === null, activate: async () => {
    if (doc.URL.split('#')[0] !== visit) return false;
    const root = nativeBitbucketComment(comment, doc);
    if (root === null || !root.isConnected || root.closest('[hidden],[aria-hidden="true"],[inert]') !== null) return false;
    root.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const previous = root.getAttribute('tabindex');
    root.setAttribute('tabindex', '-1');
    root.addEventListener('blur', () => {
      if (root.getAttribute('tabindex') !== '-1') return;
      if (previous === null) root.removeAttribute('tabindex'); else root.setAttribute('tabindex', previous);
    }, { once: true });
    root.focus({ preventScroll: true });
    return true;
  } }];
  for (const label of ['Reply', 'Resolve']) {
    const available = bitbucketAuthenticated(doc) && control(comment, label, doc) !== null;
    actions.push({ kind: label.toLowerCase(), label: label === 'Resolve' ? 'Resolve thread' : label, available,
      ...(!available ? { reason: !bitbucketAuthenticated(doc) ? 'Sign in to Bitbucket to review.' : 'This native comment control is unavailable.' } : {}),
      activate: async () => {
        if (doc.URL.split('#')[0] !== visit || !bitbucketAuthenticated(doc)) return false;
        const button = control(comment, label, doc);
        if (button === null || !button.isConnected) return false;
        button.click();
        return true;
      },
    });
  }
  return actions;
}
