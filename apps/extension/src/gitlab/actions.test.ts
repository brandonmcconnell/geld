// @vitest-environment happy-dom
import type { GitLabReviewCapabilities } from './review';
import { openGitLabReviewAction, readGitLabActions } from './actions';

const permissions: GitLabReviewCapabilities = { signedIn: true, canApprove: true, canComment: true, canReview: true, requestChanges: 'unknown' };

function writer(disabled = false): string {
  return `<form data-testid="submit-gl-form"><div data-testid="reviewer_states"><input type="radio" name="outcome" value="reviewed"><input type="radio" name="outcome" value="approved"${disabled ? ' disabled' : ''}><input type="radio" name="outcome" value="requested_changes"></div><textarea data-testid="comment-textarea"></textarea><button data-testid="submit-review-button" type="submit">Submit</button></form>`;
}

beforeEach(() => { window.location.href = 'https://gitlab.com/group/repo/-/merge_requests/7'; });
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.useRealTimers(); });

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

  it('hydrates the source-verified optional summary placeholder and focuses its delayed native editor', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<textarea id="note-body">Unrelated main comment draft</textarea><button data-testid="review-drawer-toggle">Your review</button>';
    document.querySelector('button')?.addEventListener('click', () => {
      setTimeout(() => {
        document.body.insertAdjacentHTML('beforeend', writer().replace('<textarea data-testid="comment-textarea"></textarea>', '<input data-testid="placeholder-input-field" placeholder="Add optional summary content…">'));
        const placeholder = document.querySelector('input[data-testid="placeholder-input-field"]');
        placeholder?.addEventListener('focus', () => {
          setTimeout(() => {
            const textarea = document.createElement('textarea');
            textarea.setAttribute('data-testid', 'comment-textarea');
            textarea.value = 'Existing native autosaved review summary';
            placeholder.replaceWith(textarea);
          }, 80);
        });
      }, 50);
    });
    const submit = vi.fn((event: Event) => event.preventDefault());
    document.addEventListener('submit', submit);
    try {
      const pending = openGitLabReviewAction('request-changes', permissions);
      await vi.advanceTimersByTimeAsync(200);
      expect(await pending).toBe(true);
      expect(document.activeElement?.getAttribute('data-testid')).toBe('comment-textarea');
      expect(document.querySelector<HTMLTextAreaElement>('textarea[data-testid="comment-textarea"]')?.value).toBe('Existing native autosaved review summary');
      expect(document.querySelector<HTMLTextAreaElement>('#note-body')?.value).toBe('Unrelated main comment draft');
      expect(document.querySelector<HTMLInputElement>('input[value="requested_changes"]')?.checked).toBe(true);
      expect(submit).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { document.removeEventListener('submit', submit); }
  });

  it('keeps an existing native review draft and selects only the exact live review form’s outcome', async () => {
    const native = writer().replace('<form ', '<form id="native-review" ');
    document.body.innerHTML = '<textarea id="note-body">Main draft</textarea>'
      + writer().replace('data-testid="submit-gl-form"', 'data-testid="other-form"')
      + `<section data-geld-ui>${writer()}</section><section hidden>${writer()}</section>${native}`;
    const field = document.querySelector<HTMLTextAreaElement>('#native-review textarea');
    if (field === null) throw new Error('Missing native writer');
    field.value = 'Keep this native review draft';
    expect(await openGitLabReviewAction('approve', permissions)).toBe(true);
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe('Keep this native review draft');
    expect(document.querySelector<HTMLInputElement>('#native-review input[value="approved"]')?.checked).toBe(true);
    expect([...document.querySelectorAll<HTMLInputElement>('input[value="approved"]')].filter((radio) => radio.checked)).toHaveLength(1);
  });

  it('reports a disabled native outcome as unavailable even when its drawer toggle is enabled', async () => {
    document.body.innerHTML = `<button data-testid="review-drawer-toggle">Your review</button>${writer(true)}`;
    expect(readGitLabActions(document, permissions).find((action) => action.kind === 'approve')?.available).toBe(false);
    expect(await openGitLabReviewAction('approve', permissions)).toBe(false);
  });

  it.each(['disabled', 'removed-radio', 'removed-form', 'navigation'])('abandons native summary hydration when its original review becomes %s', async (race) => {
    vi.useFakeTimers();
    document.body.innerHTML = writer().replace('<textarea data-testid="comment-textarea"></textarea>', '<input data-testid="placeholder-input-field">');
    const placeholder = document.querySelector('input[data-testid="placeholder-input-field"]');
    const radio = document.querySelector<HTMLInputElement>('input[value="approved"]');
    const form = document.querySelector('form');
    placeholder?.addEventListener('focus', () => {
      setTimeout(() => {
        if (race === 'disabled' && radio !== null) radio.disabled = true;
        if (race === 'removed-radio') radio?.remove();
        if (race === 'removed-form') form?.remove();
        if (race === 'navigation') {
          window.history.replaceState(null, '', '/group/repo/-/merge_requests/8');
          window.dispatchEvent(new Event('wxt:locationchange'));
        }
        const field = document.createElement('textarea');
        field.setAttribute('data-testid', 'comment-textarea');
        placeholder?.replaceWith(field);
      }, 10);
    });
    const pending = openGitLabReviewAction('approve', permissions);
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toBe(false);
    expect(document.activeElement?.getAttribute('data-testid')).not.toBe('comment-textarea');
    expect(vi.getTimerCount()).toBe(0);
  });
});
