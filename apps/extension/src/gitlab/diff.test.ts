// @vitest-environment happy-dom
import { describeGitLabPage } from './page';
import { gitLabHeaderTargets, gitLabListRows, readGitLabDiff } from './diff';

const HEAD = 'd7614ded66e446a388a52625ca13bcb19d43465c';
const BASE = 'b7c44b3b2a113a284afdc1d8c7ecedd3cc3bb2cf';

beforeEach(() => {
  document.body.innerHTML = '';
  window.location.href = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266882/diffs';
});

function rapid(): void {
  // Reduced from anonymous gitlab-org/gitlab!266882 Rapid Diffs, November 1, 2026.
  document.body.innerHTML = `<article data-rapid-diffs data-app-data='${JSON.stringify({ versions: { source_versions: [{ id: 2158495265, selected: true, head_sha: HEAD, base_sha: BASE }] } })}'>
    <div class="diff-stats inline-parallel-buttons"><div class="diff-stats-contents"><div class="diff-stats-group"><span>1 file</span></div><div aria-label="Added 4 lines."><span data-testid="js-file-addition-line">4</span></div><div aria-label="Removed 1 line."><span data-testid="js-file-deletion-line">1</span></div></div></div>
    <div data-diffs-list><diff-file id="bab0cb834" data-file-data='{"new_path":"spec/requests/api/graphql/project/work_items_spec.rb"}'>
      <header><button aria-label="Hide file contents" data-opened></button><button aria-label="Show file contents" data-closed></button><span class="rd-stats-added">+4</span><span class="rd-stats-removed">−1</span><input type="checkbox" data-viewed-checkbox disabled></header>
      <details data-file-body open><table><tbody><tr class="rd-hunk-lines rd-hunk-lines-inline"><td class="rd-line-number" data-position="old"></td><td class="rd-line-number" data-position="new"><a data-line-number="5"></a></td><td class="rd-line-content" data-change="added"><pre class="rd-line-text"># Clearing shared state\n</pre></td></tr></tbody></table></details>
    </diff-file></div></article>`;
}

it('describes nested project namespaces and the actual selected version', () => {
  rapid();
  const page = describeGitLabPage(new URL('https://gitlab.com/gitlab-org/quality/triage-ops/-/merge_requests/4508/diffs?w=1'), document);
  expect(page?.repository).toEqual({ provider: 'gitlab', origin: 'https://gitlab.com', path: 'gitlab-org/quality/triage-ops' });
  expect(page?.headSha).toBeNull();
  expect(page?.diffPageUrl).not.toContain('diff_id=2158495265');
  expect(page?.diffPageUrl).toContain('w=1');
  expect(describeGitLabPage(new URL('https://gitlab.com/groups/acme/-/merge_requests'), document)).toBeNull();
});

it('keeps current MR head and selected diff metadata out of other MR and repository links', () => {
  rapid();
  document.body.insertAdjacentHTML('beforeend', `<div data-noteable-type="MergeRequest" data-noteable-data='{"diff_head_sha":"${BASE}"}'></div>`);
  for (const target of ['/gitlab-org/gitlab/-/merge_requests/266883', '/gitlab-org/quality/triage-ops/-/merge_requests/266882']) {
    const page = describeGitLabPage(new URL(target, window.location.origin), document);
    expect(page?.headSha).toBeNull();
    expect(page?.diffPageUrl).not.toContain('diff_id=');
  }
  const current = describeGitLabPage(new URL(window.location.href), document);
  expect(current?.headSha).toBe(HEAD);
  expect(current?.diffPageUrl).toContain('diff_id=2158495265');
});

it('uses native revision metadata only for compatible target selection', () => {
  rapid();
  const base = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266882/diffs';
  expect(describeGitLabPage(new URL(`${base}?diff_id=2158495265&w=1`), document)?.headSha).toBe(HEAD);
  expect(describeGitLabPage(new URL(`${base}?diff_id=123`), document)?.headSha).toBeNull();
  window.location.href = `${base}?diff_id=2158495265`;
  const latest = describeGitLabPage(new URL(base), document);
  expect(latest?.headSha).toBeNull();
  expect(latest?.diffPageUrl).not.toContain('diff_id=');
  expect(describeGitLabPage(new URL(`${base}?diff_id=2158495265`), document)?.headSha).toBe(HEAD);
  window.location.href = `${base}?diff_id=123`;
  expect(describeGitLabPage(new URL(window.location.href), document)?.headSha).toBeNull();
  expect(describeGitLabPage(new URL(`${base}?commit_id=${BASE}`), document)?.headSha).toBe(BASE);
});

it('does not substitute the latest MR note head for a selected historical diff awaiting hydration', () => {
  window.location.href += '?diff_id=123';
  document.body.innerHTML = `<div data-noteable-type="MergeRequest" data-noteable-data='{"diff_head_sha":"${HEAD}"}'></div>`;
  expect(describeGitLabPage(new URL(window.location.href), document)?.headSha).toBeNull();
  window.location.href = window.location.href.split('?')[0] ?? window.location.href;
  expect(describeGitLabPage(new URL(window.location.href), document)?.headSha).toBe(HEAD);
});

it('does not run on sign-in interstitials or invalid review paths', () => {
  document.body.innerHTML = '<form id="new_user" action="/users/sign_in"></form>';
  expect(describeGitLabPage(new URL(window.location.href), document)).toBeNull();
  document.body.innerHTML = '';
  expect(describeGitLabPage(new URL('https://gitlab.com/a/b/-/merge_requests/1/diffs/surprise'), document)).toBeNull();
});

it('declares native count labels and the interactive Changes link separately from its pointer-transparent badge', () => {
  rapid();
  document.body.insertAdjacentHTML('afterbegin', '<li data-testid="diffs-tab"><a data-action="diffs" data-toggle="tabvue" href="/gitlab-org/gitlab/-/merge_requests/266882/diffs">Changes <span class="js-changes-tab-count" style="pointer-events:none">1</span></a></li>');
  const additions = document.querySelector('[data-testid="js-file-addition-line"]');
  const wrapper = additions?.parentElement;
  if (wrapper === null || wrapper === undefined) throw new Error('Missing additions wrapper');
  wrapper.setAttribute('aria-label', 'Added 4 lines.');
  const targets = gitLabHeaderTargets(document);
  expect(targets[0]?.labels).toContainEqual({ host: wrapper, attribute: 'aria-label', count: 'additions' });
  expect(targets[1]?.hoverHosts).toEqual([document.querySelector('[data-testid="diffs-tab"] a')]);
  expect(targets[1]?.files).toBe(document.querySelector('.js-changes-tab-count'));
});

it('declares the observed paired native line-count label once and rejects unrelated numeric phrases', () => {
  document.body.innerHTML = '<div class="diff-stats inline-parallel-buttons"><div class="diff-stats-contents"><div aria-label="Added 4 lines. Removed 1 line."><span data-testid="js-file-addition-line">4</span><span data-testid="js-file-deletion-line">1</span></div></div></div>';
  const wrapper = document.querySelector<HTMLElement>('[aria-label]');
  expect(gitLabHeaderTargets(document)[0]?.labels).toEqual([{ host: wrapper, attribute: 'aria-label', count: 'lines' }]);
  wrapper?.setAttribute('aria-label', 'Added 4 lines. Removed 1 line. Pipeline 123');
  expect(gitLabHeaderTargets(document)[0]?.labels).toEqual([]);
});

it('places a diff-header hint beside native count groups while preserving their spoken labels and nodes', () => {
  rapid();
  const root = document.querySelector<HTMLElement>('.diff-stats-contents');
  const nativeCount = document.querySelector<HTMLElement>('[aria-label="Added 4 lines."]');
  if (root === null || nativeCount === null) throw new Error('Missing native stats');
  const before = nativeCount.outerHTML;
  const target = gitLabHeaderTargets(document)[0];
  expect(target?.hintHost).toBe(root);
  expect(target?.hintBefore).toBe(nativeCount);
  const hint = document.createElement('span'); hint.dataset.geldUi = ''; hint.textContent = '1 test'; hint.tabIndex = 0;
  target?.hintHost?.insertBefore(hint, target.hintBefore ?? null);
  hint.focus();
  expect(document.activeElement).toBe(hint);
  expect(nativeCount.outerHTML).toBe(before);
  expect(hint.closest('[aria-label], a, button')).toBeNull();
  expect(nativeCount.parentElement).toBe(root);
});

function overviewHeader(): void {
  window.location.href = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334';
  // Projected from the actual anonymous MR266334 tab/actions header.
  document.body.innerHTML = '<div class="merge-request-tabs-container"><ul class="merge-request-tabs"><li data-testid="diffs-tab"><a data-action="diffs" data-toggle="tabvue" href="/gitlab-org/gitlab/-/merge_requests/266334/diffs"><span>Changes</span><span class="gl-badge badge badge-pill badge-neutral"><span class="gl-badge-content"><span class="js-changes-tab-count">2</span></span></span></a></li></ul><div class="merge-request-tabs-actions"><div id="discussionCounter"><div data-testid="discussions-counter-text"><span aria-hidden="true">4</span><span class="gl-sr-only">4 open threads</span><div role="group"><button aria-label="Previous open thread">Previous</button><button aria-label="Next open thread">Next</button></div></div></div></div></div>';
}

it('uses the neutral overview action slot outside the Changes anchor, badge, and thread counter', () => {
  overviewHeader();
  const tab = document.querySelector('a[data-action="diffs"]');
  const counter = document.getElementById('discussionCounter');
  const actions = document.querySelector<HTMLElement>('.merge-request-tabs-actions');
  const previous = counter?.querySelector('button');
  if (tab === null || counter === null || actions === null || previous === null || previous === undefined) throw new Error('Missing overview header');
  const tabMarkup = tab.outerHTML;
  const counterMarkup = counter.outerHTML;
  const target = gitLabHeaderTargets(document)[0];
  expect(target?.hintHost).toBe(actions);
  expect(target?.hintBefore).toBe(counter);
  const hint = document.createElement('span'); hint.dataset.geldUi = ''; hint.textContent = '0 tests'; hint.tabIndex = 0;
  target?.hintHost?.insertBefore(hint, target.hintBefore ?? null);
  hint.focus();
  expect(hint.closest('a, button, [role="group"], [aria-hidden="true"]')).toBeNull();
  expect(tab.outerHTML).toBe(tabMarkup);
  expect(counter.outerHTML).toBe(counterMarkup);
  expect(document.activeElement).toBe(hint);
  previous.focus();
  expect(document.activeElement).toBe(previous);
});

it('deduplicates the overview fallback when a native stats hint exists and rejects foreign Changes identity', () => {
  overviewHeader();
  document.body.insertAdjacentHTML('beforeend', '<div class="diff-stats inline-parallel-buttons"><div class="diff-stats-contents"><div class="diff-stats-group"><span>2 files</span></div><div aria-label="Added 4 lines."><span data-testid="js-file-addition-line">4</span></div></div></div>');
  expect(gitLabHeaderTargets(document).filter((target) => target.hintHost !== undefined)).toHaveLength(1);
  expect(gitLabHeaderTargets(document)[0]?.hintHost).toBe(document.querySelector('.diff-stats-contents'));
  document.querySelector('a[data-action="diffs"]')?.setAttribute('href', 'https://example.com/gitlab-org/gitlab/-/merge_requests/266334/diffs');
  expect(gitLabHeaderTargets(document)).toHaveLength(1);
});

it('uses the same neutral stats host on an immutable native commit and ignores hidden or cloned insertion hosts', () => {
  rapid();
  window.location.href = `https://gitlab.com/gitlab-org/gitlab/-/commit/${HEAD}`;
  expect(gitLabHeaderTargets(document)[0]?.hintHost).toBe(document.querySelector('.diff-stats-contents'));
  document.querySelector('.diff-stats')?.setAttribute('aria-hidden', 'true');
  expect(gitLabHeaderTargets(document)[0]?.hintHost).toBeUndefined();
  document.querySelector('.diff-stats')?.setAttribute('data-geld-ui', '');
  expect(gitLabHeaderTargets(document)).toEqual([]);
  window.location.href = 'https://gitlab.com/users/sign_in';
  expect(gitLabHeaderTargets(document)).toEqual([]);
});

it('places a checked-category hint before the native file group when a binary-only header has no line counts', () => {
  window.location.href = `https://gitlab.com/gitlab-org/gitlab/-/commit/${HEAD}`;
  document.body.innerHTML = '<div class="diff-stats inline-parallel-buttons"><div class="diff-stats-contents"><div class="diff-stats-group"><span>1 file</span></div></div></div>';
  const target = gitLabHeaderTargets(document)[0];
  expect(target?.additions).toBeNull();
  expect(target?.deletions).toBeNull();
  expect(target?.hintHost).toBe(document.querySelector('.diff-stats-contents'));
  expect(target?.hintBefore).toBe(document.querySelector('.diff-stats-group'));
});

it('collapses with native controls, keeps nodes in place and respects disabled Viewed', () => {
  rapid();
  const view = readGitLabDiff(document);
  const file = view?.entries[0];
  const root = file?.root;
  const details = root?.querySelector<HTMLDetailsElement>('details');
  root?.querySelector('[data-opened]')?.addEventListener('click', () => { if (details !== null && details !== undefined) details.open = false; });
  root?.querySelector('[data-closed]')?.addEventListener('click', () => { if (details !== null && details !== undefined) details.open = true; });
  const parent = root?.parentElement;
  expect(view?.container.hasAttribute('data-diffs-list')).toBe(true);
  expect(view?.virtualized).toBe(false);
  expect(file?.path).toBe('spec/requests/api/graphql/project/work_items_spec.rb');
  expect(file?.isExpanded?.()).toBe(true);
  expect(file?.collapse()).toBe(true);
  expect(file?.isExpanded?.()).toBe(false);
  expect(file?.expand()).toBe(true);
  expect(root?.parentElement).toBe(parent);
  expect(file?.markViewed?.()).toBe(false);
  expect(file?.readLines?.()[0]).toMatchObject({ oldLine: null, newLine: 5, oldText: null, newText: '# Clearing shared state', kind: 'added' });
  const targets = gitLabHeaderTargets(document);
  expect(targets).toHaveLength(1);
  expect(targets[0]?.additions?.textContent).toBe('4');
  expect(targets[0]?.files?.textContent).toBe('1 file');
});

it('reads split sides independently and decodes native tree paths instead of bidi labels', () => {
  rapid();
  const file = document.querySelector('diff-file');
  if (file === null) throw new Error('missing fixture');
  file.innerHTML = `<details data-file-body open><table><tr class="rd-hunk-lines rd-hunk-lines-parallel"><td class="rd-line-number" data-position="old"><a data-line-number="12"></a></td><td class="rd-line-content" data-position="old" data-change="removed"><pre class="rd-line-text">before\n</pre></td><td class="rd-line-number" data-position="new"><a data-line-number="13"></a></td><td class="rd-line-content" data-position="new" data-change="added"><pre class="rd-line-text">after\n</pre></td></tr></table></details>`;
  document.body.insertAdjacentHTML('beforeend', '<section data-testid="file-tree-container"><button data-testid="file-row" aria-expanded="true">folder</button><a data-testid="file-row" data-file-row="bab0cb834" href="/gitlab-org/gitlab/-/merge_requests/266882/diffs?file_path=spec%2Fa%20b.rb#bab0cb834">a‎…‎b</a></section>');
  const view = readGitLabDiff(document);
  expect(view?.entries[0]?.readLines?.()[0]).toMatchObject({ oldLine: 12, newLine: 13, oldText: 'before', newText: 'after' });
  expect(view?.tree.map((row) => row.path)).toEqual(['spec/a b.rb']);
});

it('reads classic file headers from the source-derived Vue structure', () => {
  // Source-derived, not claimed as an anonymous live classic MR capture.
  document.body.innerHTML = '<div id="diffs"><div class="diff-file file-holder" data-path="spec/a_spec.rb" id="hash"><div data-testid="file-title-container"><button aria-label="Hide file contents"></button><span data-testid="js-file-addition-line">2</span><span data-testid="js-file-deletion-line">1</span></div></div></div>';
  const view = readGitLabDiff(document);
  expect(view?.kind).toBe('gitlab-classic');
  expect(view?.entries[0]?.path).toBe('spec/a_spec.rb');
  expect(view?.entries[0]?.isExpanded?.()).toBe(true);
});

it('exposes the entire observed native file row and ignores Geld category clones', () => {
  rapid();
  document.body.insertAdjacentHTML('beforeend', '<section data-testid="file-tree-container"><input aria-label="Search files"><nav class="mr-tree-list" aria-label="File tree"><div data-testid="file-row-container" data-file-row="bab0cb834"><a data-testid="file-row" data-file-row="bab0cb834" href="?file_path=src%2Fone.rb">one.rb</a><button data-testid="file-unresolved-threads-count">1</button><span data-testid="file-added-lines">+2</span></div></nav><div data-geld-ui><div data-testid="file-row-container"><a data-testid="file-row" data-file-row="clone" href="?file_path=spec%2Fclone_spec.rb">clone</a></div></div></section>');
  const view = readGitLabDiff(document);
  expect(view?.tree).toHaveLength(1);
  expect(view?.tree[0]?.presentationRoot).toBe(document.querySelector('[data-testid="file-row-container"]'));
  expect(view?.tree[0]?.presentationRoot?.querySelector('[data-testid="file-unresolved-threads-count"]')?.textContent).toBe('1');
  expect(view?.treeContainer).toBe(document.querySelector('nav.mr-tree-list'));
  expect(view?.treeContainer?.contains(document.querySelector('input'))).toBe(false);
});

it('finds real MR list rows and author login without confusing issues or external links', () => {
  document.body.innerHTML = `<ul><li class="merge-request" data-testid="issuable-container"><a data-testid="issuable-title-link" href="/gitlab-org/gitlab/-/merge_requests/266882">Fix flaky N+1 specs</a><div class="issuable-info"><a data-testid="issuable-author" data-username="mdangelo6">Matt D'Angelo</a></div></li><li data-testid="issuable-container"><a data-testid="issuable-title-link" href="/a/b/-/issues/1">Issue</a><div class="issuable-info"></div></li><li class="merge-request" data-testid="issuable-container"><a data-testid="issuable-title-link" href="https://example.com/a/b/-/merge_requests/1">External</a><div class="issuable-info"></div></li></ul>`;
  const rows = gitLabListRows(document);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ url: 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266882', author: 'mdangelo6' });
});
