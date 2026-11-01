// @vitest-environment happy-dom
import { readBitbucketActions } from './actions';

beforeEach(() => {
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
