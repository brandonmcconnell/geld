// @vitest-environment happy-dom
import { describeGitLabPage } from './page';
import { readGitLabDiff } from './diff';
import { immutableProviderPage, isProviderReviewPage } from '../providers/types';
import { providerDiffKey } from '../providers/diff-cache';

const HEAD = '13215ca460cd4f75d3765a882ef486aa2dacf549';
const BASE = '34ef0d2e2808bf3a7347b1b4352ac8babdfb645c';

beforeEach(() => { document.body.innerHTML = ''; window.location.href = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334/diffs'; });

it('describes a standalone commit without inventing a merge request number or inheriting another page head', () => {
  document.body.innerHTML = `<diff-file data-file-data='{"diff_lines_path":"/gitlab-org/gitlab/-/blob/${BASE}/src/a.rb/diff_lines"}'></diff-file>`;
  const page = describeGitLabPage(new URL(`https://gitlab.com/gitlab-org/gitlab/-/commit/${HEAD}?w=1`), document);
  if (page === null) throw new Error('missing page');
  expect(page).toMatchObject({ kind: 'commit', ref: HEAD, headSha: HEAD });
  expect('number' in page).toBe(false);
  expect(isProviderReviewPage(page)).toBe(false);
  expect(immutableProviderPage(page)).toBe(true);
  expect(page.diffUrl).toBe(`https://gitlab.com/gitlab-org/gitlab/-/commit/${HEAD}.diff?w=1`);
  expect(providerDiffKey(page)).toContain('/-/commit/');
});

it('keeps compare merge-base and direct modes separate, with full namespace identity', () => {
  const url = `https://gitlab.com/gitlab-org/quality/triage-ops/-/compare/${BASE}...${HEAD}`;
  const mergeBase = describeGitLabPage(new URL(url), document);
  const direct = describeGitLabPage(new URL(`${url}?straight=true`), document);
  const twoDots = describeGitLabPage(new URL(url.replace('...', '..')), document);
  if (mergeBase === null || direct === null) throw new Error('missing compare');
  expect(mergeBase).toMatchObject({ kind: 'compare', from: BASE, to: HEAD, straight: false, repository: { path: 'gitlab-org/quality/triage-ops' } });
  expect(direct).toMatchObject({ kind: 'compare', straight: true });
  expect(twoDots).toMatchObject({ kind: 'compare', straight: true });
  expect('number' in direct).toBe(false);
  expect(providerDiffKey(mergeBase)).not.toBe(providerDiffKey(direct));
});

it('decodes compare refs and keeps moving named refs out of immutable cache eligibility', () => {
  const page = describeGitLabPage(new URL('https://gitlab.com/acme/sub/widgets/-/compare/feature%2Fa...main?straight=true&from_project_id=456'), document);
  if (page === null) throw new Error('missing compare');
  expect(page).toMatchObject({ kind: 'compare', from: 'feature/a', to: 'main', targetProjectId: '456', straight: true, headSha: null });
  expect(page.url).toBe('https://gitlab.com/acme/sub/widgets/-/compare/feature%2Fa...main');
  expect(immutableProviderPage(page)).toBe(false);
  expect(describeGitLabPage(new URL('https://gitlab.com/acme/widgets/-/compare/main...topic?from_project_id=oops'), document)).toBeNull();
  expect(describeGitLabPage(new URL('https://gitlab.com/acme/widgets/-/compare?from=main&to=topic'), document)).toBeNull();
});

it('reads streamed compare siblings from their actual shared parent without moving them', () => {
  // Reduced from anonymous /-/compare/34ef0d2e...13215ca4, November 1, 2026.
  document.body.innerHTML = '<article data-rapid-diffs><div data-diffs-list><div data-stream-remaining-diffs><streaming-element><diff-file id="one" data-file-data=\'{"new_path":"src/one.rb"}\'></diff-file><diff-file id="two" data-file-data=\'{"new_path":"spec/two_spec.rb"}\'></diff-file></streaming-element></div></div></article>';
  const parent = document.querySelector('diff-file')?.parentElement;
  const view = readGitLabDiff(document);
  expect(view?.container).toBe(parent);
  expect(view?.container.tagName).toBe('STREAMING-ELEMENT');
  expect(view?.virtualized).toBe(false);
  expect(view?.entries.map((file) => file.path)).toEqual(['src/one.rb', 'spec/two_spec.rb']);
  expect(document.querySelector('diff-file')?.parentElement).toBe(parent);
});
