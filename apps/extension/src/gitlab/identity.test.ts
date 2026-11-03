// @vitest-environment happy-dom
import { gitLabReviewIdentity } from './review';

afterEach(() => document.body.replaceChildren());

it('reads the exact native current account independently of whether a drawer or writer has hydrated', () => {
  document.body.innerHTML = `<div id="js-vue-mr-discussions" data-current-user-data='{"id":10}'></div>`;
  expect(gitLabReviewIdentity(document)).toBe('user:10');
  document.querySelector('#js-vue-mr-discussions')?.setAttribute('data-current-user-data', '{"id":11}');
  expect(gitLabReviewIdentity(document)).toBe('user:11');
});

it.each(['null', '{}', '{"id":0}', 'malformed'])('treats a present native anonymous or invalid account as signed out despite an older SSR flag: %s', (value) => {
  document.body.innerHTML = '<div class="js-mr-title-actions" data-is-signed-in="true"></div><div id="js-vue-mr-discussions"></div>';
  document.querySelector('#js-vue-mr-discussions')?.setAttribute('data-current-user-data', value);
  expect(gitLabReviewIdentity(document)).toBeNull();
});

it('rejects ambiguous native account metadata while ignoring owned display copies and comment HTML', () => {
  document.body.innerHTML = `<div id="js-vue-mr-discussions" data-current-user-data='{"id":10}'></div><div data-geld-ui><div id="js-vue-mr-discussions" data-current-user-data='{"id":11}'></div></div><div class="note-body"><div id="js-vue-mr-discussions" data-current-user-data='{"id":12}'></div></div>`;
  expect(gitLabReviewIdentity(document)).toBe('user:10');
  document.body.insertAdjacentHTML('beforeend', `<div id="js-vue-mr-discussions" data-current-user-data='{"id":13}'></div>`);
  expect(gitLabReviewIdentity(document)).toBeNull();
});

it('uses only one native SSR sign-in flag when mounted current-user metadata is absent', () => {
  document.body.innerHTML = '<div class="js-mr-title-actions" data-is-signed-in="true"></div>';
  expect(gitLabReviewIdentity(document)).toBe('signed-in');
  document.body.insertAdjacentHTML('beforeend', '<div class="js-mr-title-actions" data-is-signed-in="false"></div>');
  expect(gitLabReviewIdentity(document)).toBeNull();
});
