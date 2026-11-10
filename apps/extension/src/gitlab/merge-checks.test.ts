// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { readGitLabMergeChecks } from './merge-checks';
const subject = { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/repo', id: '7', headSha: 'a'.repeat(40) } as const;
afterEach(() => document.body.replaceChildren());
it('reads actual merge blockers separately from pipelines and excludes action labels', () => {
  window.location.href = 'https://gitlab.com/group/repo/-/merge_requests/7';
  document.body.innerHTML = '<div class="issuable-discussion"><div id="widget-state" class="mr-state-widget"><div data-testid="merge-checks-full"><div data-testid="merge-check"><svg data-testid="status-failed-icon"></svg>Open threads must be resolved.<button>Go to first open thread</button></div><div data-testid="merge-check"><svg data-testid="status-failed-icon"></svg>All required approvals must be given.</div><div data-testid="merge-check"><span role="status" data-testid="checking-icon">Loading</span>Checking for merge conflicts.</div></div></div></div>';
  expect(readGitLabMergeChecks(document, subject)?.map(({ label, state }) => ({ label, state }))).toEqual([
    { label: 'Open threads must be resolved.', state: 'failed' }, { label: 'All required approvals must be given.', state: 'failed' }, { label: 'Checking for merge conflicts.', state: 'pending' },
  ]);
  document.querySelector('#widget-state')?.classList.add('md');
  expect(readGitLabMergeChecks(document, subject)).toBeNull();
  document.querySelector('#widget-state')?.classList.remove('md');
  window.location.href = 'https://gitlab.com/group/repo/-/merge_requests/8';
  expect(readGitLabMergeChecks(document, subject)).toBeNull();
});
