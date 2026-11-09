// @vitest-environment happy-dom
import type { GitLabReviewCapabilities } from './review';
import { openGitLabReviewAction, readGitLabActions } from './actions';

const permissions: GitLabReviewCapabilities = { signedIn: true, canApprove: true, canComment: true, canReview: true, requestChanges: 'unknown' };

function writer(disabled = false): string {
  return `<form data-testid="submit-gl-form"><div data-testid="reviewer_states"><input type="radio" name="outcome" value="reviewed"><input type="radio" name="outcome" value="approved"${disabled ? ' disabled' : ''}><input type="radio" name="outcome" value="requested_changes"></div><textarea data-testid="comment-textarea"></textarea><button data-testid="submit-review-button" type="submit">Submit</button></form>`;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('GitLab native quick action relay', () => {
  it('opens the actual native drawer and selects an outcome without submitting', async () => {
    document.body.innerHTML = '<button data-testid="review-drawer-toggle">Your review</button>';
    const clicked = vi.fn(() => { document.body.insertAdjacentHTML('beforeend', writer()); });
    document.querySelector('button')?.addEventListener('click', clicked);
    const submit = vi.fn((event: Event) => event.preventDefault());
    document.addEventListener('submit', submit);
    try {
      expect(await openGitLabReviewAction('approve', permissions)).toBe(true);
      expect(clicked).toHaveBeenCalledOnce();
      expect(document.querySelector<HTMLInputElement>('input[value="approved"]')?.checked).toBe(true);
      expect(document.activeElement?.getAttribute('data-testid')).toBe('comment-textarea');
      expect(submit).not.toHaveBeenCalled();
    } finally { document.removeEventListener('submit', submit); }
  });

  it('cannot click a review control when signed out or approval is denied', async () => {
    document.body.innerHTML = '<button data-testid="review-drawer-toggle">Your review</button>';
    const clicked = vi.fn();
    document.querySelector('button')?.addEventListener('click', clicked);
    expect(await openGitLabReviewAction('approve', { ...permissions, signedIn: false })).toBe(false);
    expect(await openGitLabReviewAction('approve', { ...permissions, canApprove: false })).toBe(false);
    expect(clicked).not.toHaveBeenCalled();
    expect(readGitLabActions(document, { ...permissions, signedIn: false }).every((action) => !action.available)).toBe(true);
  });

  it('respects a disabled native outcome and never clicks a mount or the submit button', async () => {
    document.body.innerHTML = `<div data-testid="review-drawer-toggle"></div>${writer(true)}`;
    const submitted = vi.fn();
    document.querySelector('[data-testid="submit-review-button"]')?.addEventListener('click', submitted);
    expect(await openGitLabReviewAction('approve', permissions)).toBe(false);
    expect(submitted).not.toHaveBeenCalled();
  });

  it('focuses an existing native comment writer without navigation or fake forms', async () => {
    document.body.innerHTML = '<textarea id="note-body"></textarea>';
    expect(await openGitLabReviewAction('comment', { ...permissions, canReview: false })).toBe(true);
    expect(document.activeElement?.id).toBe('note-body');
    expect(document.querySelector('form')).toBeNull();
  });

  it('selects native requested_changes independently from approval permissions', async () => {
    document.body.innerHTML = writer();
    expect(await openGitLabReviewAction('request-changes', { ...permissions, canApprove: false })).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[value="requested_changes"]')?.checked).toBe(true);
    expect(await openGitLabReviewAction('request-changes', { ...permissions, requestChanges: 'unavailable' })).toBe(false);
  });

  it('does not select another merge request’s outcome after delayed drawer hydration', async () => {
    const original = window.location.href;
    document.body.innerHTML = '<button data-testid="review-drawer-toggle">Your review</button>';
    const pending = openGitLabReviewAction('approve', permissions);
    try {
      window.history.replaceState(null, '', '/group/repo/-/merge_requests/43');
      document.body.innerHTML = writer();
      expect(await pending).toBe(false);
      expect(document.querySelector<HTMLInputElement>('input[value="approved"]')?.checked).toBe(false);
    } finally { window.history.replaceState(null, '', original); }
  });
});
