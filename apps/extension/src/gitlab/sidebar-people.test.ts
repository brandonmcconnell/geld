// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest';
import type { ProviderReviewSnapshot } from '../providers/types';
import { gitLabSidebarPeople } from './sidebar-people';

const url = 'https://gitlab.com/group/project/-/merge_requests/1';
const snapshot: ProviderReviewSnapshot = {
  input: { subject: { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/project', id: '1', headSha: 'a'.repeat(40) }, threads: [], reviewers: [{ author: { id: '25721282', login: 'aslota' }, state: 'approved' }] },
  comments: [], events: [], complete: true, unavailable: [], approvalsRequired: null, approvalsLeft: null, actions: [],
};
const markup = '<aside data-testid="issuable-sidebar" data-issuable-type="merge_request"><div data-testid="reviewers-block-container"><div data-testid="reviewer"><a class="js-user-link" href="https://gitlab.com/aslota" data-user-id="25721282" data-username="aslota">Agnes Slota</a><span>Approved</span></div></div></aside>';
beforeEach(() => { window.location.href = url;document.body.innerHTML = markup; });

it('matches a native reviewer row by observed account ID and canonical profile, without changing it', () => {
  const before = document.body.innerHTML;
  expect(gitLabSidebarPeople(document, snapshot)).toEqual([{ root: document.querySelector('[data-testid="reviewer"]'), authorId: '25721282' }]);
  expect(document.body.innerHTML).toBe(before);
});

it.each(['data-user-id', 'data-username', 'href'])('rejects a mismatched %s rather than matching the display name', attribute => {
  document.querySelector('a')?.setAttribute(attribute, attribute === 'href' ? 'https://example.com/aslota' : 'other');
  expect(gitLabSidebarPeople(document, snapshot)).toEqual([]);
});

it('rejects unobserved accounts, another review, ambiguous sidebars and author-supplied markup', () => {
  expect(gitLabSidebarPeople(document, { ...snapshot, input: { ...snapshot.input, reviewers: [] } })).toEqual([]);
  window.location.href = url.replace('/1', '/2');expect(gitLabSidebarPeople(document, snapshot)).toEqual([]);
  window.location.href = url;document.body.innerHTML += markup;expect(gitLabSidebarPeople(document, snapshot)).toEqual([]);
  document.body.innerHTML = `<div class="md">${markup}</div>`;expect(gitLabSidebarPeople(document, snapshot)).toEqual([]);
});
