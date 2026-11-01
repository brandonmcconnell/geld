// @vitest-environment happy-dom
import { readBitbucketActions } from './actions';

vi.mock('wxt/utils/storage', () => ({ storage: {
  getItem: async () => null, setItem: async () => undefined, watch: () => () => undefined,
  defineItem: () => ({ getValue: async () => ({}), setValue: async () => undefined, watch: () => () => undefined }),
} }));

beforeEach(() => {
  vi.restoreAllMocks();
  window.location.href = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27';
  document.head.innerHTML = '<meta id="bb-bootstrap" data-current-user=\'{"isAuthenticated":false}\'>';
  // Anonymous PR27 exposes this collapsed native composer even with Log in present.
  document.body.innerHTML = '<a href="https://bitbucket.org/account/signin/">Log in</a><section data-qa="conversations-global-style"><input data-testid="chrome-collapsed" placeholder="What do you want to say?"></section>';
});

it('does not treat the anonymous composer as permission to submit a review', async () => {
  const actions = readBitbucketActions(document);
  expect(actions.map((action) => action.available)).toEqual([false, false, false]);
  expect(actions.every((action) => action.reason === 'Sign in to Bitbucket to review.')).toBe(true);
  expect(await Promise.all(actions.map((action) => action.activate()))).toEqual([false, false, false]);
});

it('opens only the actual native composer and never invents approval or request-change controls', async () => {
  document.querySelector('a')?.remove();
  document.head.querySelector('meta')?.setAttribute('data-current-user', '{"isAuthenticated":true}');
  const click = vi.fn();
  const field = document.querySelector('input');
  field?.addEventListener('click', click);
  const actions = readBitbucketActions(document);
  expect(actions.map((action) => action.available)).toEqual([false, false, true]);
  expect(await actions[0]?.activate()).toBe(false);
  expect(await actions[1]?.activate()).toBe(false);
  expect(await actions[2]?.activate()).toBe(true);
  expect(document.activeElement).toBe(field);
  expect(click).toHaveBeenCalledOnce();
});

it('rechecks the page, native connection, and disabled state before activation', async () => {
  document.querySelector('a')?.remove();
  document.head.querySelector('meta')?.setAttribute('data-current-user', '{"isAuthenticated":true}');
  const action = readBitbucketActions(document)[2];
  const field = document.querySelector('input');
  if (field === null) throw new Error('Missing composer');
  field.disabled = true;
  expect(await action?.activate()).toBe(false);
  field.disabled = false;
  window.location.href = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/44';
  expect(await action?.activate()).toBe(false);
});

it('requires explicit authenticated bootstrap metadata even when the login link is missing', async () => {
  document.querySelector('a')?.remove();
  const meta = document.head.querySelector('meta');
  if (meta === null) throw new Error('Missing bootstrap');
  for (const source of ['{"isAuthenticated":false}', '{"isAuthenticated":"true"}', '{}', 'null', 'true', '[]', '{broken']) {
    meta.setAttribute('data-current-user', source);
    const comment = readBitbucketActions(document)[2];
    expect(comment?.available).toBe(false);
    expect(await comment?.activate()).toBe(false);
  }
  meta.remove();
  const comment = readBitbucketActions(document)[2];
  expect(comment?.available).toBe(false);
  expect(await comment?.activate()).toBe(false);
});

it('rechecks authentication at activation and ignores copied bootstrap markup in the body', async () => {
  const meta = document.head.querySelector('meta');
  meta?.setAttribute('data-current-user', '{"isAuthenticated":true}');
  const comment = readBitbucketActions(document)[2];
  expect(comment?.available).toBe(true);
  meta?.setAttribute('data-current-user', '{"isAuthenticated":false}');
  expect(await comment?.activate()).toBe(false);
  document.body.insertAdjacentHTML('afterbegin', '<section data-geld-ui><meta id="bb-bootstrap" data-current-user=\'{"isAuthenticated":true}\'></section>');
  expect(readBitbucketActions(document)[2]?.available).toBe(false);
});

// Source fixtures, NOT authenticated browser captures: props from observed preload
// page.da841cca.js modules LhpXT/9nhc6/6iVT3/7xffk/h8u0J/lIn13.
// Native handlers below only increment test counters; no provider writes occur.
function nativeReviewHeader(): void {
  document.head.querySelector('meta')?.setAttribute('data-current-user', '{"isAuthenticated":true}');
  document.body.insertAdjacentHTML('afterbegin', `<div data-testid="pr-header">
    <nav><a href="/atlassian/bitbucket-upload-file/src">bitbucket-upload-file</a></nav>
    <div data-qa="pr-branches-and-state-styles"><span>Merged</span></div><span>#27 • Created 2025-07-01</span>
    <button aria-pressed="false" aria-label="Approve this pull request">Approve</button>
    <button aria-pressed="false" aria-label="Remove changes requested state from this pull request">Request changes</button>
  </div>`);
}

function nativeButton(kind: 'approve' | 'request-changes'): HTMLButtonElement {
  const label = kind === 'approve' ? 'Approve this pull request' : 'Remove changes requested state from this pull request';
  const button = document.querySelector<HTMLButtonElement>(`[data-testid="pr-header"] button[aria-label="${label}"]`);
  if (button === null) throw new Error('Missing native source fixture button');
  return button;
}

it('relays each exact unselected native review action once without changing the composer draft', async () => {
  nativeReviewHeader();
  const field = document.querySelector('input');
  if (field === null) throw new Error('Missing composer');
  field.value = 'Unsent review draft';
  for (const [index, kind] of ['approve', 'request-changes'].entries()) {
    if (kind !== 'approve' && kind !== 'request-changes') throw new Error('Unexpected fixture kind');
    const button = nativeButton(kind);
    const click = vi.fn();
    button.addEventListener('click', click);
    const action = readBitbucketActions(document)[index];
    expect(action?.available).toBe(true);
    expect(await action?.activate()).toBe(true);
    expect(click).toHaveBeenCalledOnce();
    expect(field.value).toBe('Unsent review draft');
    expect(button.getAttribute('aria-pressed')).toBe('false');
  }
});

it('preserves the source-specific reversed request-changes ARIA wording', async () => {
  nativeReviewHeader();
  const button = nativeButton('request-changes');
  button.setAttribute('aria-label', 'Request changes on this pull request');
  expect(readBitbucketActions(document)[1]?.available).toBe(false);
  button.setAttribute('aria-label', 'Remove changes requested state from this pull request');
  expect(readBitbucketActions(document)[1]?.available).toBe(true);
  button.setAttribute('aria-pressed', 'true');
  button.textContent = 'Changes requested';
  expect(readBitbucketActions(document)[1]?.available).toBe(false);
});

it('never turns already-approved or changes-requested state into an undo action', async () => {
  nativeReviewHeader();
  const actions = readBitbucketActions(document);
  const approve = nativeButton('approve');
  const changes = nativeButton('request-changes');
  const clicked = vi.fn();
  approve.addEventListener('click', clicked);
  changes.addEventListener('click', clicked);
  approve.setAttribute('aria-pressed', 'true');
  approve.setAttribute('aria-label', 'Unapprove this pull request');
  approve.textContent = 'Unapprove';
  changes.setAttribute('aria-pressed', 'true');
  changes.setAttribute('aria-label', 'Request changes on this pull request');
  changes.textContent = 'Changes requested';
  expect(readBitbucketActions(document).slice(0, 2).map((action) => action.available)).toEqual([false, false]);
  expect(await actions[0]?.activate()).toBe(false);
  expect(await actions[1]?.activate()).toBe(false);
  expect(clicked).not.toHaveBeenCalled();
});

it.each([
  'disabled', 'readonly', 'aria-disabled', 'aria-readonly', 'fieldset', 'hidden', 'aria-hidden', 'inert', 'inline-display', 'inline-visibility', 'owned-ui', 'comment-body', 'sticky-copy',
])('blocks native review controls under %s initially and before a stale action activates', async (blocked) => {
  nativeReviewHeader();
  const button = nativeButton('approve');
  const click = vi.fn();
  button.addEventListener('click', click);
  const original = readBitbucketActions(document)[0];
  if (blocked === 'disabled' || blocked === 'readonly' || blocked === 'hidden' || blocked === 'inert') button.setAttribute(blocked, '');
  else if (blocked === 'aria-disabled' || blocked === 'aria-readonly' || blocked === 'aria-hidden') button.setAttribute(blocked, 'true');
  else if (blocked === 'inline-display') button.style.display = 'none';
  else if (blocked === 'inline-visibility') button.style.visibility = 'hidden';
  else if (blocked === 'sticky-copy') button.tabIndex = -1;
  else {
    const wrapper = document.createElement(blocked === 'fieldset' ? 'fieldset' : 'div');
    if (blocked === 'fieldset') wrapper.setAttribute('disabled', '');
    if (blocked === 'owned-ui') wrapper.setAttribute('data-geld-ui', '');
    if (blocked === 'comment-body') wrapper.setAttribute('data-testid', 'comment-content');
    button.replaceWith(wrapper);
    wrapper.append(button);
  }
  expect(readBitbucketActions(document)[0]?.available).toBe(false);
  expect(await original?.activate()).toBe(false);
  expect(click).not.toHaveBeenCalled();
});

it('rejects ambiguous native buttons and ignores an explicitly unfocusable sticky copy', async () => {
  nativeReviewHeader();
  const original = nativeButton('approve');
  original.insertAdjacentHTML('afterend', original.outerHTML);
  expect(readBitbucketActions(document)[0]?.available).toBe(false);
  const copy = original.nextElementSibling;
  copy?.setAttribute('tabindex', '-1');
  expect(readBitbucketActions(document)[0]?.available).toBe(true);
  const actions = readBitbucketActions(document);
  original.remove();
  copy?.removeAttribute('tabindex');
  const replacementClick = vi.fn();
  copy?.addEventListener('click', replacementClick);
  expect(await actions[0]?.activate()).toBe(false);
  expect(replacementClick).not.toHaveBeenCalled();
  expect(readBitbucketActions(document)[0]?.available).toBe(true);
});

it('does not let a rich comment manufacture a header action', () => {
  document.body.innerHTML = '<section data-testid="comment-content"></section>';
  nativeReviewHeader();
  const header = document.querySelector('[data-testid="pr-header"]');
  if (header === null) throw new Error('Missing header');
  document.querySelector('section')?.append(header);
  expect(readBitbucketActions(document).map((action) => action.available)).toEqual([false, false, false]);
});

it.each(['number', 'repository', 'foreign-repository', 'unsupported-page', 'stale-visit', 'signed-out'])('rejects %s native identity changes before activation', async (change) => {
  nativeReviewHeader();
  const action = readBitbucketActions(document)[0];
  const click = vi.fn();
  nativeButton('approve').addEventListener('click', click);
  if (change === 'number') document.querySelector('[data-qa="pr-branches-and-state-styles"] + span')?.replaceChildren('#44 • Created 2025-07-01');
  if (change === 'repository') document.querySelector('[data-testid="pr-header"] a')?.setAttribute('href', '/atlassian/other/src');
  if (change === 'foreign-repository') document.querySelector('[data-testid="pr-header"] a')?.setAttribute('href', 'https://evil.example/atlassian/bitbucket-upload-file/src');
  if (change === 'unsupported-page') window.location.href = 'https://bitbucket.org/atlassian/bitbucket-upload-file/commits/9777bca47119';
  if (change === 'stale-visit') window.location.href = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/44';
  if (change === 'signed-out') document.head.querySelector('meta')?.setAttribute('data-current-user', '{"isAuthenticated":false}');
  expect(await action?.activate()).toBe(false);
  expect(click).not.toHaveBeenCalled();
});

it('preserves comment drafts and rejects a replaced composer or focus-time authentication change', async () => {
  nativeReviewHeader();
  const field = document.querySelector('input');
  if (field === null) throw new Error('Missing composer');
  field.value = 'Existing native draft';
  field.setSelectionRange(4, 8);
  const action = readBitbucketActions(document)[2];
  expect(await action?.activate()).toBe(true);
  expect(field.value).toBe('Existing native draft');
  expect(field.selectionStart).toBe(4);
  expect(field.selectionEnd).toBe(8);
  field.blur();
  field.addEventListener('focus', () => document.head.querySelector('meta')?.setAttribute('data-current-user', '{"isAuthenticated":false}'), { once: true });
  const click = vi.fn();
  field.addEventListener('click', click);
  expect(await readBitbucketActions(document)[2]?.activate()).toBe(false);
  expect(click).not.toHaveBeenCalled();
  document.head.querySelector('meta')?.setAttribute('data-current-user', '{"isAuthenticated":true}');
  const stale = readBitbucketActions(document)[2];
  field.outerHTML = field.outerHTML;
  expect(await stale?.activate()).toBe(false);
});

it('keeps snapshot actions live between API refreshes and binds them to the original PR', async () => {
  const review = await import('./review');
  const { bitbucketAdapter } = await import('./index');
  const { describeBitbucketPage } = await import('./page');
  const page = describeBitbucketPage(new URL(document.URL));
  if (page === null || bitbucketAdapter.fetchReview === undefined) throw new Error('Missing fixture adapter');
  const mocked = vi.spyOn(review, 'fetchBitbucketReview').mockResolvedValue({
    input: { subject: { provider: 'bitbucket', origin: 'https://bitbucket.org', repository: page.repository.path, id: page.number, headSha: 'a'.repeat(40) }, threads: [], closed: true },
    comments: [], events: [], tasks: [], complete: false, unavailable: [], approvalsRequired: null, approvalsLeft: null, actions: [],
  });
  try {
    const snapshot = await bitbucketAdapter.fetchReview(page, new AbortController().signal, document);
    expect(snapshot.actions[0]?.available).toBe(false);
    nativeReviewHeader();
    // Native source allows approval on some closed PRs; API closed is not a permission override.
    expect(snapshot.actions[0]?.available).toBe(true);
    nativeButton('approve').disabled = true;
    expect(snapshot.actions[0]?.available).toBe(false);
    nativeButton('approve').disabled = false;
    window.location.href = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/44';
    expect(snapshot.actions.every((action) => !action.available)).toBe(true);
    expect(mocked).toHaveBeenCalledOnce();
  } finally { mocked.mockRestore(); }
});


it('rejects a stylesheet-hidden native control without reading its geometry', async () => {
  nativeReviewHeader();
  const button = nativeButton('approve');
  const action = readBitbucketActions(document)[0];
  const rect = vi.spyOn(button, 'getBoundingClientRect');
  const clicked = vi.fn();
  button.addEventListener('click', clicked);
  document.head.insertAdjacentHTML('beforeend', '<style>.native-hidden-review { display: none; }</style>');
  button.className = 'native-hidden-review';
  expect(readBitbucketActions(document)[0]?.available).toBe(false);
  expect(await action?.activate()).toBe(false);
  expect(rect).not.toHaveBeenCalled();
  expect(clicked).not.toHaveBeenCalled();
});

it('does not click a native composer that cannot receive focus', async () => {
  nativeReviewHeader();
  const field = document.querySelector('input');
  if (field === null) throw new Error('Missing composer');
  const clicked = vi.fn();
  field.addEventListener('click', clicked);
  vi.spyOn(field, 'focus').mockImplementation(() => undefined);
  expect(await readBitbucketActions(document)[2]?.activate()).toBe(false);
  expect(clicked).not.toHaveBeenCalled();
});
