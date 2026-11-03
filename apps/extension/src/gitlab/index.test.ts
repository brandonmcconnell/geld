// @vitest-environment happy-dom
import { isProviderReviewPage } from '../providers/types';
import { gitlabAdapter } from './index';
import { describeGitLabPage } from './page';
import { fetchGitLabReview, parseGitLabDiscussions } from './review';
import type { GitLabReviewSnapshot } from './review';

vi.mock('./review', async (importOriginal) => ({ ...await importOriginal<typeof import('./review')>(), fetchGitLabReview: vi.fn() }));
vi.mock('./config', () => ({ fetchGitLabConfig: vi.fn() }));

const REVIEW = 'https://gitlab.com/group/repo/-/merge_requests/7';
const HEAD = 'a'.repeat(40);
const FORM = '<form data-testid="submit-gl-form"><div data-testid="reviewer_states"><input type="radio" value="reviewed"><input type="radio" value="approved"><input type="radio" value="requested_changes"></div><textarea data-testid="comment-textarea">Existing native draft</textarea><button type="submit">Submit</button></form>';

function snapshot(): GitLabReviewSnapshot {
  return {
    reviewerScope: null,
    input: { subject: { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/repo', id: '7', headSha: HEAD }, threads: [] },
    comments: [], events: [], checks: [], threadCapabilities: new Map(), renderedNotes: new Map(), state: 'opened', complete: true, unavailable: [],
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

it('offers a live, source-scoped review opener without inferring pending drafts or approval/update permission', async () => {
  const source = snapshot();
  vi.mocked(fetchGitLabReview).mockResolvedValue({ ...source, reviewerScope: { subject: source.input.subject, projectId: '27', noteableId: '81' },
    capabilities: { signedIn: true, canApprove: false, canReview: false, canComment: false, requestChanges: 'unknown' } });
  const root = document.querySelector('#js-vue-mr-discussions');
  root?.setAttribute('data-noteable-type', 'MergeRequest');
  root?.setAttribute('data-noteable-data', JSON.stringify({ id: 81, iid: 7, project_id: 27, diff_head_sha: HEAD, current_user: { can_update: false } }));
  const result = await acquire();const open = () => result.actions.find((action) => action.kind === 'open-review');
  expect(open()).toBeUndefined();
  document.body.insertAdjacentHTML('beforeend', '<header><button type="button" data-testid="review-drawer-toggle">Your review</button></header>');
  const button = document.querySelector<HTMLButtonElement>('header button');if (button === null) throw new Error('Missing native button.');
  // Original-control layout is an explicit unit protocol, not a signed-in public fixture.
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 50, 20));
  vi.spyOn(button, 'scrollIntoView').mockImplementation(() => {});vi.spyOn(document, 'elementFromPoint').mockReturnValue(button);
  const click = vi.fn();button.addEventListener('click', click);
  const first = open();expect(first?.available).toBe(true);expect(open()?.scopeKey).toBe(first?.scopeKey);
  expect(await first?.activate({ current: () => true })).toBe(true);expect(click).toHaveBeenCalledOnce();
  button.disabled = true;expect(open()).toBeUndefined();button.disabled = false;expect(open()?.available).toBe(true);
  expect(await first?.activate({ current: () => true })).toBe(false);
  const priorTab = open();window.history.replaceState(null, '', `${REVIEW}/diffs`);
  expect(await priorTab?.activate({ current: () => true })).toBe(false);expect(open()?.available).toBe(true);
  root?.setAttribute('data-current-user-data', '{"id":11}');expect(open()).toBeUndefined();
  expect(fetchGitLabReview).toHaveBeenCalledOnce();expect(fetch).not.toHaveBeenCalled();
});

it.each(['partial', 'signed-out'] as const)('retains the fetched %s ceiling for the native review opener', async (ceiling) => {
  const source = snapshot();
  vi.mocked(fetchGitLabReview).mockResolvedValue({ ...source, reviewerScope: { subject: source.input.subject, projectId: '27', noteableId: '81' },
    complete: ceiling !== 'partial', capabilities: { ...source.capabilities, signedIn: ceiling !== 'signed-out' } });
  const root = document.querySelector('#js-vue-mr-discussions');root?.setAttribute('data-noteable-type', 'MergeRequest');
  root?.setAttribute('data-noteable-data', JSON.stringify({ id: 81, iid: 7, project_id: 27, diff_head_sha: HEAD }));
  document.body.insertAdjacentHTML('beforeend', '<header><button type="button" data-testid="review-drawer-toggle">Your review</button></header>');
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 50, 20));
  const result = await acquire();expect(result.actions.find((action) => action.kind === 'open-review')).toBeUndefined();
  expect(fetchGitLabReview).toHaveBeenCalledOnce();expect(fetch).not.toHaveBeenCalled();
});

it('refreshes the focus-only reviewer handoff from native DOM while preserving its fetched viewer and exact metadata scope', async () => {
  const source = snapshot();
  vi.mocked(fetchGitLabReview).mockResolvedValue({ ...source, reviewerScope: { subject: source.input.subject, projectId: '27', noteableId: '81' } });
  const noteable = document.querySelector('#js-vue-mr-discussions');
  noteable?.setAttribute('data-noteable-type', 'MergeRequest');
  noteable?.setAttribute('data-noteable-data', JSON.stringify({ id: 81, iid: 7, project_id: 27, diff_head_sha: HEAD, current_user: { can_update: true } }));
  const result = await acquire();expect(result.reviewerControls?.available).toBe(false);
  document.body.insertAdjacentHTML('beforeend', '<aside data-testid="issuable-sidebar" data-issuable-type="merge_request"><div data-testid="reviewers-block-container"><div class="dropdown"><button type="button" class="js-reviewer-search" data-toggle="dropdown" data-current-user="true" data-iid="7" data-issuable-type="merge_request" data-project-id="27" data-field-name="merge_request[reviewer_ids][]" data-issue-update="/group/repo/-/merge_requests/7.json" data-ability-name="merge_request">Select reviewers</button><div class="dropdown-menu" style="display:none"></div></div></div></aside>');
  const button = document.querySelector<HTMLButtonElement>('aside button');if (button === null) throw new Error('Missing native reviewer protocol control.');
  // Explicit layout unit protocol. No authenticated provider session or opener click.
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 50, 20));
  vi.spyOn(button, 'scrollIntoView').mockImplementation(() => {});vi.spyOn(document, 'elementFromPoint').mockReturnValue(button);
  const click = vi.fn();button.addEventListener('click', click);
  const original = document.body.innerHTML;
  expect(result.reviewerControls?.available).toBe(true);expect(await result.reviewerControls?.activate()).toBe(true);
  expect(click).not.toHaveBeenCalled();expect(document.activeElement).toBe(button);expect(document.body.innerHTML).toBe(original);
  const old = result.reviewerControls;button.disabled = true;expect(result.reviewerControls?.available).toBe(false);
  button.disabled = false;expect(result.reviewerControls?.available).toBe(true);
  window.history.replaceState(null, '', `${REVIEW}/diffs`);expect(await old?.activate()).toBe(false);expect(result.reviewerControls?.available).toBe(true);
  noteable?.setAttribute('data-current-user-data', '{"id":11}');expect(result.reviewerControls?.available).toBe(false);
  noteable?.setAttribute('data-current-user-data', 'null');expect(result.reviewerControls?.available).toBe(false);
  expect(fetchGitLabReview).toHaveBeenCalledOnce();expect(fetch).not.toHaveBeenCalled();
});

it('carries same-snapshot rendered evidence without enriching raw semantic comments or surviving another review route', async () => {
  const original = snapshot();
  const parsed = parseGitLabDiscussions([{ id: 'b'.repeat(40), resolvable: false, notes: [{ id: 11, note: '**Rich**', note_html: '<p><strong>Rich</strong></p>',
    system: false, author: { id: 23, username: 'reviewer', bot: false }, created_at: '2026-11-01T12:00:00Z',
    noteable_type: 'MergeRequest', noteable_iid: 7, noteable_id: 2, project_id: 1, noteable_note_url: `${REVIEW}#note_11` }] }], original.input.subject, { projectId: '1', noteableId: '2' });
  vi.mocked(fetchGitLabReview).mockResolvedValue({ ...original, comments: parsed.comments, renderedNotes: parsed.renderedNotes });
  const acquired = await acquire();const comment = parsed.comments[0];if (comment === undefined) throw new Error('Missing parsed source.');
  const host = document.createElement('div');host.textContent = comment.body;document.body.append(host);
  expect(acquired.renderComment?.(comment, host)).toBe(true);expect(host.querySelector('strong')?.textContent).toBe('Rich');
  expect(comment.body).toBe('**Rich**');expect(comment).not.toHaveProperty('html');
  host.textContent = comment.body;window.location.href = REVIEW.replace('/7', '/8');
  expect(acquired.renderComment?.(comment, host)).toBe(false);expect(host.textContent).toBe('**Rich**');
});

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

it('binds the presentation reader to the complete fetched thread and ordinary source set', async () => {
  // Synthetic protocol fixture shaped like retained native note headers, not a live author test.
  const author = { id: '20', login: 'reviewer' };
  const donor = { id: '100', anchor: 'note_100', url: `${REVIEW}#note_100`, author, body: 'Summary fixture', createdAt: '2026-11-01T00:00:00Z' };
  const target = { ...donor, id: '101', anchor: 'note_101', url: `${REVIEW}#note_101`, body: 'Finding fixture' };
  const value = snapshot();
  vi.mocked(fetchGitLabReview).mockResolvedValue({ ...value, comments: [donor], input: { ...value.input, threads: [{ id: 'thread', anchor: target.anchor, url: target.url, resolved: false, outdated: false, comments: [target] }] } });
  const native = document.createElement('article');
  native.setAttribute('data-rapid-diffs', '');
  native.setAttribute('data-app-data', JSON.stringify({ mr_path: '/group/repo/-/merge_requests/7', project_path: 'group/repo', iid: 7, versions: { source_versions: [{ id: 1, selected: true, latest: true, is_merge_head: false, head_sha: HEAD }] } }));
  document.body.append(native);
  document.body.insertAdjacentHTML('beforeend', '<li id="note_100" data-note-id="100" data-testid="noteable-note-container"><div class="timeline-entry-inner"><div class="timeline-content"><div class="note-header"><div class="note-header-info"><a class="author-name-link" data-user-id="20" data-username="reviewer" href="/reviewer"><span data-testid="author-name">Native account</span></a></div></div></div></div></li>');
  const result = await acquire();
  expect(result.authorPresentation?.(target)).toEqual({ authorId: '20', displayName: 'Native account', profileUrl: 'https://gitlab.com/reviewer' });
  expect(result.authorPresentation?.({ ...target, body: 'Changed caller body' })).toBeNull();
  expect(fetchGitLabReview).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
});
