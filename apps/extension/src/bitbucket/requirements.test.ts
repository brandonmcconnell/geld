// @vitest-environment happy-dom
import { describeBitbucketPage } from './page';
import { readBitbucketRequirements } from './requirements';
import type { ProviderReviewPage } from '../providers/types';

const URL = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22';
const RULES: readonly [string, string][] = [
  ['failed_builds', 'No failed builds'], ['in_progress_builds', 'No in progress builds'],
  ['minimum_approvals', '1+ approval'], ['minimum_default_reviewer_approvals', '1+ approval from default reviewers'],
  ['minimum_successful_builds', '1+ build passed'], ['pr_deps_merged', 'All dependencies merged'], ['resolved_tasks', 'All tasks resolved'],
];

function page(): ProviderReviewPage {
  const parsed = describeBitbucketPage(new globalThis.URL(URL));
  if (parsed === null) throw new Error('Missing Bitbucket fixture page.');
  return parsed;
}

function row(id: string, label: string): string {
  return `<div data-testid="classicMergeCheckItem-${id}"><div data-testid="mergeCheckItem"><div tabindex="0" data-testid="mergeCheckItemFocusElement" aria-label="${label}. Merge check passed."><span data-testid="mergeCheckItemIcon--success" role="img" aria-label="Merge check passed"></span><div><span>${label}</span></div></div></div></div>`;
}

beforeEach(() => {
  window.location.href = URL;
  // Reduced first-party PR22 native header and merge sidebar, installed capture 41327802465.
  document.body.innerHTML = `<div data-testid="pr-header"><nav><a href="/atlassian/bitbucket-upload-file/src">bitbucket-upload-file</a></nav><div><div data-qa="pr-branches-and-state-styles"><span>Merged</span></div><span>#22 • Created 2024-02-13 • Last updated 2024-02-13</span></div></div><section aria-label="Merge checks status"><div data-testid="checksPassedCountHeader">7 of 7 checks passed</div><div data-testid="mergeCheckList">${RULES.map(([id, label]) => row(id, label)).join('')}</div></section>`;
});

it('reads the seven observed native requirements individually without conflating the two approval rules', () => {
  const click = vi.fn();
  document.body.addEventListener('click', click);
  const requirements = readBitbucketRequirements(page(), document);
  expect(requirements?.map((requirement) => [requirement.id, requirement.label, requirement.state])).toEqual(RULES.map(([id, label]) => [`classicMergeCheckItem-${id}`, label, 'passed']));
  expect(requirements?.filter((requirement) => requirement.id.includes('approvals'))).toHaveLength(2);
  expect(click).not.toHaveBeenCalled();
});

it('keeps unsupported, missing and contradictory native result icons unknown', () => {
  const icons = document.querySelectorAll('[data-testid="mergeCheckItemIcon--success"]');
  icons[0]?.setAttribute('data-testid', 'mergeCheckItemIcon--unverified-error-variant');
  icons[0]?.setAttribute('aria-label', 'Merge check failed');
  icons[1]?.setAttribute('aria-label', 'Not the verified passed label');
  icons[2]?.remove();
  const result = readBitbucketRequirements(page(), document);
  expect(result?.slice(0, 3).map((requirement) => requirement.state)).toEqual(['unknown', 'unknown', 'unknown']);
  expect(result?.slice(3).every((requirement) => requirement.state === 'passed')).toBe(true);
});

it('rejects mismatched review URLs, native header numbers and repository breadcrumbs', () => {
  const original = page();
  window.location.href = URL.replace('/22', '/27');
  expect(readBitbucketRequirements(original, document)).toBeNull();
  const changed = describeBitbucketPage(new globalThis.URL(window.location.href));
  if (changed === null) throw new Error('Missing changed page.');
  expect(readBitbucketRequirements(changed, document)).toBeNull();
  window.location.href = URL;
  document.querySelector('[data-testid="pr-header"] a')?.setAttribute('href', 'https://evil.example/atlassian/bitbucket-upload-file/src');
  expect(readBitbucketRequirements(original, document)).toBeNull();
  expect(readBitbucketRequirements({ ...original, repository: { ...original.repository, path: 'other/project' } }, document)).toBeNull();
});

it('ignores copied widgets in comment content, description and Geld UI', () => {
  const section = document.querySelector('section');
  if (section === null) throw new Error('Missing native list.');
  const markup = section.outerHTML;
  section.remove();
  for (const host of ['<div data-testid="comment-content">', '<div data-qa="pull-request-description">', '<div data-geld-ui>']) {
    document.body.insertAdjacentHTML('beforeend', `${host}${markup}</div>`);
  }
  expect(readBitbucketRequirements(page(), document)).toBeNull();
});

it('rejects duplicate native ids and ambiguous native lists', () => {
  const first = document.querySelector('[data-testid^="classicMergeCheckItem-"]');
  if (first === null) throw new Error('Missing native requirement.');
  first.after(first.cloneNode(true));
  expect(readBitbucketRequirements(page(), document)).toBeNull();
  first.remove();
  const list = document.querySelector('[data-testid="mergeCheckList"]');
  if (list === null) throw new Error('Missing native list.');
  list.after(list.cloneNode(true));
  expect(readBitbucketRequirements(page(), document)).toBeNull();
});

it('uses the native focus label rather than expanded popover prose or badge counts', () => {
  const first = document.querySelector('[data-testid^="classicMergeCheckItem-"]');
  first?.insertAdjacentHTML('beforeend', '<div role="dialog">2 approvals are described in this popover.</div>');
  expect(readBitbucketRequirements(page(), document)?.[0]?.label).toBe('No failed builds');
  document.querySelector('[data-testid="checksPassedCountHeader"]')?.replaceChildren(document.createTextNode('Unsupported header wording'));
  expect(readBitbucketRequirements(page(), document)).toHaveLength(7);
});

it('does not infer zero requirements from an empty or missing list and tolerates only independently readable rows', () => {
  const list = document.querySelector('[data-testid="mergeCheckList"]');
  if (list === null) throw new Error('Missing list.');
  list.querySelector('[data-testid="mergeCheckItemFocusElement"]')?.remove();
  expect(readBitbucketRequirements(page(), document)).toHaveLength(6);
  list.replaceChildren();
  expect(readBitbucketRequirements(page(), document)).toBeNull();
  list.remove();
  expect(readBitbucketRequirements(page(), document)).toBeNull();
});

it('rereads changed native facts without caching a previous passing value', () => {
  expect(readBitbucketRequirements(page(), document)?.[0]?.state).toBe('passed');
  const icon = document.querySelector('[data-testid="mergeCheckItemIcon--success"]');
  icon?.setAttribute('data-testid', 'mergeCheckItemIcon--unknown');
  expect(readBitbucketRequirements(page(), document)?.[0]?.state).toBe('unknown');
});
