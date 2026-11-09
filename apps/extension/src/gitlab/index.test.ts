// @vitest-environment happy-dom
import { isProviderReviewPage } from '../providers/types';
import { gitlabAdapter } from './index';
import { describeGitLabPage } from './page';
import { fetchGitLabReview } from './review';
import type { GitLabReviewSnapshot } from './review';

vi.mock('./review', async (importOriginal) => ({ ...await importOriginal<typeof import('./review')>(), fetchGitLabReview: vi.fn() }));
vi.mock('./config', () => ({ fetchGitLabConfig: vi.fn() }));

const REVIEW = 'https://gitlab.com/group/repo/-/merge_requests/7';
const HEAD = 'a'.repeat(40);
const FORM = '<form data-testid="submit-gl-form"><div data-testid="reviewer_states"><input type="radio" value="reviewed"><input type="radio" value="approved"><input type="radio" value="requested_changes"></div><textarea data-testid="comment-textarea">Existing native draft</textarea><button type="submit">Submit</button></form>';

function snapshot(): GitLabReviewSnapshot {
  return {
    input: { subject: { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/repo', id: '7', headSha: HEAD }, threads: [] },
    comments: [], events: [], checks: [], threadCapabilities: new Map(), state: 'opened', complete: true, unavailable: [],
    sourceCoverage: { threads: 'complete', comments: 'complete' }, approvalsRequired: null, approvalsLeft: null,
    capabilities: { signedIn: true, canApprove: true, canReview: false, canComment: false, requestChanges: 'unknown' },
  };
}

async function acquire(url = REVIEW) {
  const page = describeGitLabPage(new URL(url), document);
  if (page === null || !isProviderReviewPage(page) || gitlabAdapter.fetchReview === undefined) throw new Error('Missing GitLab review adapter.');
  return gitlabAdapter.fetchReview(page, new AbortController().signal, document);
}

beforeEach(() => {
  window.location.href = REVIEW;
  // Signed-in protocol fixture only. No authenticated provider session is exercised.
  document.body.innerHTML = `<div id="js-vue-mr-discussions" data-current-user-data='{"id":10}'></div>`;
  vi.mocked(fetchGitLabReview).mockReset().mockResolvedValue(snapshot());
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Live action reads must not fetch.'); }));
});

afterEach(() => { document.body.replaceChildren();vi.unstubAllGlobals();vi.restoreAllMocks(); });

it('refreshes the same snapshot as native outcomes hydrate, disable, reenable and disappear without refetching', async () => {
  const result = await acquire();
  const available = () => result.actions.filter((action) => action.available).map((action) => action.kind);
  expect(available()).toEqual([]);
  document.body.insertAdjacentHTML('beforeend', '<button data-testid="review-drawer-toggle">Your review</button>');
  expect(available()).toEqual(['approve', 'comment']);
  document.body.insertAdjacentHTML('beforeend', FORM);
  expect(available()).toEqual(['approve', 'request-changes', 'comment']);
  const radio = document.querySelector<HTMLInputElement>('input[value="approved"]');
  if (radio === null) throw new Error('Missing native outcome.');
  radio.disabled = true;expect(available()).toEqual(['request-changes', 'comment']);
  radio.disabled = false;expect(available()).toContain('approve');
  radio.remove();expect(available()).not.toContain('approve');
  document.querySelector('form')?.remove();document.querySelector('button')?.remove();expect(available()).toEqual([]);
  expect(fetchGitLabReview).toHaveBeenCalledOnce();expect(fetch).not.toHaveBeenCalled();
});

it('keeps the fetched approval permission as a ceiling while allowing an independently offered native request-changes outcome', async () => {
  const source = snapshot();
  vi.mocked(fetchGitLabReview).mockResolvedValue({ ...source, capabilities: { ...source.capabilities, canApprove: false } });
  const result = await acquire();document.body.insertAdjacentHTML('beforeend', FORM);
  expect(result.actions.find((action) => action.kind === 'approve')?.available).toBe(false);
  expect(result.actions.find((action) => action.kind === 'request-changes')?.available).toBe(true);
  expect(await result.actions.find((action) => action.kind === 'approve')?.activate()).toBe(false);
  expect(document.querySelector<HTMLInputElement>('input[value="approved"]')?.checked).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it('withdraws actions on live sign-out or account change and rejects retained descriptors before controller refresh', async () => {
  const result = await acquire();document.body.insertAdjacentHTML('beforeend', FORM);
  const approve = result.actions.find((action) => action.kind === 'approve');
  expect(approve?.available).toBe(true);
  const source = document.querySelector('#js-vue-mr-discussions');
  source?.setAttribute('data-current-user-data', 'null');
  expect(result.actions.every((action) => !action.available)).toBe(true);expect(await approve?.activate()).toBe(false);
  source?.setAttribute('data-current-user-data', '{"id":11}');
  expect(result.actions.every((action) => !action.available)).toBe(true);expect(await approve?.activate()).toBe(false);
  source?.setAttribute('data-current-user-data', '{"id":10}');
  expect(result.actions.find((action) => action.kind === 'approve')?.available).toBe(true);
  expect(fetchGitLabReview).toHaveBeenCalledOnce();expect(fetch).not.toHaveBeenCalled();
});

it('cannot lend a fetched review permission to another URL, subject or newly displayed head', async () => {
  const result = await acquire();document.body.insertAdjacentHTML('beforeend', FORM);
  const approve = result.actions.find((action) => action.kind === 'approve');
  window.history.replaceState(null, '', '/group/repo/-/merge_requests/8');
  expect(result.actions.every((action) => !action.available)).toBe(true);expect(await approve?.activate()).toBe(false);
  window.history.replaceState(null, '', REVIEW);
  const foreign = await acquire(REVIEW.replace('/7', '/8'));
  expect(foreign.actions.every((action) => !action.available)).toBe(true);
  const metadata = document.createElement('div');metadata.setAttribute('data-noteable-type', 'MergeRequest');
  metadata.setAttribute('data-noteable-data', JSON.stringify({ diff_head_sha: 'b'.repeat(40) }));document.body.append(metadata);
  expect(result.actions.every((action) => !action.available)).toBe(true);expect(await approve?.activate()).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it('captures the native account before an asynchronous review read instead of borrowing a later account permission', async () => {
  let finish: ((value: GitLabReviewSnapshot) => void) | undefined;
  vi.mocked(fetchGitLabReview).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const pending = acquire();
  document.querySelector('#js-vue-mr-discussions')?.setAttribute('data-current-user-data', '{"id":11}');
  document.body.insertAdjacentHTML('beforeend', FORM);finish?.(snapshot());
  const result = await pending;
  expect(result.actions.every((action) => !action.available)).toBe(true);expect(fetch).not.toHaveBeenCalled();
});

it('offers fresh native actions on another tab of the same review while retaining the previous descriptor visit guard', async () => {
  const result = await acquire();document.body.insertAdjacentHTML('beforeend', FORM);
  const previous = result.actions.find((action) => action.kind === 'approve');
  expect(previous?.available).toBe(true);
  window.history.replaceState(null, '', `${REVIEW}/diffs`);
  expect(await previous?.activate()).toBe(false);
  const current = result.actions.find((action) => action.kind === 'approve');
  expect(current?.available).toBe(true);expect(await current?.activate()).toBe(true);
  expect(document.querySelector('textarea')?.value).toBe('Existing native draft');
  expect(fetchGitLabReview).toHaveBeenCalledOnce();expect(fetch).not.toHaveBeenCalled();
});
