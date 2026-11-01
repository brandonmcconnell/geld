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
  expect(page?.headSha).toBe(HEAD);
  expect(page?.diffPageUrl).toContain('diff_id=2158495265');
  expect(page?.diffPageUrl).toContain('w=1');
  expect(describeGitLabPage(new URL('https://gitlab.com/groups/acme/-/merge_requests'), document)).toBeNull();
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

it('finds real MR list rows and author login without confusing issues or external links', () => {
  document.body.innerHTML = `<ul><li class="merge-request" data-testid="issuable-container"><a data-testid="issuable-title-link" href="/gitlab-org/gitlab/-/merge_requests/266882">Fix flaky N+1 specs</a><div class="issuable-info"><a data-testid="issuable-author" data-username="mdangelo6">Matt D'Angelo</a></div></li><li data-testid="issuable-container"><a data-testid="issuable-title-link" href="/a/b/-/issues/1">Issue</a><div class="issuable-info"></div></li><li class="merge-request" data-testid="issuable-container"><a data-testid="issuable-title-link" href="https://example.com/a/b/-/merge_requests/1">External</a><div class="issuable-info"></div></li></ul>`;
  const rows = gitLabListRows(document);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ url: 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266882', author: 'mdangelo6' });
});
