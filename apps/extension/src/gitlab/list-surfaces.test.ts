// @vitest-environment happy-dom
import { gitLabListRows } from './list-surfaces';

beforeEach(() => {
  window.location.href = 'https://gitlab.com/groups/gitlab-org/-/merge_requests';
  document.body.innerHTML = '';
});

it('uses actual MR title identity and login on project and cross-project group lists', () => {
  // The shared IssuableList component is observed on the public project list.
  document.body.innerHTML = '<ul><li class="merge-request" data-testid="issuable-container"><a data-testid="issuable-title-link" href="/gitlab-org/gitlab/-/merge_requests/266882">Fix flaky requests</a><div class="issuable-info"><span data-testid="issuable-reference">!266882</span><a data-testid="issuable-author" data-username="mdangelo6">Matt</a></div></li><li class="merge-request" data-testid="issuable-container"><a data-testid="issuable-title-link" href="/gitlab-org/quality/triage-ops/-/merge_requests/4508">Quality</a><div class="issuable-info"></div></li></ul>';
  expect(gitLabListRows(document).map(({ url, author }) => ({ url, author }))).toEqual([
    { url: 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266882', author: 'mdangelo6' },
    { url: 'https://gitlab.com/gitlab-org/quality/triage-ops/-/merge_requests/4508', author: null },
  ]);
});

it('matches the installed public group capture across projects and nested subgroups without parsing display references', () => {
  // Reduced from installed-browser-run-41327802465/gitlab-group-mr-list-discovery.html.
  const captured = [
    { id: '559693780', path: 'gitlab-org/gitlab', number: '266890', author: 'mrincon', title: 'Draft: [skip ci] TODO: Pass a real commit SHA in the commit pipelines spec' },
    { id: '559681270', path: 'gitlab-org/gitlab-runner', number: '7745', author: 'jmrp', title: 'Fix FF_KUBERNETES_HONOR_ENTRYPOINT duplicating job logs on non-UTC nodes' },
    { id: '559681177', path: 'gitlab-org/cli', number: '4272', author: 'jmrp', title: 'docs(artifact-registry): correct the token exchange prerequisite' },
    { id: '559680899', path: 'gitlab-org/editor-extensions/gitlab-lsp', number: '4630', author: 'stealth-donut', title: 'fix(cli): show the real failure reason on resumed sessions' },
  ];
  document.body.innerHTML = '<ul>' + captured.map((item) => `<li class="issue merge-request" id="issuable_${item.id}" data-qa-issue-id="${item.id}" data-testid="issuable-container"><div class="issuable-main-info"><div data-testid="issuable-title"><a class="gl-link issue-title-text" href="/${item.path}/-/merge_requests/${item.number}" id="listItem-${item.path}/${item.id}" data-testid="issuable-title-link"><span>${item.title}</span></a></div><div class="issuable-info"><span data-testid="issuable-reference">${item.path}!${item.number}</span><span aria-hidden="true">·</span><span class="issuable-authored">created <button data-testid="issuable-created-at"><time>1 hour ago</time></button> by <a href="/${item.author}" data-username="${item.author}" data-testid="issuable-author"><span class="author">Display name</span></a></span><span data-geld-ui class="geld-provider-list-counts" role="status">Counting changes…</span></div></div><div class="issuable-meta"><ul><li data-testid="issuable-status">Open</li></ul></div></li>`).join('') + '</ul>';
  const rows = gitLabListRows(document);
  expect(rows.map(({ root, url, author }) => ({ id: root.id, url, author }))).toEqual(captured.map((item) => ({ id: `issuable_${item.id}`, url: `https://gitlab.com/${item.path}/-/merge_requests/${item.number}`, author: item.author })));
  expect(rows.every(({ host }) => host.classList.contains('issuable-info'))).toBe(true);
  expect(rows.every(({ root, host }) => root.contains(host) && host.querySelectorAll('.geld-provider-list-counts').length === 1)).toBe(true);
});

it('supports the source-declared standalone IssuableItem wrapper without matching issue cards', () => {
  // Official issuable_item.vue, not a live authenticated dashboard capture.
  document.body.innerHTML = '<li class="merge-request" data-testid="issuable-item-wrapper"><a data-testid="issuable-title-link" href="/acme/sub/widgets/-/merge_requests/42/diffs?diff_id=123">MR</a><div class="issuable-info"></div></li><li data-testid="issuable-item-wrapper"><a data-testid="issuable-title-link" href="/acme/sub/widgets/-/issues/42">Issue</a><div class="issuable-info"></div></li>';
  expect(gitLabListRows(document).map(({ url }) => url)).toEqual(['https://gitlab.com/acme/sub/widgets/-/merge_requests/42']);
});

it('rejects external, missing and standalone-commit targets even inside MR-shaped wrappers', () => {
  document.body.innerHTML = '<ul>' + ['https://example.com/acme/widgets/-/merge_requests/42', '/acme/widgets/-/commit/13215ca460cd4f75d3765a882ef486aa2dacf549', '/acme/widgets/-/issues/42', ''].map((href) => `<li class="merge-request" data-testid="issuable-container"><a data-testid="issuable-title-link" ${href === '' ? '' : `href="${href}"`}>Title</a><div class="issuable-info"></div></li>`).join('') + '</ul>';
  expect(gitLabListRows(document)).toEqual([]);
});

it('does not rediscover Geld-owned row clones or move native author and status children', () => {
  document.body.innerHTML = '<section data-geld-ui><li class="merge-request" data-testid="issuable-container"><a data-testid="issuable-title-link" href="/a/b/-/merge_requests/1">Clone</a><div class="issuable-info"></div></li></section><li class="merge-request" data-testid="issuable-container"><a data-testid="issuable-title-link" href="/a/b/-/merge_requests/2">Native</a><div class="issuable-info"><a data-testid="issuable-author" data-username="alice">Alice</a><span data-testid="issuable-status">Open</span></div></li>';
  const host = document.querySelector('body > li .issuable-info');
  const before = host?.innerHTML;
  expect(gitLabListRows(document)).toHaveLength(1);
  expect(host?.innerHTML).toBe(before);
});

function mrCard(project = 'gitlab-org/gitlab', number = '266882', describedBy = 'mr-card'): void {
  // Official issuable/popover/components/mr_popover.vue structure.
  document.body.innerHTML = `<a data-reference-type="merge_request" data-project-path="${project}" data-iid="${number}" aria-describedby="${describedBy}" href="/${project}/-/merge_requests/${number}">!${number}</a><div class="gl-popover" role="tooltip" id="mr-card"><div class="popover-body"><div class="mr-popover"><div class="gl-flex"><span>Open</span></div><h5>MR title</h5><div class="gl-text-subtle"><svg></svg><span>${project}!${number}</span></div></div></div></div>`;
}

it('associates the native MR card through its real trigger and exact displayed reference', () => {
  mrCard();
  const rows = gitLabListRows(document);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ root: document.getElementById('mr-card'), host: document.querySelector('.mr-popover > .gl-text-subtle'), url: 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266882', author: null });
  document.querySelector('a')?.setAttribute('data-iid', '266883');
  expect(gitLabListRows(document)).toEqual([]);
});

it('does not attach an MR card to stale, hidden, unrelated, cross-project or external triggers', () => {
  mrCard('acme/sub/widgets', '42', 'old-card');
  expect(gitLabListRows(document)).toEqual([]);
  document.querySelector('a')?.setAttribute('aria-describedby', 'mr-card');
  expect(gitLabListRows(document)).toHaveLength(1);
  document.querySelector('.mr-popover > .gl-text-subtle > span')?.replaceChildren('other/project!42');
  expect(gitLabListRows(document)).toEqual([]);
  mrCard();
  document.getElementById('mr-card')?.setAttribute('aria-hidden', 'true');
  expect(gitLabListRows(document)).toEqual([]);
  mrCard();
  document.querySelector('a')?.setAttribute('href', 'https://example.com/gitlab-org/gitlab/-/merge_requests/266882');
  expect(gitLabListRows(document)).toEqual([]);
});

it('finds the source-declared native commit card using agreeing title and SHA targets', () => {
  // Official issuable/popover/components/commit_popover.vue, not a live installed-extension result.
  const url = '/gitlab-org/gitlab/-/commit/13215ca460cd4f75d3765a882ef486aa2dacf549';
  document.body.innerHTML = `<div class="gl-popover" role="tooltip" id="commit-card"><div class="popover-body"><div class="gl-flex gl-flex-col"><div data-testid="commit-authored-text">Authored recently</div><a data-testid="commit-title-link" href="${url}">Fix handling</a><div><span data-testid="commit-author-name">Alice</span></div><div><svg></svg><a data-testid="commit-sha-link" href="${url}">13215ca4</a></div></div></div></div>`;
  expect(gitLabListRows(document)).toMatchObject([{ root: document.getElementById('commit-card'), url: `https://gitlab.com${url}`, author: null }]);
  document.querySelector('[data-testid="commit-sha-link"]')?.setAttribute('href', `${url.slice(0, -1)}0`);
  expect(gitLabListRows(document)).toEqual([]);
});

it('supports the second native CommitPopover component with grouped author and revision content', () => {
  // Official vue_shared/components/commit_popover.vue has one extra grouping row.
  const url = '/acme/sub/widgets/-/commit/13215ca460cd4f75d3765a882ef486aa2dacf549';
  document.body.innerHTML = `<div class="gl-popover" role="tooltip" data-testid="commit-popover" id="commit-card"><div class="popover-body"><div class="gl-flex gl-flex-col"><div data-testid="commit-authored-time">Authored recently</div><a data-testid="commit-title-link" href="${url}">Fix handling</a><div><div><span data-testid="commit-author">Alice</span></div><div><a data-testid="commit-sha-link" href="${url}">13215ca4</a></div></div></div></div></div>`;
  expect(gitLabListRows(document)).toHaveLength(1);
  const host = gitLabListRows(document)[0]?.host;
  const before = host?.innerHTML;
  host?.insertAdjacentHTML('beforeend', '<span data-geld-ui class="geld-provider-list-counts">+2 −1</span>');
  expect(gitLabListRows(document)[0]?.host).toBe(host);
  expect(host?.innerHTML).toContain(before ?? '');
});
