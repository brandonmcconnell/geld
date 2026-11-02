// @vitest-environment happy-dom
import type { GitLabReviewCapabilities } from './review';
import { gitLabActionVisit, openGitLabReviewAction, readGitLabActions } from './actions';

const permissions: GitLabReviewCapabilities = { signedIn: true, canApprove: true, canComment: true, canReview: true, requestChanges: 'unknown' };

function writer(disabled = false): string {
  return `<form data-testid="submit-gl-form"><div data-testid="reviewer_states"><input type="radio" name="outcome" value="reviewed"><input type="radio" name="outcome" value="approved"${disabled ? ' disabled' : ''}><input type="radio" name="outcome" value="requested_changes"></div><textarea data-testid="comment-textarea"></textarea><button data-testid="submit-review-button" type="submit">Submit</button></form>`;
}

function mount(html: string): void {
  document.body.innerHTML = `<div id="js-vue-mr-discussions" data-current-user-data='{"id":10}'></div>${html}`;
}

beforeEach(() => { window.location.href = 'https://gitlab.com/group/repo/-/merge_requests/7'; });
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.useRealTimers(); });

describe('GitLab native quick action relay', () => {
  it('opens the actual native drawer and selects an outcome without submitting', async () => {
    mount('<button data-testid="review-drawer-toggle">Your review</button>');
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
    mount('<button data-testid="review-drawer-toggle">Your review</button>');
    const clicked = vi.fn();
    document.querySelector('button')?.addEventListener('click', clicked);
    expect(await openGitLabReviewAction('approve', { ...permissions, signedIn: false })).toBe(false);
    expect(await openGitLabReviewAction('approve', { ...permissions, canApprove: false })).toBe(false);
    expect(clicked).not.toHaveBeenCalled();
    expect(readGitLabActions(document, { ...permissions, signedIn: false }).every((action) => !action.available)).toBe(true);
  });

  it('respects a disabled native outcome and never clicks a mount or the submit button', async () => {
    mount(`<div data-testid="review-drawer-toggle"></div>${writer(true)}`);
    const submitted = vi.fn();
    document.querySelector('[data-testid="submit-review-button"]')?.addEventListener('click', submitted);
    expect(await openGitLabReviewAction('approve', permissions)).toBe(false);
    expect(submitted).not.toHaveBeenCalled();
  });

  it('focuses an existing native comment writer without navigation or fake forms', async () => {
    mount('<textarea id="note-body"></textarea>');
    expect(await openGitLabReviewAction('comment', { ...permissions, canReview: false })).toBe(true);
    expect(document.activeElement?.id).toBe('note-body');
    expect(document.querySelector('form')).toBeNull();
  });

  it('selects native requested_changes independently from approval permissions', async () => {
    mount(writer());
    expect(await openGitLabReviewAction('request-changes', { ...permissions, canApprove: false })).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[value="requested_changes"]')?.checked).toBe(true);
    expect(await openGitLabReviewAction('request-changes', { ...permissions, requestChanges: 'unavailable' })).toBe(false);
  });

  it('does not select another merge request’s outcome after delayed drawer hydration', async () => {
    const original = window.location.href;
    mount('<button data-testid="review-drawer-toggle">Your review</button>');
    const pending = openGitLabReviewAction('approve', permissions);
    try {
      window.history.replaceState(null, '', '/group/repo/-/merge_requests/43');
      mount(writer());
      expect(await pending).toBe(false);
      expect(document.querySelector<HTMLInputElement>('input[value="approved"]')?.checked).toBe(false);
    } finally { window.history.replaceState(null, '', original); }
  });

  it('hydrates the source-verified optional summary placeholder and focuses its delayed native editor', async () => {
    vi.useFakeTimers();
    mount('<textarea id="note-body">Unrelated main comment draft</textarea><button data-testid="review-drawer-toggle">Your review</button>');
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
      const pending = openGitLabReviewAction('approve', permissions);
      await vi.advanceTimersByTimeAsync(200);
      expect(await pending).toBe(true);
      expect(document.activeElement?.getAttribute('data-testid')).toBe('comment-textarea');
      expect(document.querySelector<HTMLTextAreaElement>('textarea[data-testid="comment-textarea"]')?.value).toBe('Existing native autosaved review summary');
      expect(document.querySelector<HTMLTextAreaElement>('#note-body')?.value).toBe('Unrelated main comment draft');
      expect(document.querySelector<HTMLInputElement>('input[value="approved"]')?.checked).toBe(true);
      expect(submit).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { document.removeEventListener('submit', submit); }
  });

  it('keeps an existing native review draft and selects only the exact live review form’s outcome', async () => {
    const native = writer().replace('<form ', '<form id="native-review" ');
    mount('<textarea id="note-body">Main draft</textarea>'
      + writer().replace('data-testid="submit-gl-form"', 'data-testid="other-form"')
      + `<section data-geld-ui>${writer()}</section><section hidden>${writer()}</section>${native}`);
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
    mount(`<button data-testid="review-drawer-toggle">Your review</button>${writer(true)}`);
    expect(readGitLabActions(document, permissions).find((action) => action.kind === 'approve')?.available).toBe(false);
    expect(await openGitLabReviewAction('approve', permissions)).toBe(false);
  });

  it.each(['disabled', 'removed-radio', 'removed-form', 'navigation'])('abandons native summary hydration when its original review becomes %s', async (race) => {
    vi.useFakeTimers();
    mount(writer().replace('<textarea data-testid="comment-textarea"></textarea>', '<input data-testid="placeholder-input-field">'));
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

  it('keeps unknown request-changes support unavailable until its exact enabled native outcome hydrates', async () => {
    mount('<button data-testid="review-drawer-toggle">Your review</button>');
    const toggle = document.querySelector('button');
    const clicked = vi.fn();toggle?.addEventListener('click', clicked);
    expect(readGitLabActions(document, permissions).find((action) => action.kind === 'request-changes')?.available).toBe(false);
    expect(await openGitLabReviewAction('request-changes', permissions)).toBe(false);
    expect(clicked).not.toHaveBeenCalled();
    document.body.insertAdjacentHTML('beforeend', writer());
    expect(readGitLabActions(document, permissions).find((action) => action.kind === 'request-changes')?.available).toBe(true);
  });

  it('refreshes disabled and removed outcomes from current DOM instead of borrowing the drawer permission', () => {
    mount(`<button data-testid="review-drawer-toggle">Your review</button>${writer()}`);
    const available = (): boolean => readGitLabActions(document, permissions).find((action) => action.kind === 'approve')?.available === true;
    const radio = document.querySelector<HTMLInputElement>('input[value="approved"]');
    const states = radio?.parentElement;
    if (radio === null || states === null || states === undefined) throw new Error('Missing native outcome.');
    expect(available()).toBe(true);radio.disabled = true;expect(available()).toBe(false);
    radio.disabled = false;expect(available()).toBe(true);
    radio.remove();expect(available()).toBe(false);states.append(radio);expect(available()).toBe(true);
  });

  it.each(['hidden', 'css-hidden', 'aria-disabled', 'readonly', 'fieldset-disabled', 'writer-readonly', 'duplicate-form', 'duplicate-outcome', 'duplicate-writer'])('refuses a native form that is %s without selecting or submitting it', async (condition) => {
    mount(writer());
    const form = document.querySelector('form');
    const radio = document.querySelector<HTMLInputElement>('input[value="approved"]');
    const field = document.querySelector('textarea');
    if (form === null || radio === null || field === null) throw new Error('Missing native form.');
    if (condition === 'hidden') form.hidden = true;
    if (condition === 'css-hidden') form.style.display = 'none';
    if (condition === 'aria-disabled') radio.setAttribute('aria-disabled', 'true');
    if (condition === 'readonly') radio.setAttribute('readonly', '');
    if (condition === 'fieldset-disabled') form.innerHTML = `<fieldset disabled>${form.innerHTML}</fieldset>`;
    if (condition === 'writer-readonly') field.readOnly = true;
    if (condition === 'duplicate-form') document.body.insertAdjacentHTML('beforeend', writer());
    if (condition === 'duplicate-outcome') radio.parentElement?.append(radio.cloneNode());
    if (condition === 'duplicate-writer') form.append(field.cloneNode());
    const clicked = vi.fn();radio.addEventListener('click', clicked);
    expect(readGitLabActions(document, permissions).find((action) => action.kind === 'approve')?.available).toBe(false);
    expect(await openGitLabReviewAction('approve', permissions)).toBe(false);
    expect(clicked).not.toHaveBeenCalled();expect(radio.checked).toBe(false);
  });

  it.each(['sign-out', 'different-user', 'navigation', 'new-head', 'new-form'])('rejects a retained descriptor after %s before controller refresh', async (race) => {
    mount(writer());
    const visit = gitLabActionVisit(document, 'a'.repeat(40));
    const action = readGitLabActions(document, permissions, visit).find((entry) => entry.kind === 'approve');
    expect(action?.available).toBe(true);
    if (race === 'sign-out' || race === 'different-user') document.querySelector('#js-vue-mr-discussions')?.setAttribute('data-current-user-data', race === 'sign-out' ? 'null' : '{"id":11}');
    if (race === 'navigation') window.history.replaceState(null, '', '/group/repo/-/merge_requests/8');
    if (race === 'new-head') {
      const metadata = document.createElement('div');metadata.setAttribute('data-noteable-type', 'MergeRequest');
      metadata.setAttribute('data-noteable-data', JSON.stringify({ diff_head_sha: 'b'.repeat(40) }));document.body.append(metadata);
    }
    if (race === 'new-form') document.querySelector('form')?.remove();
    if (race === 'new-form') document.body.insertAdjacentHTML('beforeend', writer());
    expect(await action?.activate()).toBe(false);
    expect(document.querySelector<HTMLInputElement>('input[value="approved"]')?.checked).toBe(false);
  });

  it('allows a native source fragment change but never promotes the fetched approval ceiling', async () => {
    mount(writer());
    const denied = readGitLabActions(document, { ...permissions, canApprove: false });
    expect(denied.find((entry) => entry.kind === 'approve')?.available).toBe(false);
    expect(denied.find((entry) => entry.kind === 'request-changes')?.available).toBe(true);
    const approve = readGitLabActions(document, permissions).find((entry) => entry.kind === 'approve');
    window.history.replaceState(null, '', '#note_123');
    expect(await approve?.activate()).toBe(true);
  });

  it('refreshes a delayed main composer and rejects a retained descriptor after native replacement or readonly', async () => {
    mount('');
    expect(readGitLabActions(document, permissions).find((entry) => entry.kind === 'comment')?.available).toBe(false);
    document.body.insertAdjacentHTML('beforeend', '<textarea id="note-body">Keep native draft</textarea>');
    const stale = readGitLabActions(document, permissions).find((entry) => entry.kind === 'comment');
    expect(stale?.available).toBe(true);
    const field = document.querySelector<HTMLTextAreaElement>('#note-body');
    if (field === null) throw new Error('Missing native composer.');
    field.replaceWith(field.cloneNode(true));
    expect(await stale?.activate()).toBe(false);
    const current = readGitLabActions(document, permissions).find((entry) => entry.kind === 'comment');
    expect(await current?.activate()).toBe(true);
    const replacement = document.querySelector<HTMLTextAreaElement>('#note-body');
    expect(replacement?.value).toBe('Keep native draft');
    if (replacement !== null) replacement.readOnly = true;
    expect(await current?.activate()).toBe(false);
    expect(readGitLabActions(document, permissions).find((entry) => entry.kind === 'comment')?.available).toBe(false);
  });

  it('abandons delayed native drawer hydration immediately when current sign-in disappears', async () => {
    vi.useFakeTimers();mount('<button data-testid="review-drawer-toggle">Your review</button>');
    const pending = openGitLabReviewAction('approve', permissions);
    document.querySelector('#js-vue-mr-discussions')?.setAttribute('data-current-user-data', 'null');
    await vi.advanceTimersByTimeAsync(0);
    expect(await pending).toBe(false);expect(vi.getTimerCount()).toBe(0);
    document.body.insertAdjacentHTML('beforeend', writer());
    expect(document.querySelector<HTMLInputElement>('input[value="approved"]')?.checked).toBe(false);
  });

  it('does not report success when native focus handlers create an ambiguous writer around the still-connected field', async () => {
    mount(writer());
    const form = document.querySelector('form');
    const field = form?.querySelector('textarea');
    if (form === null || field === null || field === undefined) throw new Error('Missing native form.');
    field.value = 'Existing native draft';
    field.addEventListener('focus', () => form.append(field.cloneNode(true)), { once: true });
    expect(await openGitLabReviewAction('approve', permissions)).toBe(false);
    expect(field.isConnected).toBe(true);expect(document.activeElement).toBe(field);
    expect(field.value).toBe('Existing native draft');
    expect(form.querySelectorAll('textarea')).toHaveLength(2);
  });
});
