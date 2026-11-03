// @vitest-environment happy-dom
import type { ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import { createGitLabAuthorPresentationReader } from './author-presentation';

const REVIEW = 'https://gitlab.com/whitebox-aero/whitebox/-/merge_requests/272';
const HEAD = '5da09f9e31ad0d59c6f804a71380992955d1040f';
const LOGIN = 'group_84680077_bot_800401aaa75115e1bc0c76e02d860b8b';
const AVATAR = 'https://secure.gravatar.com/avatar/764bc228e577e24c3cff9ebe7f925395da6a6f792e8a5bc76d7517fd5f06d6ff?s=80&d=identicon';

// Source IDs/account and reduced native summary header/version are from anonymous installed
// MR272 capture 41374165992. Bodies/timestamps and measured geometry below are protocol fixtures.
function source(id: string): ProviderReviewComment {
  return { id, anchor: `note_${id}`, url: `${REVIEW}#note_${id}`, author: { id: '37628862', login: LOGIN, automated: true }, body: `Fixture body for ${id}`, createdAt: '2026-11-01T00:00:00Z' };
}
const summary = source('3381334808');
const findings = ['3381334872', '3381334884', '3384406925'].map(source);
const finding = findings[0];
if (finding === undefined) throw new Error('Missing fixture finding.');

function nativeHeader(id = summary.id, name = '****'): string {
  return `<li id="note_${id}" data-note-id="${id}" data-testid="noteable-note-container"><div class="timeline-entry-inner"><div class="timeline-avatar"><a href="/${LOGIN}" data-user-id="37628862" data-username="${LOGIN}" class="gl-avatar-link js-user-link gl-relative gl-link gl-link-meta"><img src="${AVATAR}" alt="****" class="gl-avatar gl-avatar-circle gl-avatar-s32"></a></div><div class="timeline-content"><div class="note-header"><div class="note-header-info"><a href="/${LOGIN}" data-user-id="37628862" data-username="${LOGIN}" class="author-name-link js-user-link gl-overflow-hidden gl-break-words"><span data-testid="author-name">${name}</span></a><span class="author-username"><a href="/${LOGIN}" class="author-username-link">@${LOGIN}</a></span></div><div class="note-actions"><span class="gl-mr-3 gl-hidden @sm/panel:gl-block gl-badge badge badge-pill badge-neutral" title="This user has the developer role in the Whitebox project."><span class="gl-badge-content">Developer</span></span></div></div><div class="note-body"><div class="note-text">Native summary</div></div></div></div></li>`;
}

function bootstrap(overrides: Record<string, unknown> = {}, appOverrides: Record<string, unknown> = {}): void {
  document.querySelector('[data-rapid-diffs]')?.remove();
  const article = document.createElement('article');
  article.setAttribute('data-rapid-diffs', '');
  article.setAttribute('data-app-data', JSON.stringify({ mr_path: '/whitebox-aero/whitebox/-/merge_requests/272', project_path: 'whitebox-aero/whitebox', iid: 272,
    versions: { source_versions: [{ id: 1855648093, latest: true, selected: true, is_merge_head: false, head_sha: HEAD, ...overrides }] }, ...appOverrides }));
  document.body.prepend(article);
}

function input(comments: readonly ProviderReviewComment[] = findings): ProviderReviewInput {
  return { subject: { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'whitebox-aero/whitebox', id: '272', headSha: HEAD },
    threads: comments.map((comment) => ({ id: `discussion-${comment.id}`, anchor: comment.anchor, url: comment.url, resolved: false, outdated: false, stateKnown: true, comments: [comment] })) };
}
function reader(value = input(), ordinary: readonly ProviderReviewComment[] = [summary]) {
  return createGitLabAuthorPresentationReader(value, ordinary, document);
}
function image(): HTMLImageElement {
  const value = document.querySelector('img');
  if (value === null) throw new Error('Missing donor image.');
  return value;
}

beforeEach(() => {
  window.location.href = REVIEW;
  document.body.innerHTML = nativeHeader();
  bootstrap();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Author presentation must not fetch.'); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); document.documentElement.classList.remove('gl-dark'); });

it('consumes thread and ordinary snapshot sources, reusing only account presentation for all absent findings', () => {
  const measured = vi.spyOn(image(), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 31.5, 30.5));
  const read = reader();
  const original = document.body.innerHTML;
  for (const comment of findings) {
    expect(read(comment)).toEqual({ authorId: '37628862', displayName: '****', profileUrl: `https://gitlab.com/${LOGIN}`, username: `@${LOGIN}`,
      avatar: { src: AVATAR, width: 31.5, height: 30.5, className: 'gl-avatar gl-avatar-circle gl-avatar-s32' } });
  }
  expect(read(summary)?.badges?.map((badge) => badge.label)).toEqual(['Developer']);
  expect(measured).toHaveBeenCalledOnce();
  expect(document.body.innerHTML).toBe(original);
  expect(fetch).not.toHaveBeenCalled();
});

it('uses a thread donor for an ordinary target and deduplicates identical sources across both collections', () => {
  const read = reader(input([summary]), [summary, finding]);
  expect(read(finding)?.displayName).toBe('****');
  expect(read(finding)?.avatar).toBeUndefined();
});

it('prefers a late-mounted direct header and its own badges without retaining borrowed metadata', () => {
  const read = reader();
  expect(read(finding)?.badges).toBeUndefined();
  document.body.insertAdjacentHTML('beforeend', nativeHeader(finding.id, 'Direct source name'));
  expect(read(finding)).toMatchObject({ displayName: 'Direct source name', badges: [{ label: 'Developer' }] });
  document.querySelector(`#${summary.anchor}`)?.remove();
  expect(read(finding)?.displayName).toBe('Direct source name');
  document.querySelector(`#${finding.anchor}`)?.remove();
  expect(read(finding)).toBeNull();
});

it.each(['body', 'createdAt', 'updatedAt', 'url', 'anchor'] as const)('rejects changed target %s facts rather than lending snapshot membership', (field) => {
  expect(reader()({ ...finding, [field]: `${finding[field] ?? ''}-changed` })).toBeNull();
});

it('keeps source membership immutable when the caller mutates its original snapshot objects', () => {
  const mutable = { ...finding, author: { ...finding.author } };
  const read = reader(input([mutable]));
  mutable.body = 'Changed outside reader';
  mutable.author.login = 'other';
  expect(read(mutable)).toBeNull();
  expect(read(finding)?.displayName).toBe('****');
});

it.each([{ id: '2', login: LOGIN }, { id: '37628862', login: 'other-account' }])('requires both durable identity and exact login: %j', (author) => {
  const changed = { ...finding, author };
  expect(reader(input([changed]))(changed)).toBeNull();
});

it('rejects conflicting duplicate source IDs and donors absent from the fetched snapshot', () => {
  expect(reader(input(), [summary, { ...summary, body: 'Conflicting body' }])(finding)).toBeNull();
  expect(reader(input(), [])(finding)).toBeNull();
  expect(reader()({ ...finding, id: '9', anchor: 'note_9', url: `${REVIEW}#note_9` })).toBeNull();
});

it.each([
  { head_sha: null }, { head_sha: HEAD.slice(0, 12) }, { head_sha: 'a'.repeat(40) },
  { latest: false }, { selected: false }, { is_merge_head: true },
])('declines unknown, stale and historical native versions: %j', (version) => {
  bootstrap(version);
  expect(reader()(finding)).toBeNull();
});

it.each([{ project_path: 'another/repository' }, { mr_path: '/whitebox-aero/whitebox/-/merge_requests/273' }, { iid: 273 }])('requires independently scoped native MR metadata: %j', (app) => {
  bootstrap({}, app);
  expect(reader()(finding)).toBeNull();
});

it('rejects duplicate or missing native context and an unknown or abbreviated snapshot head', () => {
  const read = reader();
  const app = document.querySelector('[data-rapid-diffs]');
  if (app === null) throw new Error('Missing native context.');
  document.body.append(app.cloneNode(true));
  expect(read(finding)).toBeNull();
  document.querySelectorAll('[data-rapid-diffs]').forEach((node) => node.remove());
  expect(read(finding)).toBeNull();
  bootstrap();
  expect(reader({ ...input(), subject: { ...input().subject, headSha: HEAD.slice(0, 12) } })(finding)).toBeNull();
  expect(reader({ ...input(), subject: { ...input().subject, repository: 'other/repo' } })(finding)).toBeNull();
});

it('withdraws reuse after navigation, head change or historical selection instead of retaining account metadata', () => {
  const read = reader();
  expect(read(finding)?.displayName).toBe('****');
  window.history.replaceState(null, '', `${REVIEW}?diff_id=1`);
  expect(read(finding)).toBeNull();
  window.history.replaceState(null, '', `${REVIEW}?commit_id=${HEAD}`);
  expect(read(finding)).toBeNull();
  window.history.replaceState(null, '', `${REVIEW}?diff_id=1855648093`);
  expect(read(finding)?.displayName).toBe('****');
  bootstrap({ head_sha: 'a'.repeat(40) });
  expect(read(finding)).toBeNull();
  window.history.replaceState(null, '', REVIEW.replace('/272', '/273'));
  expect(read(finding)).toBeNull();
});

it.each(['malformed', 'duplicate', 'owned', 'body'] as const)('blocks fallback when a %s target exists', (kind) => {
  document.body.insertAdjacentHTML('beforeend', kind === 'malformed' ? `<div id="${finding.anchor}"></div>` : nativeHeader(finding.id));
  const target = document.getElementById(finding.anchor);
  if (target === null) throw new Error('Missing target.');
  if (kind === 'duplicate') document.body.append(target.cloneNode(true));
  if (kind === 'owned') target.setAttribute('data-geld-ui', '');
  if (kind === 'body') document.querySelector('.note-body')?.append(target);
  expect(reader()(finding)).toBeNull();
});

it('rejects multiple mounted same-account donors and duplicate donor roots instead of picking the first', () => {
  const extra = source('9');
  const read = reader(input(), [summary, extra]);
  document.body.insertAdjacentHTML('beforeend', nativeHeader(extra.id, 'Different native name'));
  expect(read(finding)).toBeNull();
  document.getElementById(extra.anchor)?.remove();
  const donor = document.getElementById(summary.anchor);
  if (donor === null) throw new Error('Missing donor.');
  document.body.append(donor.cloneNode(true));
  expect(read(finding)).toBeNull();
});

it.each(['owned', 'body', 'description', 'composer', 'wrong-account', 'wrong-profile'] as const)('never uses a donor with %s provenance', (kind) => {
  const donor = document.getElementById(summary.anchor);
  if (donor === null) throw new Error('Missing donor.');
  if (kind === 'owned') donor.setAttribute('data-geld-ui', '');
  if (kind === 'wrong-account') donor.querySelector('.author-name-link')?.setAttribute('data-user-id', '2');
  if (kind === 'wrong-profile') donor.querySelector('.author-name-link')?.setAttribute('href', '/another-account');
  if (kind === 'body' || kind === 'description' || kind === 'composer') {
    const wrapper = document.createElement(kind === 'composer' ? 'form' : 'div');
    if (kind === 'body') wrapper.className = 'note-body';
    if (kind === 'description') wrapper.setAttribute('data-testid', 'description-content');
    document.body.append(wrapper); wrapper.append(donor);
  }
  expect(reader()(finding)).toBeNull();
});

it('revalidates donor mounts and independently declines mismatched or unsafe avatar identity', () => {
  const read = reader();
  vi.spyOn(image(), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 29, 29));
  expect(read(finding)?.avatar?.width).toBe(29);
  document.querySelector('.gl-avatar-link')?.setAttribute('data-user-id', '2');
  expect(read(finding)?.displayName).toBe('****'); expect(read(finding)?.avatar).toBeUndefined();
  const donor = document.getElementById(summary.anchor);
  if (donor === null) throw new Error('Missing donor.');
  donor.remove(); expect(read(finding)).toBeNull();
  document.body.insertAdjacentHTML('beforeend', nativeHeader());
  image().setAttribute('src', 'http://example.com/unsafe.png');
  expect(read(finding)?.avatar).toBeUndefined();
  expect(read(finding)?.displayName).toBe('****');
});

it('reuses geometry without freezing theme and refreshes only source, class or viewport changes', () => {
  const read = reader();
  const avatar = image();
  const rect = vi.spyOn(avatar, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 31, 31));
  const original = document.body.innerHTML;
  for (let count = 0; count < 200; count += 1) expect(read(finding)?.avatar?.width).toBe(31);
  expect(rect).toHaveBeenCalledOnce();
  document.documentElement.classList.add('gl-dark');
  expect(read(finding)?.avatar?.className).toBe('gl-avatar gl-avatar-circle gl-avatar-s32');
  expect(read(finding)).not.toHaveProperty('color');
  expect(rect).toHaveBeenCalledOnce();
  expect(document.body.innerHTML).toBe(original);
  rect.mockReturnValue(new DOMRect(0, 0, 28, 28));
  window.dispatchEvent(new Event('resize'));
  expect(read(finding)?.avatar?.width).toBe(28); expect(rect).toHaveBeenCalledTimes(2);
  avatar.classList.add('native-new-class');
  expect(read(finding)?.avatar?.width).toBe(28); expect(rect).toHaveBeenCalledTimes(3);
  avatar.setAttribute('src', 'https://gitlab.com/changed-native-avatar.png');
  expect(read(finding)?.avatar?.src).toBe('https://gitlab.com/changed-native-avatar.png'); expect(rect).toHaveBeenCalledTimes(4);
  expect(fetch).not.toHaveBeenCalled();
});

it('rejects duplicated selected versions, duplicated selection parameters and body-supplied native context', () => {
  bootstrap({}, { versions: { source_versions: [{ id: 1, latest: true, selected: true, is_merge_head: false, head_sha: HEAD }, { id: 2, latest: true, selected: true, is_merge_head: false, head_sha: HEAD }] } });
  expect(reader()(finding)).toBeNull();
  bootstrap();
  window.history.replaceState(null, '', `${REVIEW}?diff_id=1855648093&diff_id=1`);
  expect(reader()(finding)).toBeNull();
  window.history.replaceState(null, '', REVIEW);
  const context = document.querySelector('[data-rapid-diffs]');
  if (context === null) throw new Error('Missing native context.');
  document.querySelector('.note-body')?.append(context);
  expect(reader()(finding)).toBeNull();
});

it('does not mutate native styles and retains only previously measured same-image geometry when hidden', () => {
  const read = reader();
  const avatar = image();
  avatar.style.width = '100%'; avatar.style.height = '100%';
  const rect = vi.spyOn(avatar, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 30, 30));
  const original = document.body.innerHTML;
  expect(read(finding)?.avatar?.width).toBe(30);
  expect(document.body.innerHTML).toBe(original);
  rect.mockReturnValue(new DOMRect());
  avatar.parentElement?.setAttribute('hidden', '');
  window.dispatchEvent(new Event('resize'));
  expect(read(finding)?.avatar?.width).toBe(30);
  expect(avatar.getAttribute('style')).toBe('width: 100%; height: 100%;');
  avatar.setAttribute('src', 'https://gitlab.com/replaced-avatar.png');
  expect(read(finding)?.avatar).toBeUndefined();
});

it.each(Array.from({ length: 23 }, (_, index) => index + 41))('rejects a %i-character head in the native and snapshot fallback proof', (length) => {
  const malformed = 'a'.repeat(length);
  bootstrap({ head_sha: malformed });
  expect(reader()(finding)).toBeNull();
  bootstrap();
  expect(reader({ ...input(), subject: { ...input().subject, headSha: malformed } })(finding)).toBeNull();
});

it('discovers donors from mounted native roots with bounded reads despite ten thousand unmounted same-account sources', () => {
  const unmounted = Array.from({ length: 10_000 }, (_, index) => source(String(9000000000 + index)));
  const read = reader(input(), [summary, ...unmounted]);
  const queries = vi.spyOn(document, 'querySelectorAll');
  for (let count = 0; count < 10; count += 1) expect(read(finding)?.displayName).toBe('****');
  expect(queries.mock.calls.filter(([selector]) => selector.startsWith('[id=')).length).toBeLessThanOrEqual(30);
  expect(queries.mock.calls.filter(([selector]) => selector === '[data-testid="noteable-note-container"][id]').length).toBe(10);
  expect(queries.mock.calls.some(([selector]) => selector.includes('note_9000000000'))).toBe(false);
});

it('accepts a full 64-character head only when native and snapshot versions agree', () => {
  const head = 'f'.repeat(64);
  bootstrap({ head_sha: head });
  expect(reader({ ...input(), subject: { ...input().subject, headSha: head } })(finding)).toMatchObject({ displayName: '****' });
});
