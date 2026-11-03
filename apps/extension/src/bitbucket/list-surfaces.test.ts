// @vitest-environment happy-dom
import { bitbucketListRows } from './list-surfaces';
import { describeBitbucketPage } from './page';

beforeEach(() => {
  window.location.href = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/?state=MERGED';
  // Reduced from the anonymous November 1, 2026 installed Chrome PR list capture.
  document.body.innerHTML = '<table><tbody><tr data-qa="pull-request-row"><td colspan="14"><div><span><a data-qa="pull-request-row-link" href="/atlassian/bitbucket-upload-file/pull-requests/27">BCAT-6005: Support API token</a></span><small><span data-testid="user-profile-card-trigger-wrapper">Albert Sundjaja</span> - #27</small></div></td><td colspan="23"><div><span><a data-qa="pull-request-row-link" href="/atlassian/bitbucket-upload-file/pull-requests/27">BCAT-6005: Support API token</a></span></div></td></tr></tbody></table>';
});

it('supports both native responsive title hosts without guessing a username from the display name', () => {
  const rows = bitbucketListRows(document);
  expect(rows).toHaveLength(2);
  expect(rows[0]?.root).toBe(rows[1]?.root);
  expect(rows[0]?.host).not.toBe(rows[1]?.host);
  expect(rows.every((row) => row.url === 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27' && row.author === null)).toBe(true);
  expect(rows[0]?.host.querySelector('a')?.textContent).toBe('BCAT-6005: Support API token');
});

it('rejects foreign links and clones rather than creating chips outside native review rows', () => {
  const row = document.querySelector('tr');
  if (row === null) throw new Error('Missing row');
  row.querySelector('a')?.setAttribute('href', 'https://example.com/a/b/pull-requests/1');
  row.querySelectorAll('a')[1]?.setAttribute('href', '/atlassian/bitbucket-upload-file/issues/27');
  document.body.insertAdjacentHTML('beforeend', '<section data-geld-ui><table><tr data-qa="pull-request-row"><td><span><a data-qa="pull-request-row-link" href="/a/b/pull-requests/1">Clone</a></span></td></tr></table></section>');
  expect(bitbucketListRows(document)).toEqual([]);
});

it('accepts the native comment permalink aliases while preserving canonical review identity', () => {
  const base = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22';
  expect(describeBitbucketPage(new URL(`${base}/_/diff#comment-471253038`))).toMatchObject({ kind: 'diff', number: '22', url: base, diffPageUrl: `${base}/diff` });
  expect(describeBitbucketPage(new URL(`${base}/_/overview#comment-471253038`))).toMatchObject({ kind: 'overview', number: '22', url: base });
  expect(describeBitbucketPage(new URL(`${base}/overview`))).toMatchObject({ kind: 'overview', number: '22', url: base, diffPageUrl: `${base}/diff` });
  expect(describeBitbucketPage(new URL(`${base}/overview/#comment-471253038`))).toMatchObject({ kind: 'overview', number: '22', url: base });
  for (const route of ['_/commits', '_/activity', '_/diff/other', '_/overview/other', 'overview/other']) expect(describeBitbucketPage(new URL(`${base}/${route}`))).toBeNull();
});
